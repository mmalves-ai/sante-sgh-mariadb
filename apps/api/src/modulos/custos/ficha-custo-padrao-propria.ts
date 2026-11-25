// Porta própria do custo-padrão por procedimento (07-FIN L140, C2-115; F8) sobre o banco do cliente:
// - a ficha técnica do procedimento (ficha_custo_padrao), com versão, vigência e situação (rascunho, ativa, inativa);
// - os itens (ficha_custo_padrao_item): insumo, minuto de sala, gás medicinal, diária, exame, serviço, procedimento,
//   mão de obra ou avulso, com a quantidade e o custo unitário (o informado ou o de referência do cadastro de custos:
//   o último custo médio do insumo, o custo por minuto do gás vigente, a média do minuto das salas com custo vigente, o
//   custo-padrão mais recente da diária da unidade da acomodação, o custo de referência do procedimento);
// - os totais da ficha recalculados pela regra do domínio a cada item (honorário, operacional e total);
// - a ativação (a anterior do procedimento fica encerrada na véspera, nunca apagada) e a inativação com motivo (trilha);
// - a comparação do padrão com o custo apurado das contas da competência que lançaram o procedimento.
// A regra é de @sgh/dominio-custos (custo-padrao.ts); o banco só guarda. Cada gravação é uma operação do Executor (trilha
// na mesma transação) com a trava otimista pela versão da ficha. O escopo é o estabelecimento da sessão (fora, 404).
// Item retirado do rascunho fica com excluido_em (nunca apagado).
import { randomUUID } from 'node:crypto';
import {
  calcularCustoPadrao,
  compararComApurado,
  type ComparacaoCustoPadrao,
  custoDoItemCent,
  custoMinutoSala,
  custoUnitarioDoItem,
  type EntradaItemFicha,
  fichaVigente,
  planejarAtivacao,
  type ProblemaCustoPadrao,
  problemasDaEdicaoDeItens,
  problemasDaFicha,
  problemasDaInativacao,
  problemasDoItemFicha,
  proximaVersaoFicha,
  type SituacaoFichaCusto,
  type TipoItemFicha,
  tipoItemValido,
  UNIDADE_DO_TIPO,
  vigenteNaData,
} from '@sgh/dominio-custos';
import {
  type ContextoNucleo,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';

export const PORTA_FICHA_CUSTO_PADRAO = Symbol('PORTA_FICHA_CUSTO_PADRAO');

export const TABELAS_FICHA_CUSTO_PADRAO = ['ficha_custo_padrao', 'ficha_custo_padrao_item'] as const;

export interface ContextoFichaCusto extends ContextoNucleo {
  readonly hospital: string;
}

export type FichaGravada = { readonly id: number; readonly versao: number };
type Trilha = (r: FichaGravada) => RegistroTrilhaTela;

// ---- conversões ----
const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
};
const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const idOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const dois = (n: number) => String(n).padStart(2, '0');
const dataIso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return `${v.getUTCFullYear()}-${dois(v.getUTCMonth() + 1)}-${dois(v.getUTCDate())}`;
  const t = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
};
/** Reais (DECIMAL 15,2) em centavos. */
const cent = (v: unknown): number => Math.round(num(v) * 100);
const reais = (c: number): string => (c / 100).toFixed(2);
const trechoLike = (t: string): string => `%${t.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

const naoEncontrado = () =>
  new ErroOperacao(
    404,
    'nao-encontrado',
    'Registro não encontrado',
    'A ficha não existe neste estabelecimento.',
  );
const semEstabelecimento = () =>
  recusa(
    'estabelecimento-desconhecido',
    'O estabelecimento da sessão não está cadastrado no banco do cliente.',
  );
const desatualizado = () =>
  new ErroOperacao(
    409,
    'conflito-versao',
    'Registro alterado',
    'A ficha foi alterada por outra pessoa: abra de novo e refaça.',
  );

function exigir(problemas: readonly ProblemaCustoPadrao[]): void {
  const x = problemas[0];
  if (x) throw recusa(x.codigo, x.detalhe, { campos: [...new Set(problemas.map((y) => y.campo))] });
}

// ---- entradas (validadas no controller) ----
export interface EntradaNovaFicha {
  procedimento: number;
  descricao: string;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  setorFuncional: number | null;
  /** Copiar os itens da ficha vigente do procedimento (nova versão a partir da anterior). */
  copiarVigente: boolean;
}
export interface EntradaItem {
  versao: number;
  tipo: string;
  referencia: number | null;
  descricao: string | null;
  quantidade: number;
  custoUnitario: number | null;
}

// ---- leituras ----
export interface ItemFicha {
  id: number;
  sequencia: number;
  tipo: TipoItemFicha;
  referencia: number | null;
  codigo: string | null;
  descricao: string;
  unidade: string;
  quantidade: number;
  custoUnitario: number;
  custoTotal: number; // centavos
}
export interface FichaResumo {
  id: number;
  versao: number;
  procedimento: { id: number; codigo: string; descricao: string };
  descricao: string;
  versaoFicha: string;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  situacao: SituacaoFichaCusto;
  padrao: boolean;
  custoHonorario: number;
  custoOperacional: number;
  custoTotal: number;
  vigenteHoje: boolean;
}
export interface FichaDetalhe extends FichaResumo {
  itens: ItemFicha[];
  porTipo: Partial<Record<TipoItemFicha, number>>;
  /** Outras versões do procedimento (histórico, da mais nova à mais velha). */
  versoes: {
    id: number;
    versaoFicha: string;
    situacao: SituacaoFichaCusto;
    vigenciaInicio: string;
    vigenciaFim: string | null;
    custoTotal: number;
  }[];
}
export interface OpcaoReferencia {
  id: number;
  codigo: string;
  descricao: string;
  /** Custo unitário de referência vigente (null: sem referência; a tela pede o custo). */
  custoUnitario: number | null;
  unidade: string;
}
export interface ComparacaoFicha extends ComparacaoCustoPadrao {
  ficha: number;
  competencia: string;
  apuracao: { id: number; numeroVersao: number; situacao: string } | null;
  custoPadrao: number;
}

const SQL_FICHA = `SELECT f.id, f.versao, f.item_faturavel_id, f.descricao, f.versao_ficha, f.vigencia_inicio, f.vigencia_fim,
         f.situacao, f.padrao, f.custo_honorario, f.custo_operacional, f.custo_total, i.codigo AS proc_codigo,
         i.descricao AS proc_descricao
    FROM ficha_custo_padrao f JOIN item_faturavel i ON i.id = f.item_faturavel_id
   WHERE f.estabelecimento_id = ? AND f.excluido_em IS NULL`;

function resumo(r: Record<string, unknown>, hoje: string): FichaResumo {
  const ini = dataIso(r['vigencia_inicio']) ?? '';
  const fim = dataIso(r['vigencia_fim']);
  const situacao = String(r['situacao']) as SituacaoFichaCusto;
  return {
    id: Number(r['id']),
    versao: Number(r['versao']),
    procedimento: {
      id: Number(r['item_faturavel_id']),
      codigo: String(r['proc_codigo'] ?? ''),
      descricao: String(r['proc_descricao'] ?? ''),
    },
    descricao: String(r['descricao']),
    versaoFicha: String(r['versao_ficha']),
    vigenciaInicio: ini,
    vigenciaFim: fim,
    situacao,
    padrao: r['padrao'] === true || Number(r['padrao']) === 1,
    custoHonorario: cent(r['custo_honorario']),
    custoOperacional: cent(r['custo_operacional']),
    custoTotal: cent(r['custo_total']),
    vigenteHoje: situacao === 'ativa' && ini <= hoje && (fim === null || fim >= hoje),
  };
}

/** Coluna da referência de cada tipo no item (o CHECK do banco exige a do tipo). */
const COLUNA_REFERENCIA: Readonly<Record<TipoItemFicha, string | null>> = {
  insumo: 'insumo_id',
  gas_medicinal: 'insumo_id',
  exame: 'exame_id',
  sala_cirurgica: 'procedimento_cirurgico_id',
  diaria: 'acomodacao_id',
  servico: 'servico_contratavel_id',
  procedimento: 'item_faturavel_id',
  mao_de_obra: null,
  outro: null,
};

export class PortaFichaCustoPadraoPropria {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private static async estabelecimento(c: ContextoFichaCusto, l: Leitor): Promise<number> {
    if (c.estabelecimento !== null) return c.estabelecimento;
    const r = c.hospital
      ? await l.uma<{ id: unknown }>(
          'SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
          [c.hospital],
        )
      : null;
    if (!r) throw semEstabelecimento();
    return Number(r['id']);
  }

  private ler<T>(
    c: ContextoFichaCusto,
    fn: (l: Leitor, est: number, hoje: string) => Promise<T>,
  ): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: c.correlacao || 'custos-ficha-padrao' },
      async (l) => {
        const est = await PortaFichaCustoPadraoPropria.estabelecimento(c, l);
        const h = await l.uma<{ hoje: unknown }>('SELECT CURRENT_DATE AS hoje');
        return fn(l, est, dataIso(h?.['hoje']) ?? new Date().toISOString().slice(0, 10));
      },
    );
  }

  private async gravar(
    c: ContextoFichaCusto,
    nome: string,
    trilha: Trilha,
    fn: (tx: TxOperacao, est: number, hoje: string) => Promise<FichaGravada>,
  ): Promise<FichaGravada> {
    const est = await this.ler(c, async (_l, e) => e);
    const operacao = definirOperacao<Record<string, unknown>, FichaGravada>({
      nome,
      tabelas: TABELAS_FICHA_CUSTO_PADRAO,
      entrada: z.record(z.string(), z.unknown()),
      acao: 'operacao',
      gravar: async (tx) => {
        const h = await tx.uma<{ hoje: unknown }>('SELECT CURRENT_DATE AS hoje');
        return fn(tx, est, dataIso(h?.['hoje']) ?? new Date().toISOString().slice(0, 10));
      },
      alvo: (_e, r) => ({ tabela: 'ficha_custo_padrao', id: r.id }),
      trilha: (_e, r) => {
        const l = trilha(r);
        return { dados: l.dadosDepois, motivo: l.motivo ?? null };
      },
    });
    const ctx = {
      cliente: this.cliente,
      estabelecimento: est,
      usuario: c.usuario,
      correlacao: (c.correlacao || 'custos-ficha-padrao').slice(0, 64),
      chaveIdempotencia: `direta:${randomUUID()}`,
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
    const r = await this.executor.executar(operacao, this.cliente, {}, ctx);
    return r.resultado;
  }

  // ======== referências ========

  /** Custo unitário de referência vigente na data para o item do tipo (null: sem referência no cadastro). */
  private static async custoReferencia(
    l: Leitor,
    est: number,
    tipo: TipoItemFicha,
    ref: number | null,
    data: string,
  ): Promise<number | null> {
    if (ref === null) return null;
    if (tipo === 'insumo') {
      const r = await l.uma(
        `SELECT custo_medio FROM custo_medio_historico
          WHERE estabelecimento_id = ? AND insumo_id = ? AND simulacao = FALSE AND ocorrido_em < DATE_ADD(?, INTERVAL 1 DAY)
          ORDER BY ocorrido_em DESC, id DESC LIMIT 1`,
        [est, ref, data],
      );
      return r ? Math.round(num(r['custo_medio']) * 10_000) / 10_000 : null;
    }
    if (tipo === 'gas_medicinal') {
      const rs = await l.consultar(
        `SELECT vigencia_inicio, vigencia_fim, valor_custo_minuto FROM custo_gas_medicinal
          WHERE estabelecimento_id = ? AND insumo_id = ? AND centro_custo_id IS NULL`,
        [est, ref],
        { teto: 500 },
      );
      return vigenteNaData(
        rs.map((x) => ({
          inicio: dataIso(x['vigencia_inicio']) ?? '',
          fim: dataIso(x['vigencia_fim']),
          valor: num(x['valor_custo_minuto']),
        })),
        data,
      );
    }
    if (tipo === 'sala_cirurgica') {
      const rs = await l.consultar(
        `SELECT sala_cirurgica_id, vigencia_inicio, vigencia_fim, valor_minuto FROM custo_sala_cirurgica
          WHERE estabelecimento_id = ?`,
        [est],
        { teto: 2000 },
      );
      const porSala = new Map<number, { inicio: string; fim: string | null; valor: number }[]>();
      for (const x of rs) {
        const k = Number(x['sala_cirurgica_id']);
        const lista = porSala.get(k) ?? [];
        lista.push({
          inicio: dataIso(x['vigencia_inicio']) ?? '',
          fim: dataIso(x['vigencia_fim']),
          valor: num(x['valor_minuto']),
        });
        porSala.set(k, lista);
      }
      return custoMinutoSala([...porSala.values()], data);
    }
    if (tipo === 'diaria') {
      const r = await l.uma(
        `SELECT d.valor_custo_diaria FROM custo_diaria_unidade d JOIN acomodacao a ON a.unidade_internacao_id = d.unidade_internacao_id
          WHERE a.id = ? AND d.estabelecimento_id = ? AND d.tipo_custo = 'padrao' AND d.competencia <= ?
            AND (d.acomodacao_id = a.id OR d.acomodacao_id IS NULL)
          ORDER BY d.competencia DESC, d.acomodacao_chave DESC LIMIT 1`,
        [ref, est, data],
      );
      return r ? num(r['valor_custo_diaria']) : null;
    }
    if (tipo === 'procedimento') {
      const r = await l.uma('SELECT custo_referencia FROM item_faturavel WHERE id = ?', [ref]);
      return r && r['custo_referencia'] !== null ? num(r['custo_referencia']) : null;
    }
    return null;
  }

  /** Opções do item pelo tipo e pelo trecho do código ou nome, já com o custo de referência vigente hoje. */
  referencias(c: ContextoFichaCusto, tipo: string, termo: string): Promise<OpcaoReferencia[]> {
    return this.ler(c, async (l, est, hoje) => {
      if (!tipoItemValido(tipo))
        throw recusa('tipo-invalido', 'Tipo de item desconhecido.', { campos: ['tipo'] });
      const t = trechoLike(termo.trim());
      let rs: Record<string, unknown>[] = [];
      if (tipo === 'insumo')
        rs = await l.consultar(
          "SELECT id, codigo, nome AS descricao FROM insumo WHERE excluido_em IS NULL AND situacao = 'ativo' AND (codigo LIKE ? OR nome LIKE ?) ORDER BY nome LIMIT 20",
          [t, t],
        );
      else if (tipo === 'gas_medicinal')
        rs = await l.consultar(
          `SELECT DISTINCT i.id, i.codigo, i.nome AS descricao FROM insumo i JOIN custo_gas_medicinal g ON g.insumo_id = i.id
            WHERE g.estabelecimento_id = ? AND i.excluido_em IS NULL AND (i.codigo LIKE ? OR i.nome LIKE ?) ORDER BY i.nome LIMIT 20`,
          [est, t, t],
        );
      else if (tipo === 'sala_cirurgica')
        rs = await l.consultar(
          'SELECT id, codigo, descricao FROM procedimento_cirurgico WHERE excluido_em IS NULL AND (codigo LIKE ? OR descricao LIKE ?) ORDER BY descricao LIMIT 20',
          [t, t],
        );
      else if (tipo === 'diaria')
        rs = await l.consultar(
          'SELECT id, codigo, nome AS descricao FROM acomodacao WHERE estabelecimento_id = ? AND excluido_em IS NULL AND (codigo LIKE ? OR nome LIKE ?) ORDER BY nome LIMIT 20',
          [est, t, t],
        );
      else if (tipo === 'exame')
        rs = await l.consultar(
          'SELECT id, codigo, nome AS descricao FROM exame WHERE excluido_em IS NULL AND (codigo LIKE ? OR nome LIKE ? OR sigla LIKE ?) ORDER BY nome LIMIT 20',
          [t, t, t],
        );
      else if (tipo === 'servico')
        rs = await l.consultar(
          'SELECT id, codigo, descricao FROM servico_contratavel WHERE excluido_em IS NULL AND (codigo LIKE ? OR descricao LIKE ?) ORDER BY descricao LIMIT 20',
          [t, t],
        );
      else if (tipo === 'procedimento')
        rs = await l.consultar(
          'SELECT id, codigo, descricao FROM item_faturavel WHERE excluido_em IS NULL AND (codigo LIKE ? OR descricao LIKE ?) ORDER BY descricao LIMIT 20',
          [t, t],
        );
      const out: OpcaoReferencia[] = [];
      for (const r of rs) {
        const id = Number(r['id']);
        out.push({
          id,
          codigo: String(r['codigo'] ?? ''),
          descricao: String(r['descricao'] ?? ''),
          custoUnitario: await PortaFichaCustoPadraoPropria.custoReferencia(l, est, tipo, id, hoje),
          unidade: UNIDADE_DO_TIPO[tipo],
        });
      }
      return out;
    });
  }

  /** Procedimentos (itens faturáveis) pelo código ou descrição, para abrir a ficha. */
  procedimentos(c: ContextoFichaCusto, termo: string) {
    return this.ler(c, async (l) => {
      const t = trechoLike(termo.trim());
      const rs = await l.consultar(
        'SELECT id, codigo, descricao, tempo_minutos FROM item_faturavel WHERE excluido_em IS NULL AND (codigo LIKE ? OR descricao LIKE ?) ORDER BY descricao LIMIT 20',
        [t, t],
      );
      return rs.map((r) => ({
        id: Number(r['id']),
        codigo: String(r['codigo']),
        descricao: String(r['descricao']),
        tempoMinutos: idOuNull(r['tempo_minutos']),
      }));
    });
  }

  // ======== leituras ========

  listar(
    c: ContextoFichaCusto,
    filtro: { termo: string | null; situacao: string | null },
  ): Promise<FichaResumo[]> {
    return this.ler(c, async (l, est, hoje) => {
      const p: unknown[] = [est];
      let sql = SQL_FICHA;
      if (filtro.situacao) {
        sql += ' AND f.situacao = ?';
        p.push(filtro.situacao);
      }
      if (filtro.termo?.trim()) {
        const t = trechoLike(filtro.termo.trim());
        sql += ' AND (i.codigo LIKE ? OR i.descricao LIKE ? OR f.descricao LIKE ?)';
        p.push(t, t, t);
      }
      sql += ' ORDER BY i.descricao, f.vigencia_inicio DESC, f.id DESC';
      const rs = await l.consultar(sql, p, { teto: 500 });
      return rs.map((r) => resumo(r, hoje));
    });
  }

  private static async fichaLida(l: Leitor, est: number, id: number, hoje: string): Promise<FichaResumo> {
    const r = await l.uma(`${SQL_FICHA} AND f.id = ?`, [est, id]);
    if (!r) throw naoEncontrado();
    return resumo(r, hoje);
  }

  private static async itensLidos(l: Leitor, ficha: number): Promise<ItemFicha[]> {
    const rs = await l.consultar(
      `SELECT x.id, x.sequencia, x.tipo_referencia, x.insumo_id, x.exame_id, x.procedimento_cirurgico_id, x.acomodacao_id,
              x.servico_contratavel_id, x.item_faturavel_id, x.descricao, x.quantidade, x.custo_unitario, x.custo_total,
              COALESCE(ins.codigo, ex.codigo, pc.codigo, ac.codigo, sc.codigo, it.codigo) AS ref_codigo,
              COALESCE(x.descricao, ins.nome, ex.nome, pc.descricao, ac.nome, sc.descricao, it.descricao) AS ref_descricao
         FROM ficha_custo_padrao_item x
         LEFT JOIN insumo ins ON ins.id = x.insumo_id
         LEFT JOIN exame ex ON ex.id = x.exame_id
         LEFT JOIN procedimento_cirurgico pc ON pc.id = x.procedimento_cirurgico_id
         LEFT JOIN acomodacao ac ON ac.id = x.acomodacao_id
         LEFT JOIN servico_contratavel sc ON sc.id = x.servico_contratavel_id
         LEFT JOIN item_faturavel it ON it.id = x.item_faturavel_id
        WHERE x.ficha_custo_padrao_id = ? AND x.excluido_em IS NULL
        ORDER BY x.sequencia`,
      [ficha],
      { teto: 1000 },
    );
    return rs.map((r) => {
      const tipo = String(r['tipo_referencia']) as TipoItemFicha;
      const col = COLUNA_REFERENCIA[tipo];
      return {
        id: Number(r['id']),
        sequencia: Number(r['sequencia']),
        tipo,
        referencia: col ? idOuNull(r[col]) : null,
        codigo: texto(r['ref_codigo']),
        descricao: String(r['ref_descricao'] ?? ''),
        unidade: UNIDADE_DO_TIPO[tipo] ?? 'unidade',
        quantidade: num(r['quantidade']),
        custoUnitario: num(r['custo_unitario']),
        custoTotal: cent(r['custo_total']),
      };
    });
  }

  detalhar(c: ContextoFichaCusto, id: number): Promise<FichaDetalhe> {
    return this.ler(c, async (l, est, hoje) => {
      const f = await PortaFichaCustoPadraoPropria.fichaLida(l, est, id, hoje);
      const itens = await PortaFichaCustoPadraoPropria.itensLidos(l, id);
      const vs = await l.consultar(
        `SELECT id, versao_ficha, situacao, vigencia_inicio, vigencia_fim, custo_total FROM ficha_custo_padrao
          WHERE estabelecimento_id = ? AND item_faturavel_id = ? AND id <> ? AND excluido_em IS NULL
          ORDER BY vigencia_inicio DESC, id DESC`,
        [est, f.procedimento.id, id],
        { teto: 200 },
      );
      return {
        ...f,
        itens,
        porTipo: calcularCustoPadrao(itens).porTipo,
        versoes: vs.map((v) => ({
          id: Number(v['id']),
          versaoFicha: String(v['versao_ficha']),
          situacao: String(v['situacao']) as SituacaoFichaCusto,
          vigenciaInicio: dataIso(v['vigencia_inicio']) ?? '',
          vigenciaFim: dataIso(v['vigencia_fim']),
          custoTotal: cent(v['custo_total']),
        })),
      };
    });
  }

  /** O padrão da ficha contra o custo apurado das contas da competência que lançaram o procedimento. */
  comparar(
    c: ContextoFichaCusto,
    id: number,
    competencia: string,
    toleranciaCent?: number,
  ): Promise<ComparacaoFicha> {
    return this.ler(c, async (l, est, hoje) => {
      const f = await PortaFichaCustoPadraoPropria.fichaLida(l, est, id, hoje);
      const comp = `${competencia.slice(0, 7)}-01`;
      const a = await l.uma(
        `SELECT id, numero_versao, situacao FROM apuracao_custo
          WHERE estabelecimento_id = ? AND competencia = ? AND situacao IN ('apurada','fechada','reaberta')
          ORDER BY numero_versao DESC, id DESC LIMIT 1`,
        [est, comp],
      );
      const contas = a
        ? await l.consultar(
            `SELECT ch.id, ch.numero, k.custo_total, q.quantidade
               FROM custo_conta_paciente k
               JOIN conta_hospitalar ch ON ch.id = k.conta_hospitalar_id
               JOIN (SELECT conta_hospitalar_id, SUM(quantidade) AS quantidade FROM conta_hospitalar_item
                      WHERE item_faturavel_id = ? AND excluido_em IS NULL GROUP BY conta_hospitalar_id) q
                 ON q.conta_hospitalar_id = ch.id
              WHERE k.apuracao_custo_id = ? AND k.excluido_em IS NULL AND ch.estabelecimento_id = ?
              ORDER BY ch.numero`,
            [f.procedimento.id, Number(a['id']), est],
            { teto: 5000 },
          )
        : [];
      const cmp = compararComApurado(
        f.custoTotal,
        contas.map((r) => ({
          conta: Number(r['id']),
          numero: String(r['numero']),
          quantidade: num(r['quantidade']),
          custoApurado: cent(r['custo_total']),
        })),
        toleranciaCent,
      );
      return {
        ...cmp,
        ficha: id,
        competencia: comp.slice(0, 7),
        apuracao: a
          ? { id: Number(a['id']), numeroVersao: Number(a['numero_versao']), situacao: String(a['situacao']) }
          : null,
        custoPadrao: f.custoTotal,
      };
    });
  }

  // ======== gravações ========

  private static async fichaParaGravar(tx: TxOperacao, est: number, id: number, versao: number | null) {
    const rs = await tx.consultarParaAtualizar(
      `SELECT id, versao, item_faturavel_id, situacao, vigencia_inicio, vigencia_fim, padrao, custo_total
         FROM ficha_custo_padrao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [id, est],
    );
    const r = rs[0];
    if (!r) throw naoEncontrado();
    if (versao !== null && Number(r['versao']) !== versao) throw desatualizado();
    return {
      id,
      versao: Number(r['versao']),
      procedimento: Number(r['item_faturavel_id']),
      situacao: String(r['situacao']) as SituacaoFichaCusto,
      vigenciaInicio: dataIso(r['vigencia_inicio']) ?? '',
      vigenciaFim: dataIso(r['vigencia_fim']),
      padrao: r['padrao'] === true || Number(r['padrao']) === 1,
      custoTotal: cent(r['custo_total']),
    };
  }

  /** Recalcula os totais da ficha pelos itens vivos (regra do domínio) e sobe a versão da ficha. */
  private static async recalcular(tx: TxOperacao, id: number, versao: number): Promise<FichaGravada> {
    const rs = await tx.consultar(
      'SELECT tipo_referencia, custo_total FROM ficha_custo_padrao_item WHERE ficha_custo_padrao_id = ? AND excluido_em IS NULL',
      [id],
      { teto: 1000 },
    );
    const t = calcularCustoPadrao(
      rs.map((r) => ({
        tipo: String(r['tipo_referencia']) as TipoItemFicha,
        custoTotal: cent(r['custo_total']),
      })),
    );
    const v = await tx.alterar('ficha_custo_padrao', id, versao, {
      custo_honorario: reais(t.honorario),
      custo_operacional: reais(t.operacional),
      custo_total: reais(t.total),
    });
    return { id, versao: v };
  }

  private static async inserirItem(
    tx: TxOperacao,
    ficha: number,
    sequencia: number,
    tipo: TipoItemFicha,
    referencia: number | null,
    descricao: string | null,
    quantidade: number,
    custoUnitario: number,
  ): Promise<void> {
    const col = COLUNA_REFERENCIA[tipo];
    await tx.incluir('ficha_custo_padrao_item', {
      ficha_custo_padrao_id: ficha,
      sequencia,
      tipo_referencia: tipo,
      ...(col ? { [col]: referencia } : {}),
      descricao: col ? null : descricao,
      quantidade: quantidade.toFixed(4),
      custo_unitario: custoUnitario.toFixed(4),
      custo_total: reais(custoDoItemCent(quantidade, custoUnitario)),
    });
  }

  async criar(c: ContextoFichaCusto, e: EntradaNovaFicha, trilha: Trilha): Promise<FichaGravada> {
    exigir(problemasDaFicha(e));
    return this.gravar(c, 'custos.ficha-padrao.criar', trilha, async (tx, est, hoje) => {
      const proc = await tx.uma('SELECT id FROM item_faturavel WHERE id = ? AND excluido_em IS NULL', [
        e.procedimento,
      ]);
      if (!proc)
        throw recusa('procedimento-desconhecido', 'O procedimento não está no cadastro.', {
          campos: ['procedimento'],
        });
      const todas = await tx.consultarParaAtualizar(
        `SELECT id, versao_ficha, situacao, vigencia_inicio, vigencia_fim, padrao FROM ficha_custo_padrao
          WHERE estabelecimento_id = ? AND item_faturavel_id = ? AND excluido_em IS NULL`,
        [est, e.procedimento],
      );
      const id = await tx.incluir('ficha_custo_padrao', {
        estabelecimento_id: est,
        item_faturavel_id: e.procedimento,
        setor_funcional_id: e.setorFuncional,
        descricao: e.descricao.trim(),
        versao_ficha: proximaVersaoFicha(todas.map((t) => String(t['versao_ficha']))),
        vigencia_inicio: e.vigenciaInicio,
        vigencia_fim: e.vigenciaFim,
        padrao: false,
        situacao: 'rascunho',
      });
      if (e.copiarVigente) {
        const vig = fichaVigente(
          todas.map((t) => ({
            id: Number(t['id']),
            situacao: String(t['situacao']) as SituacaoFichaCusto,
            vigenciaInicio: dataIso(t['vigencia_inicio']) ?? '',
            vigenciaFim: dataIso(t['vigencia_fim']),
            padrao: t['padrao'] === true || Number(t['padrao']) === 1,
          })),
          hoje,
        );
        if (vig) {
          const itens = await tx.consultar(
            `SELECT sequencia, tipo_referencia, insumo_id, exame_id, procedimento_cirurgico_id, acomodacao_id,
                    servico_contratavel_id, item_faturavel_id, descricao, quantidade, custo_unitario
               FROM ficha_custo_padrao_item WHERE ficha_custo_padrao_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
            [vig.id],
            { teto: 1000 },
          );
          for (const it of itens) {
            const tipo = String(it['tipo_referencia']) as TipoItemFicha;
            const col = COLUNA_REFERENCIA[tipo];
            await PortaFichaCustoPadraoPropria.inserirItem(
              tx,
              id,
              Number(it['sequencia']),
              tipo,
              col ? idOuNull(it[col]) : null,
              texto(it['descricao']),
              num(it['quantidade']),
              num(it['custo_unitario']),
            );
          }
          return PortaFichaCustoPadraoPropria.recalcular(tx, id, 1);
        }
      }
      return { id, versao: 1 };
    });
  }

  incluirItem(c: ContextoFichaCusto, ficha: number, e: EntradaItem, trilha: Trilha): Promise<FichaGravada> {
    return this.gravar(c, 'custos.ficha-padrao.item-incluir', trilha, async (tx, est, hoje) => {
      const f = await PortaFichaCustoPadraoPropria.fichaParaGravar(tx, est, ficha, e.versao);
      exigir(problemasDaEdicaoDeItens(f.situacao));
      const entrada: EntradaItemFicha = e;
      const tipo = e.tipo as TipoItemFicha;
      const data = f.vigenciaInicio > hoje ? f.vigenciaInicio : hoje;
      const ref = tipoItemValido(e.tipo)
        ? await PortaFichaCustoPadraoPropria.custoReferencia(tx, est, tipo, e.referencia, data)
        : null;
      exigir(problemasDoItemFicha(entrada, ref));
      const seq = await tx.uma(
        'SELECT COALESCE(MAX(sequencia), 0) + 1 AS proxima FROM ficha_custo_padrao_item WHERE ficha_custo_padrao_id = ?',
        [ficha],
      );
      await PortaFichaCustoPadraoPropria.inserirItem(
        tx,
        ficha,
        Number(seq?.['proxima'] ?? 1),
        tipo,
        e.referencia,
        e.descricao?.trim() ?? null,
        e.quantidade,
        custoUnitarioDoItem(entrada, ref),
      );
      return PortaFichaCustoPadraoPropria.recalcular(tx, ficha, f.versao);
    });
  }

  retirarItem(
    c: ContextoFichaCusto,
    ficha: number,
    item: number,
    versao: number,
    trilha: Trilha,
  ): Promise<FichaGravada> {
    return this.gravar(c, 'custos.ficha-padrao.item-retirar', trilha, async (tx, est) => {
      const f = await PortaFichaCustoPadraoPropria.fichaParaGravar(tx, est, ficha, versao);
      exigir(problemasDaEdicaoDeItens(f.situacao));
      const it = await tx.uma(
        'SELECT id, versao FROM ficha_custo_padrao_item WHERE id = ? AND ficha_custo_padrao_id = ? AND excluido_em IS NULL',
        [item, ficha],
      );
      if (!it) throw naoEncontrado();
      await tx.alterar('ficha_custo_padrao_item', item, Number(it['versao']), {
        excluido_em: new Date(),
        excluido_por: tx.contexto.usuario,
      });
      return PortaFichaCustoPadraoPropria.recalcular(tx, ficha, f.versao);
    });
  }

  ativar(c: ContextoFichaCusto, ficha: number, versao: number, trilha: Trilha): Promise<FichaGravada> {
    return this.gravar(c, 'custos.ficha-padrao.ativar', trilha, async (tx, est) => {
      const f = await PortaFichaCustoPadraoPropria.fichaParaGravar(tx, est, ficha, versao);
      const n = await tx.uma(
        'SELECT COUNT(*) AS n FROM ficha_custo_padrao_item WHERE ficha_custo_padrao_id = ? AND excluido_em IS NULL',
        [ficha],
      );
      const outras = await tx.consultarParaAtualizar(
        `SELECT id, versao, situacao, vigencia_inicio, vigencia_fim, padrao FROM ficha_custo_padrao
          WHERE estabelecimento_id = ? AND item_faturavel_id = ? AND id <> ? AND excluido_em IS NULL`,
        [est, f.procedimento, ficha],
      );
      const lidas = outras.map((o) => ({
        id: Number(o['id']),
        versao: Number(o['versao']),
        situacao: String(o['situacao']) as SituacaoFichaCusto,
        vigenciaInicio: dataIso(o['vigencia_inicio']) ?? '',
        vigenciaFim: dataIso(o['vigencia_fim']),
        padrao: o['padrao'] === true || Number(o['padrao']) === 1,
      }));
      const plano = planejarAtivacao({ ...f, itens: Number(n?.['n'] ?? 0) }, lidas);
      exigir(plano.problemas);
      for (const enc of plano.encerrar) {
        const o = lidas.find((x) => x.id === enc.id)!;
        await tx.alterar('ficha_custo_padrao', o.id, o.versao, {
          vigencia_fim: enc.vigenciaFim,
          padrao: false,
        });
      }
      for (const o of lidas)
        if (o.padrao && !plano.encerrar.some((x) => x.id === o.id)) {
          const atual = await tx.uma('SELECT versao FROM ficha_custo_padrao WHERE id = ?', [o.id]);
          await tx.alterar('ficha_custo_padrao', o.id, Number(atual?.['versao'] ?? o.versao), {
            padrao: false,
          });
        }
      const v = await tx.alterar('ficha_custo_padrao', ficha, f.versao, { situacao: 'ativa', padrao: true });
      return { id: ficha, versao: v };
    });
  }

  inativar(
    c: ContextoFichaCusto,
    ficha: number,
    versao: number,
    motivo: string,
    trilha: Trilha,
  ): Promise<FichaGravada> {
    return this.gravar(c, 'custos.ficha-padrao.inativar', trilha, async (tx, est) => {
      const f = await PortaFichaCustoPadraoPropria.fichaParaGravar(tx, est, ficha, versao);
      exigir(problemasDaInativacao(f.situacao, motivo));
      const v = await tx.alterar('ficha_custo_padrao', ficha, f.versao, {
        situacao: 'inativa',
        padrao: false,
      });
      return { id: ficha, versao: v };
    });
  }
}

export const METODOS_FICHA_CUSTO_PADRAO = [
  'referencias',
  'procedimentos',
  'listar',
  'detalhar',
  'comparar',
  'criar',
  'incluirItem',
  'retirarItem',
  'ativar',
  'inativar',
] as const;

/** Sem o núcleo do banco: a porta responde 503 em tudo (falha fechada). */
export function portaFichaCustoPadraoIndisponivel(): PortaFichaCustoPadraoPropria {
  const falha = () =>
    Promise.reject(
      new ErroOperacao(
        503,
        'indisponivel',
        'Serviço indisponível',
        'O banco do cliente não está disponível.',
      ),
    );
  return Object.fromEntries(
    METODOS_FICHA_CUSTO_PADRAO.map((m) => [m, falha]),
  ) as unknown as PortaFichaCustoPadraoPropria;
}
