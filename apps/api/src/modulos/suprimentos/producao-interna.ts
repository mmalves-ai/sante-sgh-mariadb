// Produção interna da farmácia e da central (C1-124, 05-SUP linha 12) sobre o MariaDB do cliente pelo Executor do
// núcleo (trilha na mesma transação, versão conferida, Idempotency-Key honrada). As regras são do domínio
// (`@sgh/contratos/regras-suprimentos`, producao-interna); aqui ficam a leitura, a trava e a gravação:
//   - fechamento da ordem de manipulação baixada: lote_produzido (tipo manipulacao) com os custos indiretos do lote
//     (lote_produzido_custo, pelo valor vigente do estabelecimento), o lote do produto no estoque (lote_insumo) e a
//     entrada do produto no local da ordem (movimento producao_entrada, custo médio pelo custo do lote); a ordem aponta
//     o lote, a quantidade produzida, a perda e a validade;
//   - kit montado: a composição do kit padrão sai do local (movimento producao_consumo, lotes que vencem primeiro) e o
//     kit entra como lote próprio (lote_produzido tipo kit_montado), com validade até a do componente que vence primeiro.
// Nada é apagado: o lote produzido é registro permanente da rastreabilidade (RDC 67/2007 e RDC 220/2004 da ANVISA).
import { TABELAS_PUBLICACAO_FATO } from '../contabil/publicacao-fato.js';
import {
  conferirFechamentoProducao,
  conferirMontagemKit,
  conferirValidadeDoKit,
  consumoDaMontagem,
  type CustoIndiretoDoLote,
  custoDoLote,
  destinoDoLoteProduzido,
  numeroLoteProduzido,
  type RecusaSuprimentos,
  type TipoLoteProduzido,
} from '@sgh/contratos/regras-suprimentos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type Leitor,
  type Linha,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { FUSO_PADRAO, relogioNoFuso } from '../exames/relogio.js';
import {
  exigirMesAberto,
  insumoAtivo,
  localDoEstabelecimento,
  lotesDaSaida,
  movimentar,
  tipoMovimentoId,
} from './porta-propria.js';

export const PORTA_PRODUCAO_INTERNA = Symbol('PORTA_PRODUCAO_INTERNA');
export const TABELAS_PRODUCAO_INTERNA = [
  'lote_produzido',
  'lote_produzido_custo',
  'ordem_manipulacao',
  'lote_insumo',
  'saldo_estoque',
  'saldo_lote',
  'movimento_estoque',
  // C2-093: o movimento publica o fato contábil.
  ...TABELAS_PUBLICACAO_FATO,
  'movimento_lote',
] as const;
export const OPERACOES_PRODUCAO_INTERNA = {
  fechar: 'suprimentos.producao.fechar-ordem',
  montar: 'suprimentos.producao.montar-kit',
} as const;
export const TIPO_MOVIMENTO_PRODUCAO = {
  entrada: 'producao_entrada',
  consumo: 'producao_consumo',
  dosePaciente: 'producao_dose_paciente',
} as const;
const TETO_LOTES = 300;

export interface CustoMandado {
  readonly custo: number;
  readonly quantidade: number;
}

export interface FechamentoProducaoEntrada {
  readonly versaoVista: number;
  readonly quantidadeProduzida: number;
  readonly perda: number;
  /** AAAA-MM-DDTHH:mm */
  readonly validadeEm: string;
  readonly numeroLote: string | null;
  readonly custos: readonly CustoMandado[];
  readonly valorAdicional: number;
}

export interface MontagemKitEntrada {
  readonly kit: number;
  readonly produto: number;
  readonly local: number;
  readonly quantidadeKits: number;
  readonly validadeEm: string;
  readonly numeroLote: string | null;
  readonly custos: readonly CustoMandado[];
  readonly valorAdicional: number;
}

export type LoteProduzidoGravado = {
  readonly id: number;
  readonly numeroLote: string;
  readonly loteEstoque: number;
  readonly movimento: number;
  readonly valorInsumos: number;
  readonly valorIndireto: number;
  readonly valorAdicional: number;
  readonly valorTotal: number;
  readonly custoUnitario: number;
  /** A saída da dose ao paciente na mesma transação (ordem com finalidade de prescrição); null no lote livre. */
  readonly saidaPaciente: number | null;
};

export interface LoteProduzidoLido {
  readonly id: number;
  readonly tipo: TipoLoteProduzido;
  readonly numeroLote: string;
  readonly produto: number;
  readonly produtoNome: string;
  readonly local: number;
  readonly ordem: number | null;
  readonly ordemNumero: number | null;
  readonly kit: number | null;
  readonly kitNome: string | null;
  readonly quantidadeProduzida: number;
  readonly perda: number;
  readonly produzidoEm: string;
  readonly validadeEm: string;
  readonly valorTotal: number;
  readonly custoUnitario: number | null;
  readonly situacao: string;
  readonly custos: { readonly descricao: string; readonly valorTotal: number }[];
}

export interface PainelProducaoInterna {
  readonly hoje: string;
  readonly agora: string;
  /** As ordens baixadas ainda sem lote (a fila do fechamento). */
  readonly aFechar: {
    readonly id: number;
    readonly numero: number;
    readonly versao: number;
    readonly finalidade: string;
    readonly produto: number;
    readonly produtoNome: string;
    readonly quantidadePrevista: number;
    readonly valorInsumos: number;
    readonly validadeSugerida: string | null;
  }[];
  readonly custos: { readonly id: number; readonly descricao: string; readonly valor: number | null }[];
  readonly kits: {
    readonly id: number;
    readonly codigo: string;
    readonly nome: string;
    readonly componentes: { readonly insumo: number; readonly nome: string; readonly quantidade: number }[];
  }[];
  readonly locais: { readonly id: number; readonly nome: string }[];
  readonly lotes: LoteProduzidoLido[];
}

export interface PortaProducaoInterna {
  readonly destino: 'banco' | 'indisponivel';
  painel(c: ContextoPortaM18, de: string, ate: string): Promise<PainelProducaoInterna>;
  fecharOrdem(
    c: ContextoPortaM18,
    ordem: number,
    e: FechamentoProducaoEntrada,
    chave: string,
  ): Promise<LoteProduzidoGravado>;
  montarKit(c: ContextoPortaM18, e: MontagemKitEntrada, chave: string): Promise<LoteProduzidoGravado>;
}

export function portaProducaoInternaIndisponivel(): PortaProducaoInterna {
  const falha = (): never => {
    throw new ErroProblema('indisponivel', 503, 'A produção interna exige o banco próprio.');
  };
  return { destino: 'indisponivel', painel: falha, fecharOrdem: falha, montarKit: falha };
}

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const instante = (v: unknown): string =>
  v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}T${String(v.getHours()).padStart(2, '0')}:${String(v.getMinutes()).padStart(2, '0')}`
    : v
      ? String(v).replace(' ', 'T').slice(0, 16)
      : '';
const coluna = (iso: string) => `${iso.replace('T', ' ')}:00`;

function recusarTodas(rs: readonly RecusaSuprimentos[]): void {
  const r = rs[0];
  if (!r) return;
  throw recusa(r.codigo, rs.map((x) => x.mensagem).join(' '), {
    campos: [...new Set(rs.flatMap((x) => x.campos ?? []))],
  });
}

async function relogio(l: Pick<Leitor, 'uma'>, est: number): Promise<{ hoje: string; agora: string }> {
  const r = await l.uma<{ fuso_horario: string | null }>(
    'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
    [est],
  );
  const x = relogioNoFuso(r?.fuso_horario || FUSO_PADRAO);
  return { hoje: x.hoje, agora: `${x.hoje}T${x.hora}` };
}

/** Os custos indiretos mandados com o valor vigente no estabelecimento (sem valor vigente: recusa). */
async function custosVigentes(
  l: TxOperacao,
  est: number,
  hoje: string,
  mandados: readonly CustoMandado[],
): Promise<CustoIndiretoDoLote[]> {
  const out: CustoIndiretoDoLote[] = [];
  for (const m of mandados) {
    const v = await l.uma<Linha>(
      `SELECT v.valor FROM custo_indireto_producao c
         JOIN custo_indireto_producao_valor v ON v.custo_indireto_producao_id = c.id AND v.estabelecimento_id = ?
        WHERE c.id = ? AND c.ativo AND v.vigencia_inicio <= ? AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= ?)
        ORDER BY v.vigencia_inicio DESC LIMIT 1`,
      [est, m.custo, hoje, hoje],
    );
    if (!v)
      throw recusa('custo-sem-valor', 'O custo indireto não está ativo ou não tem valor vigente.', {
        campos: ['custos'],
      });
    out.push({ custo: m.custo, quantidade: m.quantidade, valorUnitario: n(v['valor']) });
  }
  return out;
}

async function numeroDoLote(
  tx: TxOperacao,
  est: number,
  tipo: TipoLoteProduzido,
  hoje: string,
  mandado: string | null,
): Promise<string> {
  if (mandado) {
    const ja = await tx.uma<Linha>(
      'SELECT id FROM lote_produzido WHERE estabelecimento_id = ? AND numero_lote = ?',
      [est, mandado],
    );
    if (ja)
      throw recusa('lote-repetido', 'Já há lote produzido com esse número.', { campos: ['numeroLote'] });
    return mandado;
  }
  const prefixo = numeroLoteProduzido(tipo, hoje, 0).slice(0, -4);
  const [r] = await tx.consultarParaAtualizar<Linha>(
    'SELECT COUNT(*) AS k FROM lote_produzido WHERE estabelecimento_id = ? AND numero_lote LIKE ?',
    [est, `${prefixo}%`],
  );
  return numeroLoteProduzido(tipo, hoje, n(r?.['k']) + 1);
}

async function profissionalDe(tx: TxOperacao, est: number): Promise<number | null> {
  const u = tx.contexto.usuario;
  if (u === null) return null;
  const r = await tx.uma<Linha>(
    `SELECT profissional_id FROM usuario_vinculo_profissional
      WHERE usuario_id = ? AND estabelecimento_id = ? AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)
      ORDER BY vigencia_inicio DESC LIMIT 1`,
    [u, est],
  );
  return r ? n(r['profissional_id']) : null;
}

/** O lote do produto no estoque, a entrada no local, o lote produzido e os custos: o comum dos dois caminhos. */
async function gravarLote(
  tx: TxOperacao,
  est: number,
  p: {
    tipo: TipoLoteProduzido;
    produto: number;
    unidade: number;
    local: number;
    quantidade: number;
    perda: number;
    agora: string;
    hoje: string;
    validadeEm: string;
    numeroLote: string;
    valorInsumos: number;
    custos: readonly CustoIndiretoDoLote[];
    valorAdicional: number;
    ordem?: number | null;
    formula?: number | null;
    kit?: number | null;
    atendimento?: number | null;
    paciente?: number | null;
  },
): Promise<LoteProduzidoGravado> {
  const custo = custoDoLote(p.valorInsumos, p.custos, p.valorAdicional, p.quantidade);
  const validade = p.validadeEm.slice(0, 10);
  const ja = await tx.uma<Linha>(
    'SELECT id FROM lote_insumo WHERE estabelecimento_id = ? AND insumo_id = ? AND numero_lote = ? AND validade = ?',
    [est, p.produto, p.numeroLote, validade],
  );
  if (ja) throw recusa('lote-repetido', 'O produto já tem lote com esse número.', { campos: ['numeroLote'] });
  const loteEstoque = await tx.incluir('lote_insumo', {
    estabelecimento_id: est,
    insumo_id: p.produto,
    numero_lote: p.numeroLote,
    validade,
    fabricado_em: p.hoje,
    situacao: 'liberado',
  });
  const mov = await movimentar(tx, est, {
    local: p.local,
    insumo: p.produto,
    quantidade: p.quantidade,
    natureza: 'entrada',
    tipoMovimento: await tipoMovimentoId(tx, TIPO_MOVIMENTO_PRODUCAO.entrada),
    valorEntrada: custo.valorTotal,
    lotes: [{ id: loteEstoque, quantidade: p.quantidade }],
    hoje: p.hoje,
    atendimento: p.atendimento ?? null,
    paciente: p.paciente ?? null,
  });
  const id = await tx.incluir('lote_produzido', {
    estabelecimento_id: est,
    numero_lote: p.numeroLote,
    tipo: p.tipo,
    insumo_id: p.produto,
    unidade_medida_id: p.unidade,
    local_estoque_id: p.local,
    ordem_manipulacao_id: p.ordem ?? null,
    formula_padrao_manipulacao_id: p.formula ?? null,
    kit_material_id: p.kit ?? null,
    lote_insumo_id: loteEstoque,
    atendimento_id: p.atendimento ?? null,
    quantidade_produzida: p.quantidade,
    quantidade_perda: p.perda,
    produzido_em: coluna(p.agora),
    validade_em: coluna(p.validadeEm),
    valor_adicional: p.valorAdicional,
    valor_total: custo.valorTotal,
    custo_unitario: custo.custoUnitario,
    responsavel_profissional_id: await profissionalDe(tx, est),
    situacao: 'liberado',
  });
  for (const [k, c] of custo.custos.entries())
    await tx.incluir('lote_produzido_custo', {
      lote_produzido_id: id,
      sequencia: k + 1,
      custo_indireto_producao_id: c.custo,
      quantidade: c.quantidade,
      valor_unitario: c.valorUnitario,
      valor_total: c.valorTotal,
    });
  return {
    id,
    numeroLote: p.numeroLote,
    loteEstoque,
    movimento: mov.id,
    valorInsumos: Math.round(p.valorInsumos * 100) / 100,
    valorIndireto: custo.valorIndireto,
    valorAdicional: p.valorAdicional,
    valorTotal: custo.valorTotal,
    custoUnitario: custo.custoUnitario,
    saidaPaciente: null,
  };
}

export class PortaProducaoInternaPropria implements PortaProducaoInterna {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private contexto(c: ContextoPortaM18): ContextoNucleo & { estabelecimento: number } {
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return {
      cliente: c.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: c.correlacao || 'producao-interna',
    };
  }

  private async executar(
    c: ContextoPortaM18,
    nome: string,
    entrada: Record<string, unknown>,
    chave: string,
    gravar: (tx: TxOperacao, est: number) => Promise<LoteProduzidoGravado>,
  ): Promise<LoteProduzidoGravado> {
    const ctxN = this.contexto(c);
    const op = definirOperacao({
      nome,
      tabelas: [...TABELAS_PRODUCAO_INTERNA],
      entrada: z.unknown(),
      gravar: (tx: TxOperacao) => gravar(tx, ctxN.estabelecimento),
      alvo: (_e, r: LoteProduzidoGravado) => ({ tabela: 'lote_produzido', id: r.id }),
      trilha: () => ({ dados: entrada, motivo: null }),
    });
    const ctx: ContextoOperacao = { ...ctxN, chaveIdempotencia: chave };
    const { resultado } = await this.executor.executar(op, c.cliente, entrada, ctx);
    return resultado as LoteProduzidoGravado;
  }

  painel(c: ContextoPortaM18, de: string, ate: string): Promise<PainelProducaoInterna> {
    const ctx = this.contexto(c);
    const est = ctx.estabelecimento;
    return this.nucleo.lerSomente(ctx, async (l) => {
      const { hoje, agora } = await relogio(l, est);
      const aFechar = await l.consultar<Linha>(
        `SELECT o.id, o.numero, o.versao, o.finalidade, o.insumo_id, i.nome, o.quantidade_prevista,
                o.valor_custo_total, o.validade_em
           FROM ordem_manipulacao o JOIN insumo i ON i.id = o.insumo_id
          WHERE o.estabelecimento_id = ? AND o.situacao = 'baixada' AND o.lote_produzido_id IS NULL
            AND o.excluido_em IS NULL
          ORDER BY o.id LIMIT 200`,
        [est],
      );
      const custos = await l.consultar<Linha>(
        `SELECT c.id, c.descricao,
                (SELECT v.valor FROM custo_indireto_producao_valor v
                  WHERE v.custo_indireto_producao_id = c.id AND v.estabelecimento_id = ? AND v.vigencia_inicio <= ?
                    AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= ?)
                  ORDER BY v.vigencia_inicio DESC LIMIT 1) AS valor
           FROM custo_indireto_producao c WHERE c.ativo ORDER BY c.descricao LIMIT 100`,
        [est, hoje, hoje],
      );
      const kits = await l.consultar<Linha>(
        `SELECT k.id, k.codigo, k.nome FROM kit_material k
          WHERE k.estabelecimento_id = ? AND k.ativo AND k.excluido_em IS NULL ORDER BY k.nome LIMIT 200`,
        [est],
      );
      const itens = kits.length
        ? await l.consultar<Linha>(
            `SELECT ki.kit_material_id, ki.insumo_id, i.nome, ki.quantidade
               FROM kit_material_item ki JOIN insumo i ON i.id = ki.insumo_id
              WHERE ki.kit_material_id IN (${kits.map(() => '?').join(', ')}) AND ki.excluido_em IS NULL
              ORDER BY ki.sequencia`,
            kits.map((k) => k['id']),
          )
        : [];
      const locais = await l.consultar<Linha>(
        `SELECT id, nome FROM local_estoque
          WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL ORDER BY nome LIMIT 200`,
        [est],
      );
      const lotes = await l.consultar<Linha>(
        `SELECT lp.id, lp.tipo, lp.numero_lote, lp.insumo_id, i.nome AS produto_nome, lp.local_estoque_id,
                lp.ordem_manipulacao_id, o.numero AS ordem_numero, lp.kit_material_id, k.nome AS kit_nome,
                lp.quantidade_produzida, lp.quantidade_perda, lp.produzido_em, lp.validade_em, lp.valor_total,
                lp.custo_unitario, lp.situacao
           FROM lote_produzido lp
           JOIN insumo i ON i.id = lp.insumo_id
           LEFT JOIN ordem_manipulacao o ON o.id = lp.ordem_manipulacao_id
           LEFT JOIN kit_material k ON k.id = lp.kit_material_id
          WHERE lp.estabelecimento_id = ? AND lp.produzido_em >= ? AND lp.produzido_em < ? + INTERVAL 1 DAY
            AND lp.excluido_em IS NULL
          ORDER BY lp.produzido_em DESC, lp.id DESC LIMIT ${TETO_LOTES}`,
        [est, de, ate],
      );
      const custosLote = lotes.length
        ? await l.consultar<Linha>(
            `SELECT lc.lote_produzido_id, c.descricao, lc.valor_total
               FROM lote_produzido_custo lc JOIN custo_indireto_producao c ON c.id = lc.custo_indireto_producao_id
              WHERE lc.lote_produzido_id IN (${lotes.map(() => '?').join(', ')}) AND lc.excluido_em IS NULL
              ORDER BY lc.sequencia`,
            lotes.map((x) => x['id']),
          )
        : [];
      return {
        hoje,
        agora,
        aFechar: aFechar.map((o) => ({
          id: n(o['id']),
          numero: n(o['numero']),
          versao: n(o['versao']),
          finalidade: String(o['finalidade']),
          produto: n(o['insumo_id']),
          produtoNome: String(o['nome']),
          quantidadePrevista: n(o['quantidade_prevista']),
          valorInsumos: n(o['valor_custo_total']),
          validadeSugerida: o['validade_em'] ? instante(o['validade_em']) : null,
        })),
        custos: custos.map((x) => ({
          id: n(x['id']),
          descricao: String(x['descricao']),
          valor: nn(x['valor']),
        })),
        kits: kits.map((k) => ({
          id: n(k['id']),
          codigo: String(k['codigo']),
          nome: String(k['nome']),
          componentes: itens
            .filter((x) => n(x['kit_material_id']) === n(k['id']))
            .map((x) => ({
              insumo: n(x['insumo_id']),
              nome: String(x['nome']),
              quantidade: n(x['quantidade']),
            })),
        })),
        locais: locais.map((x) => ({ id: n(x['id']), nome: String(x['nome']) })),
        lotes: lotes.map((x) => ({
          id: n(x['id']),
          tipo: String(x['tipo']) as TipoLoteProduzido,
          numeroLote: String(x['numero_lote']),
          produto: n(x['insumo_id']),
          produtoNome: String(x['produto_nome']),
          local: n(x['local_estoque_id']),
          ordem: nn(x['ordem_manipulacao_id']),
          ordemNumero: nn(x['ordem_numero']),
          kit: nn(x['kit_material_id']),
          kitNome: x['kit_nome'] === null ? null : String(x['kit_nome']),
          quantidadeProduzida: n(x['quantidade_produzida']),
          perda: n(x['quantidade_perda']),
          produzidoEm: instante(x['produzido_em']),
          validadeEm: instante(x['validade_em']),
          valorTotal: n(x['valor_total']),
          custoUnitario: nn(x['custo_unitario']),
          situacao: String(x['situacao']),
          custos: custosLote
            .filter((c) => n(c['lote_produzido_id']) === n(x['id']))
            .map((c) => ({ descricao: String(c['descricao']), valorTotal: n(c['valor_total']) })),
        })),
      };
    });
  }

  fecharOrdem(
    c: ContextoPortaM18,
    ordem: number,
    e: FechamentoProducaoEntrada,
    chave: string,
  ): Promise<LoteProduzidoGravado> {
    const entrada = { ordem, ...e, custos: e.custos.map((x) => ({ ...x })) };
    return this.executar(c, OPERACOES_PRODUCAO_INTERNA.fechar, entrada, chave, async (tx, est) => {
      const [o] = await tx.consultarParaAtualizar<Linha>(
        `SELECT id, versao, situacao, finalidade, insumo_id, unidade_medida_id, local_estoque_id, quantidade_prevista,
                valor_custo_total, lote_produzido_id, formula_padrao_manipulacao_id, atendimento_id, paciente_id,
                prescricao_item_id
           FROM ordem_manipulacao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [ordem, est],
      );
      if (!o) throw recusa('ordem-inexistente', 'A ordem de manipulação não existe.', { campos: ['ordem'] });
      if (n(o['versao']) !== e.versaoVista)
        throw recusa('ordem-mudou', 'A ordem de manipulação mudou em outra tela: recarregue e confira.');
      const { hoje, agora } = await relogio(tx, est);
      recusarTodas(
        conferirFechamentoProducao({
          situacao: String(o['situacao']),
          jaTemLote: o['lote_produzido_id'] !== null,
          quantidadePrevista: n(o['quantidade_prevista']),
          quantidadeProduzida: e.quantidadeProduzida,
          perda: e.perda,
          produzidoEm: agora,
          validadeEm: e.validadeEm,
          numeroLote: e.numeroLote,
          custos: e.custos.map((x) => ({ ...x, valorUnitario: 0 })),
        }),
      );
      // A dose de um paciente nunca vai ao saldo livre: a finalidade decide o destino (domínio).
      const d = destinoDoLoteProduzido({
        finalidade: String(o['finalidade']),
        paciente: nn(o['paciente_id']),
        atendimento: nn(o['atendimento_id']),
        prescricaoItem: nn(o['prescricao_item_id']),
      });
      recusarTodas(d.recusas);
      const destino = d.destino!;
      await exigirMesAberto(tx, est, hoje);
      await insumoAtivo(tx, n(o['insumo_id']));
      const custos = await custosVigentes(tx, est, hoje, e.custos);
      const r = await gravarLote(tx, est, {
        tipo: 'manipulacao',
        produto: n(o['insumo_id']),
        unidade: n(o['unidade_medida_id']),
        local: n(o['local_estoque_id']),
        quantidade: e.quantidadeProduzida,
        perda: e.perda,
        agora,
        hoje,
        validadeEm: e.validadeEm,
        numeroLote: await numeroDoLote(tx, est, 'manipulacao', hoje, e.numeroLote),
        valorInsumos: n(o['valor_custo_total']),
        custos,
        valorAdicional: e.valorAdicional,
        ordem,
        formula: nn(o['formula_padrao_manipulacao_id']),
        atendimento: nn(o['atendimento_id']),
        paciente: nn(o['paciente_id']),
      });
      let saidaPaciente: number | null = null;
      if (destino.tipo === 'paciente') {
        const saida = await movimentar(tx, est, {
          local: n(o['local_estoque_id']),
          insumo: n(o['insumo_id']),
          quantidade: e.quantidadeProduzida,
          natureza: 'saida',
          tipoMovimento: await tipoMovimentoId(tx, TIPO_MOVIMENTO_PRODUCAO.dosePaciente),
          lotes: [{ id: r.loteEstoque, quantidade: e.quantidadeProduzida }],
          hoje,
          atendimento: destino.atendimento,
          paciente: destino.paciente,
          faturavel: destino.atendimento !== null,
        });
        saidaPaciente = saida.id;
      }
      await tx.alterar('ordem_manipulacao', ordem, n(o['versao']), {
        lote_produzido_id: r.id,
        quantidade_produzida: e.quantidadeProduzida,
        quantidade_perda: e.perda,
        validade_em: coluna(e.validadeEm),
      });
      return { ...r, saidaPaciente };
    });
  }

  montarKit(c: ContextoPortaM18, e: MontagemKitEntrada, chave: string): Promise<LoteProduzidoGravado> {
    const entrada = { ...e, custos: e.custos.map((x) => ({ ...x })) };
    return this.executar(c, OPERACOES_PRODUCAO_INTERNA.montar, entrada, chave, async (tx, est) => {
      const kit = await tx.uma<Linha>(
        'SELECT id, ativo FROM kit_material WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [e.kit, est],
      );
      if (!kit)
        throw recusa('kit-inexistente', 'O kit padrão não existe neste estabelecimento.', {
          campos: ['kit'],
        });
      await localDoEstabelecimento(tx, est, e.local);
      const produto = await insumoAtivo(tx, e.produto);
      const itens = await tx.consultar<Linha>(
        `SELECT ki.insumo_id, i.nome, ki.quantidade,
                COALESCE((SELECT s.quantidade FROM saldo_estoque s
                           WHERE s.local_estoque_id = ? AND s.insumo_id = ki.insumo_id AND s.estabelecimento_id = ?
                             AND s.excluido_em IS NULL), 0) AS saldo
           FROM kit_material_item ki JOIN insumo i ON i.id = ki.insumo_id
          WHERE ki.kit_material_id = ? AND ki.excluido_em IS NULL ORDER BY ki.sequencia`,
        [e.local, est, e.kit],
      );
      const componentes = itens.map((x) => ({
        insumo: n(x['insumo_id']),
        nome: String(x['nome']),
        quantidade: n(x['quantidade']),
        saldo: n(x['saldo']),
      }));
      const { hoje, agora } = await relogio(tx, est);
      recusarTodas(
        conferirMontagemKit({
          kitAtivo: kit['ativo'] === true || kit['ativo'] === 1 || kit['ativo'] === '1',
          produto: e.produto,
          componentes,
          quantidadeKits: e.quantidadeKits,
          produzidoEm: agora,
          validadeEm: e.validadeEm,
          numeroLote: e.numeroLote,
          custos: e.custos.map((x) => ({ ...x, valorUnitario: 0 })),
        }),
      );
      await exigirMesAberto(tx, est, hoje);
      const consumo = await tipoMovimentoId(tx, TIPO_MOVIMENTO_PRODUCAO.consumo);
      let valorInsumos = 0;
      const validades: string[] = [];
      for (const u of consumoDaMontagem(componentes, e.quantidadeKits)) {
        const ins = await insumoAtivo(tx, u.insumo);
        const lotes = await lotesDaSaida(tx, est, e.local, ins, u.quantidade, [], hoje);
        if (lotes.length) {
          const vs = await tx.consultar<Linha>(
            `SELECT DATE_FORMAT(validade, '%Y-%m-%d') AS v FROM lote_insumo WHERE id IN (${lotes.map(() => '?').join(', ')})`,
            lotes.map((x) => x.id),
          );
          validades.push(...vs.map((x) => String(x['v'])));
        }
        const mov = await movimentar(tx, est, {
          local: e.local,
          insumo: u.insumo,
          quantidade: u.quantidade,
          natureza: 'saida',
          tipoMovimento: consumo,
          lotes,
          hoje,
        });
        valorInsumos += mov.valor;
      }
      recusarTodas(conferirValidadeDoKit(e.validadeEm, validades));
      const custos = await custosVigentes(tx, est, hoje, e.custos);
      return gravarLote(tx, est, {
        tipo: 'kit_montado',
        produto: e.produto,
        unidade: n(produto['estoque_unidade_medida_id']),
        local: e.local,
        quantidade: e.quantidadeKits,
        perda: 0,
        agora,
        hoje,
        validadeEm: e.validadeEm,
        numeroLote: await numeroDoLote(tx, est, 'kit_montado', hoje, e.numeroLote),
        valorInsumos,
        custos,
        valorAdicional: e.valorAdicional,
        kit: e.kit,
      });
    });
  }
}
