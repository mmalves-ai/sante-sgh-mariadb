// Porta da rouparia e lavanderia sobre o banco do cliente (M55), pelo @sgh/nucleo. Cada movimento da tela vai ao
// documento próprio do modelo: coleta → coleta_roupa_suja; envio → remessa_lavanderia; retorno → retorno_lavanderia e
// retorno_lavanderia_item; entrega → distribuicao_enxoval e distribuicao_enxoval_item; perda → baixa_enxoval e
// baixa_enxoval_item (um documento por perda; por ora de uma peça só, com o item 1; motivo do cadastro motivo_baixa_enxoval). O enxoval é peca_enxoval (da rede inteira: não tem
// estabelecimento) e as cotas, cota_enxoval_setor (por vigência). O "centro de custo" da tela é o setor
// (setor_funcional) e o "fornecedor", a lavanderia terceirizada (lavanderia_externa). Toda leitura filtra o
// estabelecimento da sessão e os excluídos; as gravações vão numa operação do Executor (trilha, outbox e idempotência
// na mesma transação), com a trava otimista pela versão.
// O número do movimento na tela compõe o documento e o tipo (id × 8 + tipo): os documentos são tabelas próprias. A
// lista sai em ordem cronológica (instante, depois número) e pagina por cursor composto (instante, número).
// Melhoria: cota com vigência (a mudança fecha a cota anterior e abre a nova, com histórico); retorno grava a
// diferença no sentido do modelo (retorno − envio) e a divergência; remessa e baixa com número de negócio; a perda
// baixa cada peça com o motivo cadastrado e o custo estimado pelo custo unitário; o relógio é o do fuso do
// estabelecimento; a repetição do pedido é a idempotência do Executor.
// O modelo da onda 2 (09_HOT/05) trouxe o inventário do enxoval, a composição do kit, as peças do envio, os itens da
// baixa, o retorno vigente por envio e o motivo do cancelamento em todos os documentos (este já gravado aqui). Falta a
// porta usar o resto: até lá, o inventário, o kit e a perda de várias peças recusam com "modelo-pendente", e o envio que
// já teve um retorno (mesmo cancelado) recusa um novo retorno com mensagem de negócio (cancele o envio e registre outro).
import { randomUUID } from 'node:crypto';
import type {
  CategoriaPecaRoupa,
  CotaRoupa,
  KgSetorDia,
  Lavanderia,
  MotivoPerdaRoupa,
  MovimentoRoupa,
  PecaRoupa,
  TipoMovimentoRoupa,
} from '@sgh/contratos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { type ContextoPortaM18, portaIndisponivel, type TrilhaDaGravacao } from '../exames/public-api.js';
import {
  type ContextoRouparia,
  type FiltroMovimentosPorta,
  type GravadorRouparia,
  METODOS_PORTA_ROUPARIA,
  type MovimentoRoupaNovo,
  type PecaRoupaGravada,
  type PortaRouparia,
  type SetorRouparia,
  type TotaisRouparia,
} from './porta.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoRouparia = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const textoN = (v: unknown) => (v === null || v === undefined ? null : String(v));
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';
const kg3 = (v: number) => Math.round(v * 1000) / 1000;
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');

const FUSO_PADRAO = 'America/Sao_Paulo';
const SEM_EXECUTOR =
  'A rouparia não tem operação declarada no catálogo: grava pela gravação direta da porta.';

/** Tipo do movimento ↔ dígito do número composto (id × 8 + dígito). */
const DIGITO: Readonly<Record<TipoMovimentoRoupa, number>> = {
  coleta: 1,
  envio: 2,
  retorno: 3,
  entrega: 4,
  perda: 5,
  inventario: 6,
};
const TIPO_DO_DIGITO = Object.fromEntries(Object.entries(DIGITO).map(([t, d]) => [d, t])) as Record<
  number,
  TipoMovimentoRoupa
>;
export const numeroDoMovimento = (tipo: TipoMovimentoRoupa, id: number) => id * 8 + DIGITO[tipo];
export function documentoDoMovimento(numero: number): { tipo: TipoMovimentoRoupa; id: number } | null {
  const tipo = TIPO_DO_DIGITO[numero % 8];
  const id = Math.floor(numero / 8);
  return tipo && id > 0 ? { tipo, id } : null;
}

/** Categoria da tela ↔ do modelo. */
const CATEGORIA_NO_MODELO = (c: CategoriaPecaRoupa) => c.replace(/-/g, '_');
const CATEGORIA_NA_TELA = (c: unknown) => texto(c).replace(/_/g, '-') as CategoriaPecaRoupa;

/** As tabelas que a gravação da rouparia pode tocar. */
const TABELAS = [
  'peca_enxoval',
  'cota_enxoval_setor',
  'coleta_roupa_suja',
  'remessa_lavanderia',
  'retorno_lavanderia',
  'retorno_lavanderia_item',
  'distribuicao_enxoval',
  'distribuicao_enxoval_item',
  'baixa_enxoval',
  'baixa_enxoval_item',
  'sequencia_negocio',
];

const modeloPendente = (detalhe: string) =>
  new ErroOperacao(409, 'modelo-pendente', 'Recurso aguardando o modelo do banco', detalhe);

/** Relógio civil no fuso do estabelecimento ("AAAA-MM-DD" e "AAAA-MM-DDTHH:MM:SS"). */
export function relogioNoFuso(fuso: string, agora: Date = new Date()): { hoje: string; agora: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: fuso,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(agora)
      .map((x) => [x.type, x.value]),
  );
  const hoje = `${p['year']}-${p['month']}-${p['day']}`;
  return { hoje, agora: `${hoje}T${p['hour']}:${p['minute']}:${p['second']}` };
}

const paraBanco = (iso: string) => iso.replace('T', ' ');
const diaSeguinte = (d: string) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const diaAnterior = (d: string) =>
  new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

// Os documentos no formato comum do movimento (o número composto é calculado aqui; DATETIME civil em texto).
const DATA = (c: string) => `DATE_FORMAT(${c}, '%Y-%m-%d')`;
const INSTANTE = (c: string) => `DATE_FORMAT(${c}, '%Y-%m-%dT%H:%i:%s')`;
const SQL_DOCUMENTOS = `
  SELECT c.id * 8 + 1 AS numero, 'coleta' AS tipo, ${DATA('c.coletado_em')} AS data, ${INSTANTE('c.coletado_em')} AS em,
         c.setor_funcional_id AS setor, NULL AS remessa, c.peso_kg AS peso, COALESCE(c.quantidade_pecas, 0) AS pecas,
         NULL AS lavanderia, NULL AS fornecedor, NULL AS motivo_perda, NULL AS dif_kg, NULL AS dif_pct, 0 AS ocorrencia,
         c.observacao, IF(c.situacao = 'cancelada', 'cancelado', 'registrado') AS situacao,
         c.responsavel_usuario_id AS por_id, IF(c.situacao = 'cancelada', c.alterado_por, NULL) AS cancelado_por_id,
         IF(c.situacao = 'cancelada', ${INSTANTE('c.alterado_em')}, NULL) AS cancelado_em, NULL AS motivo_cancelamento,
         c.versao
    FROM coleta_roupa_suja c WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL
  UNION ALL
  SELECT r.id * 8 + 2, 'envio', ${DATA('r.enviada_em')}, ${INSTANTE('r.enviada_em')}, NULL, NULL, r.peso_total_kg,
         COALESCE(r.quantidade_pecas, 0), r.tipo_lavanderia, r.lavanderia_externa_id, NULL, NULL, NULL, 0,
         r.observacao, r.situacao, r.responsavel_usuario_id, IF(r.situacao = 'cancelado', r.alterado_por, NULL),
         ${INSTANTE('r.cancelado_em')}, r.motivo_cancelamento, r.versao
    FROM remessa_lavanderia r WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL
  UNION ALL
  SELECT t.id * 8 + 3, 'retorno', ${DATA('t.retornado_em')}, ${INSTANTE('t.retornado_em')}, NULL,
         t.remessa_lavanderia_id * 8 + 2, t.peso_total_kg, COALESCE(t.quantidade_pecas, 0), NULL, NULL, NULL,
         t.diferenca_peso_kg, t.percentual_diferenca, t.divergente, t.observacao,
         IF(t.situacao = 'cancelado', 'cancelado', 'registrado'), t.conferente_usuario_id,
         IF(t.situacao = 'cancelado', t.alterado_por, NULL), ${INSTANTE('t.cancelado_em')}, t.motivo_cancelamento,
         t.versao
    FROM retorno_lavanderia t WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL
  UNION ALL
  SELECT d.id * 8 + 4, 'entrega', ${DATA('d.distribuido_em')}, ${INSTANTE('d.distribuido_em')}, d.setor_funcional_id,
         NULL, d.peso_kg,
         (SELECT COALESCE(SUM(i.quantidade_entregue), 0) FROM distribuicao_enxoval_item i
           WHERE i.distribuicao_enxoval_id = d.id AND i.excluido_em IS NULL),
         NULL, NULL, NULL, NULL, NULL, 0, d.observacao, IF(d.situacao = 'cancelada', 'cancelado', 'registrado'),
         d.entregador_usuario_id, IF(d.situacao = 'cancelada', d.alterado_por, NULL),
         IF(d.situacao = 'cancelada', ${INSTANTE('d.alterado_em')}, NULL), NULL, d.versao
    FROM distribuicao_enxoval d WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL
  UNION ALL
  SELECT b.id * 8 + 5, 'perda', ${DATA('b.data_baixa')}, ${INSTANTE('b.data_baixa')}, b.setor_funcional_id, NULL,
         NULL, (SELECT SUM(bi.quantidade) FROM baixa_enxoval_item bi
                  WHERE bi.baixa_enxoval_id = b.id AND bi.excluido_em IS NULL), NULL, NULL, mb.categoria, NULL, NULL, 0, b.observacao,
         IF(b.situacao = 'cancelada', 'cancelado', 'registrado'), b.responsavel_usuario_id,
         IF(b.situacao = 'cancelada', b.alterado_por, NULL),
         IF(b.situacao = 'cancelada', ${INSTANTE('b.alterado_em')}, NULL), NULL, b.versao
    FROM baixa_enxoval b JOIN motivo_baixa_enxoval mb ON mb.id = b.motivo_baixa_enxoval_id
   WHERE b.estabelecimento_id = ? AND b.excluido_em IS NULL`;

/** Os movimentos com os filtros (as condições sobre as colunas comuns; parâmetros literais). */
function sqlMovimentos(condicoes: readonly string[], ordem = 'm.em DESC, m.numero DESC'): string {
  return `
  SELECT m.*, u.login AS por, uc.login AS cancelado_por
    FROM (${SQL_DOCUMENTOS}) m
    LEFT JOIN usuario u ON u.id = m.por_id
    LEFT JOIN usuario uc ON uc.id = m.cancelado_por_id
   ${condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : ''}
   ORDER BY ${ordem}`;
}

export class PortaRoupariaPropria implements PortaRouparia {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoRouparia,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPortaM18, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c), (l) => fn(l, est));
  }

  async podeGravar() {
    return { pode: false, codigo: 'sem-operacao', motivo: SEM_EXECUTOR };
  }

  executar(): Promise<never> {
    return Promise.reject(recusa('sem-operacao', SEM_EXECUTOR));
  }

  async gravarSgh<T>(
    c: ContextoRouparia,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorRouparia) => Promise<T>,
  ): Promise<T> {
    const est = c.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    let saida: { valor: T } | null = null;
    const linha = () => (typeof trilha === 'function' ? (saida ? trilha(saida.valor) : null) : trilha);
    const pedido = c.pedido;
    const op = definirOperacao({
      nome: pedido ? 'rouparia.registrar-movimento' : 'rouparia.gravacao-direta',
      tabelas: TABELAS,
      entrada: z.object({ impressao: z.string() }),
      gravar: async (tx) => {
        saida = { valor: await fn(gravador(tx, est)) };
        return { valor: saida.valor } as unknown as ResultadoOperacao;
      },
      alvo: () => {
        const l = linha();
        return { tabela: l?.entidade ?? 'rouparia', id: l?.entidadeId ?? null };
      },
      trilha: () => ({ dados: linha()?.dadosDepois ?? null, motivo: linha()?.motivo ?? null }),
    });
    const chave = pedido ? pedido.chave : `direta:${randomUUID()}`;
    const ctx: ContextoOperacao = {
      ...contextoDe(c),
      correlacao: c.correlacao || 'rouparia',
      chaveIdempotencia: chave,
    };
    try {
      const r = await this.executor.executar(op, c.cliente, { impressao: pedido?.impressao ?? chave }, ctx);
      const valor = (r.resultado as unknown as { valor: T }).valor;
      if (r.repetida)
        return (valor !== null && typeof valor === 'object' ? { ...valor, repetida: true } : valor) as T;
      return valor;
    } catch (e) {
      if (e instanceof ErroOperacao && e.problema['codigo'] === 'idempotencia-divergente')
        throw recusa('chave-de-outro-movimento', 'A chave do pedido já foi usada em outro movimento.');
      throw e;
    }
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────

  relogio(c: ContextoPortaM18) {
    return this.ler(c, async (l, est) => relogioNoFuso(await fusoDe(l, est)));
  }

  pecas(c: ContextoPortaM18): Promise<PecaRoupa[]> {
    // O enxoval é da rede inteira (peca_enxoval não tem estabelecimento): o cadastro vale para todos.
    return this.ler(c, (l) => pecasDe(l));
  }

  cotas(c: ContextoPortaM18, centro?: number | null): Promise<CotaRoupa[]> {
    return this.ler(c, async (l, est) => {
      const { hoje } = relogioNoFuso(await fusoDe(l, est));
      const temSetor = centro !== null && centro !== undefined;
      const linhas = await l.consultar(
        `SELECT setor_funcional_id, peca_enxoval_id, quantidade, versao FROM cota_enxoval_setor
          WHERE estabelecimento_id = ? AND ativo AND turno = 'integral' AND vigencia_inicio <= ?
            AND (vigencia_fim IS NULL OR vigencia_fim >= ?) ${temSetor ? 'AND setor_funcional_id = ?' : ''}
          ORDER BY setor_funcional_id, peca_enxoval_id`,
        temSetor ? [est, hoje, hoje, centro] : [est, hoje, hoje],
      );
      return linhas.map((x) => ({
        centroCusto: n(x['setor_funcional_id']),
        peca: n(x['peca_enxoval_id']),
        quantidade: n(x['quantidade']),
        versao: n(x['versao']),
      }));
    });
  }

  movimentos(c: ContextoPortaM18, f: FiltroMovimentosPorta) {
    const teto = f.teto ?? 200;
    return this.ler(c, async (l, est) => {
      const cond = ['m.data >= ?', 'm.data <= ?'];
      const p: unknown[] = [est, est, est, est, est, f.de, f.ate];
      if (f.tipo) {
        cond.push('m.tipo = ?');
        p.push(f.tipo);
      }
      if (f.centroCusto !== null && f.centroCusto !== undefined) {
        cond.push('m.setor = ?');
        p.push(f.centroCusto);
      }
      if (f.antesDe) {
        // Cursor composto (instante, número): o número sozinho não é cronológico entre documentos de tabelas
        // diferentes.
        const [ref] = await l.consultar(sqlMovimentos(['m.numero = ?']), [
          est,
          est,
          est,
          est,
          est,
          f.antesDe,
        ]);
        if (!ref) return { itens: [], cortada: false };
        cond.push('(m.em < ? OR (m.em = ? AND m.numero < ?))');
        p.push(texto(ref['em']), texto(ref['em']), f.antesDe);
      }
      const linhas = await l.consultar(`${sqlMovimentos(cond)} LIMIT ${teto + 1}`, p);
      const itens = await comItens(l, linhas.slice(0, teto));
      return { itens, cortada: linhas.length > teto };
    });
  }

  movimento(c: ContextoPortaM18, id: number) {
    return this.ler(c, (l, est) => movimentoDe(l, est, id));
  }

  enviosAbertos(c: ContextoPortaM18) {
    return this.ler(c, async (l, est) =>
      comItens(
        l,
        await l.consultar(
          sqlMovimentos(["m.tipo = 'envio'", "m.situacao = 'registrado'"], 'm.em, m.numero'),
          [est, est, est, est, est],
        ),
      ),
    );
  }

  kgPorSetorDia(c: ContextoPortaM18, de: string, ate: string): Promise<KgSetorDia[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT ${DATA('coletado_em')} AS data, setor_funcional_id, SUM(peso_kg) AS kg, COUNT(*) AS coletas
             FROM coleta_roupa_suja
            WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'cancelada'
              AND coletado_em >= ? AND coletado_em < ?
            GROUP BY data, setor_funcional_id ORDER BY data, setor_funcional_id`,
          [est, de, diaSeguinte(ate)],
        )
      ).map((x) => ({
        data: texto(x['data']),
        centroCusto: n(x['setor_funcional_id']),
        kg: kg3(n(x['kg'])),
        coletas: n(x['coletas']),
      })),
    );
  }

  totais(c: ContextoPortaM18, de: string, ate: string): Promise<TotaisRouparia> {
    return this.ler(c, async (l, est) => {
      const fim = diaSeguinte(ate);
      const um = async (sql: string) => (await l.uma(sql, [est, de, fim])) ?? {};
      const [col, env, ret, per] = await Promise.all([
        um(`SELECT COALESCE(SUM(peso_kg), 0) AS kg FROM coleta_roupa_suja WHERE estabelecimento_id = ?
             AND excluido_em IS NULL AND situacao <> 'cancelada' AND coletado_em >= ? AND coletado_em < ?`),
        um(`SELECT COALESCE(SUM(peso_total_kg), 0) AS kg FROM remessa_lavanderia WHERE estabelecimento_id = ?
             AND excluido_em IS NULL AND situacao <> 'cancelado' AND enviada_em >= ? AND enviada_em < ?`),
        um(`SELECT COALESCE(SUM(peso_total_kg), 0) AS kg, COUNT(*) AS retornos, COALESCE(SUM(divergente), 0) AS ocorrencias
              FROM retorno_lavanderia WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'cancelado'
               AND retornado_em >= ? AND retornado_em < ?`),
        um(`SELECT COALESCE(SUM(bi.quantidade), 0) AS pecas
              FROM baixa_enxoval b JOIN baixa_enxoval_item bi ON bi.baixa_enxoval_id = b.id AND bi.excluido_em IS NULL
             WHERE b.estabelecimento_id = ? AND b.excluido_em IS NULL AND b.situacao <> 'cancelada'
               AND b.data_baixa >= ? AND b.data_baixa < ?`),
      ]);
      return {
        kgColetados: kg3(n(col['kg'])),
        kgEnviados: kg3(n(env['kg'])),
        kgRetornados: kg3(n(ret['kg'])),
        pecasPerdidas: n(per['pecas']),
        retornos: n(ret['retornos']),
        ocorrencias: n(ret['ocorrencias']),
      };
    });
  }

  /** O inventário do enxoval aguarda a tabela no modelo (pedido inventario_enxoval): nenhuma contagem lida. */
  async inventarios(): Promise<MovimentoRoupa[]> {
    return [];
  }

  setores(c: ContextoPortaM18): Promise<SetorRouparia[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          'SELECT id, nome, ativo FROM setor_funcional WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY nome, id',
          [est],
        )
      ).map((x) => ({ codigo: n(x['id']), nome: texto(x['nome']), ativo: verdadeiro(x['ativo']) })),
    );
  }

  fornecedores(c: ContextoPortaM18, termo: string) {
    const t = termo.trim();
    const codigo = /^\d{1,15}$/.test(t) ? Number(t) : 0;
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT id, nome FROM lavanderia_externa
            WHERE estabelecimento_id = ? AND excluido_em IS NULL AND ativo AND tipo = 'terceirizada'
              AND (id = ? OR nome LIKE ?) ORDER BY nome, id LIMIT 20`,
          [est, codigo, `%${t.replace(/[\\%_]/g, (x) => `\\${x}`)}%`],
        )
      ).map((x) => ({ codigo: n(x['id']), nome: texto(x['nome']) })),
    );
  }

  fornecedorExiste(c: ContextoPortaM18, codigo: number) {
    return this.ler(c, async (l, est) => (await lavanderiaAtiva(l, est, codigo)) !== null);
  }

  pacientesDia(c: ContextoPortaM18, de: string, ate: string) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT COALESCE(SUM(pacientes_dia), 0) AS total FROM fechamento_censo
          WHERE estabelecimento_id = ? AND situacao = 'fechado' AND data_referencia BETWEEN ? AND ?`,
        [est, de, ate],
      );
      return n(r?.['total']);
    });
  }
}

// ── Leituras comuns (fora e dentro da transação) ────────────────────────────────────────────────────────────

async function fusoDe(l: Leitor, est: number): Promise<string> {
  const r = await l.uma<{ fuso_horario: string | null }>(
    'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
    [est],
  );
  return r?.fuso_horario || FUSO_PADRAO;
}

async function pecasDe(l: Leitor): Promise<PecaRoupa[]> {
  return (
    await l.consultar(
      `SELECT id, descricao, categoria, peso_gramas, custo_unitario, ativo, versao FROM peca_enxoval
        WHERE excluido_em IS NULL ORDER BY ativo DESC, descricao, id`,
    )
  ).map((x) => ({
    id: n(x['id']),
    nome: texto(x['descricao']),
    categoria: CATEGORIA_NA_TELA(x['categoria']),
    pesoGramas: n(x['peso_gramas']),
    custoReposicaoCentavos: x['custo_unitario'] === null ? null : Math.round(n(x['custo_unitario']) * 100),
    // A composição do kit aguarda a tabela no modelo (pedido peca_enxoval_composicao).
    composicao: [],
    ativa: verdadeiro(x['ativo']),
    versao: n(x['versao']),
  }));
}

async function lavanderiaAtiva(l: Leitor, est: number, id: number): Promise<number | null> {
  const r = await l.uma(
    `SELECT id FROM lavanderia_externa WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND ativo
        AND tipo = 'terceirizada'`,
    [id, est],
  );
  return r ? n(r['id']) : null;
}

async function movimentoDe(l: Leitor, est: number, numero: number): Promise<MovimentoRoupa | null> {
  if (!documentoDoMovimento(numero)) return null;
  const [m] = await l.consultar(sqlMovimentos(['m.numero = ?']), [est, est, est, est, est, numero]);
  return m ? ((await comItens(l, [m]))[0] ?? null) : null;
}

/** Os movimentos com as peças de cada documento (retorno, entrega e baixa). */
async function comItens(l: Leitor, linhas: readonly Linha[]): Promise<MovimentoRoupa[]> {
  const ids = (tipo: TipoMovimentoRoupa) =>
    linhas.filter((x) => x['tipo'] === tipo).map((x) => Math.floor(n(x['numero']) / 8));
  const itens = new Map<number, { peca: number; quantidade: number }[]>();
  const juntar = (numero: number, peca: number, quantidade: number) =>
    itens.set(numero, [...(itens.get(numero) ?? []), { peca, quantidade }]);
  const ret = ids('retorno');
  if (ret.length)
    for (const x of await l.consultar(
      `SELECT retorno_lavanderia_id AS doc, peca_enxoval_id, quantidade FROM retorno_lavanderia_item
        WHERE retorno_lavanderia_id IN (${lista(ret.length)}) AND excluido_em IS NULL ORDER BY sequencia`,
      ret,
    ))
      juntar(numeroDoMovimento('retorno', n(x['doc'])), n(x['peca_enxoval_id']), n(x['quantidade']));
  const ent = ids('entrega');
  if (ent.length)
    for (const x of await l.consultar(
      `SELECT distribuicao_enxoval_id AS doc, peca_enxoval_id, quantidade_entregue FROM distribuicao_enxoval_item
        WHERE distribuicao_enxoval_id IN (${lista(ent.length)}) AND excluido_em IS NULL ORDER BY sequencia`,
      ent,
    ))
      juntar(numeroDoMovimento('entrega', n(x['doc'])), n(x['peca_enxoval_id']), n(x['quantidade_entregue']));
  const bx = ids('perda');
  if (bx.length)
    for (const x of await l.consultar(
      `SELECT baixa_enxoval_id AS doc, peca_enxoval_id, quantidade FROM baixa_enxoval_item
        WHERE baixa_enxoval_id IN (${lista(bx.length)}) AND excluido_em IS NULL ORDER BY sequencia`,
      bx,
    ))
      juntar(numeroDoMovimento('perda', n(x['doc'])), n(x['peca_enxoval_id']), n(x['quantidade']));
  return linhas.map((x) => movimentoDaLinha(x, itens.get(n(x['numero'])) ?? []));
}

function movimentoDaLinha(x: Linha, itens: { peca: number; quantidade: number }[]): MovimentoRoupa {
  const dif = nn(x['dif_kg']);
  const pct = nn(x['dif_pct']);
  return {
    id: n(x['numero']),
    tipo: texto(x['tipo']) as TipoMovimentoRoupa,
    data: texto(x['data']),
    em: texto(x['em']),
    centroCusto: nn(x['setor']),
    remessa: nn(x['remessa']),
    pesoKg: x['peso'] === null || x['peso'] === undefined ? null : kg3(n(x['peso'])),
    pecas: n(x['pecas']),
    itens,
    lavanderia: textoN(x['lavanderia']) as Lavanderia | null,
    fornecedor: nn(x['fornecedor']),
    motivoPerda: textoN(x['motivo_perda']) as MotivoPerdaRoupa | null,
    // O modelo guarda retorno − envio; a tela mostra envio − retorno (o que faltou).
    diferencaKg: dif === null ? null : kg3(-dif),
    diferencaPct: pct === null ? null : Math.round(-pct * 100) / 100,
    ocorrencia: verdadeiro(x['ocorrencia']),
    observacao: textoN(x['observacao']),
    situacao: texto(x['situacao']) as MovimentoRoupa['situacao'],
    por: texto(x['por']),
    canceladoPor: textoN(x['cancelado_por']),
    canceladoEm: textoN(x['cancelado_em']),
    motivoCancelamento: textoN(x['motivo_cancelamento']),
    versao: n(x['versao']),
  };
}

// ── Gravador (dentro da operação do Executor) ────────────────────────────────────────────────────────────────

function usuarioDe(tx: TxOperacao): number {
  if (tx.contexto.usuario === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
  return tx.contexto.usuario;
}

async function numero(tx: TxOperacao, tipo: string, prefixo: string, porCliente = false) {
  await garantirSequencia(
    tx,
    { tipo, estabelecimento: porCliente ? null : tx.contexto.estabelecimento, prefixo },
    { usuario: tx.contexto.usuario, agora: new Date() },
  );
  return tx.proximoNumero(tipo, { porCliente });
}

/** O documento travado (FOR UPDATE) no estabelecimento: id, versão e situação. */
async function travarDocumento(tx: TxOperacao, tabela: string, id: number, est: number) {
  const [r] = await tx.consultarParaAtualizar(
    `SELECT id, versao, situacao FROM ${tabela} WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [id, est],
    { teto: 1 },
  );
  return r ? { id: n(r['id']), versao: n(r['versao']), situacao: texto(r['situacao']) } : null;
}

const TABELA_DO_TIPO: Readonly<Record<Exclude<TipoMovimentoRoupa, 'inventario'>, string>> = {
  coleta: 'coleta_roupa_suja',
  envio: 'remessa_lavanderia',
  retorno: 'retorno_lavanderia',
  entrega: 'distribuicao_enxoval',
  perda: 'baixa_enxoval',
};

function gravador(tx: TxOperacao, est: number): GravadorRouparia {
  const relogio = async () => relogioNoFuso(await fusoDe(tx, est));
  /** O instante do documento: agora, se a data é hoje; senão, o início do dia informado (hora civil). */
  const instante = async (data: string) => {
    const r = await relogio();
    return paraBanco(data === r.hoje ? r.agora : `${data}T00:00:00`);
  };

  const camposPeca = (p: PecaRoupaGravada) => {
    if (p.categoria === 'kit')
      throw modeloPendente(
        'O kit do enxoval aguarda a tabela da composição no modelo do banco: cadastre as peças avulsas por enquanto.',
      );
    return {
      descricao: p.nome,
      categoria: CATEGORIA_NO_MODELO(p.categoria),
      peso_gramas: p.pesoGramas,
      custo_unitario: p.custoReposicaoCentavos === null ? null : (p.custoReposicaoCentavos / 100).toFixed(2),
      ativo: p.ativa,
    };
  };

  async function cotaVigente(setor: number, peca: number, hoje: string) {
    const [r] = await tx.consultarParaAtualizar(
      `SELECT id, quantidade, versao, ${DATA('vigencia_inicio')} AS inicio FROM cota_enxoval_setor
        WHERE estabelecimento_id = ? AND setor_funcional_id = ? AND peca_enxoval_id = ? AND turno = 'integral'
          AND ativo AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
        ORDER BY vigencia_inicio DESC LIMIT 1`,
      [est, setor, peca, hoje, hoje],
      { teto: 1 },
    );
    return r
      ? { id: n(r['id']), quantidade: n(r['quantidade']), versao: n(r['versao']), inicio: texto(r['inicio']) }
      : null;
  }

  /** A cota desligada (zero) hoje: a mesma vigência volta a valer (a chave única é setor, peça, turno e início). */
  async function cotaDesligadaHoje(setor: number, peca: number, hoje: string) {
    const [r] = await tx.consultarParaAtualizar(
      `SELECT id, versao FROM cota_enxoval_setor
        WHERE estabelecimento_id = ? AND setor_funcional_id = ? AND peca_enxoval_id = ? AND turno = 'integral'
          AND NOT ativo AND vigencia_inicio = ?`,
      [est, setor, peca, hoje],
      { teto: 1 },
    );
    return r ? { id: n(r['id']), versao: n(r['versao']) } : null;
  }

  async function registrarPerda(m: MovimentoRoupaNovo, usuario: number): Promise<number> {
    const motivo = await tx.uma(
      'SELECT id FROM motivo_baixa_enxoval WHERE ativo AND (codigo = ? OR categoria = ?) ORDER BY codigo = ? DESC, id LIMIT 1',
      [m.motivoPerda, m.motivoPerda, m.motivoPerda],
    );
    if (m.itens.length === 0) throw recusa('perda-sem-peca', 'Informe a peça perdida e a quantidade.');
    if (m.itens.length > 1)
      throw modeloPendente(
        'A perda de várias peças num documento só aguarda os itens da baixa no modelo do banco: registre uma perda por peça.',
      );
    if (!motivo)
      throw recusa(
        'motivo-nao-cadastrado',
        'O motivo da perda não está no cadastro de motivos de baixa do enxoval: cadastre-o antes.',
      );
    const pecas = new Map(
      (
        await tx.consultar(
          `SELECT id, custo_unitario FROM peca_enxoval WHERE id IN (${lista(m.itens.length)}) AND excluido_em IS NULL`,
          m.itens.map((i) => i.peca),
        )
      ).map((x) => [n(x['id']), x['custo_unitario']]),
    );
    const [i] = m.itens as [MovimentoRoupaNovo['itens'][number]];
    const num = await numero(tx, 'baixa_enxoval', 'BX-');
    const custo = pecas.get(i.peca);
    // A baixa é o cabeçalho; a peça, a quantidade e o custo estimado ficam no item (baixa_enxoval_item).
    const id = await tx.incluir('baixa_enxoval', {
      estabelecimento_id: est,
      numero: num.formatado,
      data_baixa: m.data,
      motivo_baixa_enxoval_id: n(motivo['id']),
      setor_funcional_id: m.centroCusto,
      responsavel_usuario_id: usuario,
      observacao: m.observacao,
      situacao: 'registrada',
    });
    await tx.incluir('baixa_enxoval_item', {
      baixa_enxoval_id: id,
      sequencia: 1,
      peca_enxoval_id: i.peca,
      quantidade: i.quantidade,
      custo_estimado: custo === null || custo === undefined ? null : (n(custo) * i.quantidade).toFixed(2),
    });
    return id;
  }

  return {
    relogio,
    pecas: () => pecasDe(tx),

    async movimento(numeroPublico) {
      const doc = documentoDoMovimento(numeroPublico);
      if (!doc || doc.tipo === 'inventario') return null;
      if (!(await travarDocumento(tx, TABELA_DO_TIPO[doc.tipo], doc.id, est))) return null;
      return movimentoDe(tx, est, numeroPublico);
    },

    async incluirPeca(p) {
      const campos = camposPeca(p);
      const codigo = await numero(tx, 'peca_enxoval', 'PE-', true);
      const id = await tx.incluir('peca_enxoval', { codigo: codigo.formatado, ...campos });
      return { id, versao: 1 };
    },

    async alterarPeca(p) {
      const versao = await tx.alterar('peca_enxoval', p.id, p.versaoVista, camposPeca(p));
      return { id: p.id, versao };
    },

    async gravarCotas(c) {
      const { hoje } = await relogio();
      let alteradas = 0;
      for (const q of c.cotas) {
        const atual = await cotaVigente(c.centroCusto, q.peca, hoje);
        if (atual ? atual.quantidade === q.quantidade : q.quantidade === 0) continue;
        if (atual && atual.inicio === hoje) {
          // A cota aberta hoje muda no lugar (a vigência é por dia); zero a desliga.
          await tx.alterar(
            'cota_enxoval_setor',
            atual.id,
            atual.versao,
            q.quantidade === 0 ? { ativo: false } : { quantidade: q.quantidade },
          );
        } else {
          // A cota anterior fecha ontem e a nova vale a partir de hoje (histórico das cotas).
          if (atual)
            await tx.alterar('cota_enxoval_setor', atual.id, atual.versao, {
              vigencia_fim: diaAnterior(hoje),
            });
          const desligada =
            atual || q.quantidade === 0 ? null : await cotaDesligadaHoje(c.centroCusto, q.peca, hoje);
          if (desligada)
            await tx.alterar('cota_enxoval_setor', desligada.id, desligada.versao, {
              ativo: true,
              quantidade: q.quantidade,
            });
          else if (q.quantidade > 0)
            await tx.incluir('cota_enxoval_setor', {
              estabelecimento_id: est,
              setor_funcional_id: c.centroCusto,
              peca_enxoval_id: q.peca,
              turno: 'integral',
              quantidade: q.quantidade,
              vigencia_inicio: hoje,
              ativo: true,
            });
        }
        alteradas++;
      }
      return { alteradas };
    },

    async registrarMovimento(m) {
      const usuario = usuarioDe(tx);
      const em = await instante(m.data);
      const pecas = m.itens.reduce((s, i) => s + i.quantidade, 0);
      let id: number;
      switch (m.tipo) {
        case 'coleta':
          id = await tx.incluir('coleta_roupa_suja', {
            estabelecimento_id: est,
            coletado_em: em,
            setor_funcional_id: m.centroCusto,
            peso_kg: m.pesoKg,
            quantidade_pecas: m.itens.length ? pecas : null,
            classificacao: 'comum',
            responsavel_usuario_id: usuario,
            situacao: 'registrada',
            observacao: m.observacao,
          });
          break;
        case 'envio': {
          if (
            m.lavanderia === 'terceirizada' &&
            (m.fornecedor === null || !(await lavanderiaAtiva(tx, est, m.fornecedor)))
          )
            throw recusa('fornecedor-inexistente', 'O fornecedor escolhido não existe no cadastro.');
          const num = await numero(tx, 'remessa_lavanderia', '');
          id = await tx.incluir('remessa_lavanderia', {
            estabelecimento_id: est,
            numero: num.valor,
            tipo_lavanderia: m.lavanderia,
            lavanderia_externa_id: m.lavanderia === 'terceirizada' ? m.fornecedor : null,
            enviada_em: em,
            peso_total_kg: m.pesoKg,
            quantidade_pecas: m.itens.length ? pecas : null,
            responsavel_usuario_id: usuario,
            situacao: 'registrado',
            observacao: m.observacao,
          });
          break;
        }
        case 'retorno': {
          const doc = m.remessa === null ? null : documentoDoMovimento(m.remessa);
          const envio =
            doc?.tipo === 'envio' ? await travarDocumento(tx, 'remessa_lavanderia', doc.id, est) : null;
          if (!envio || envio.situacao !== 'registrado')
            throw recusa('remessa-ja-retornada', 'Este envio já tem o retorno registrado ou não existe.');
          // Um retorno por envio no modelo (chave única, inclusive o cancelado e o excluído) até o pedido do retorno
          // vigente: recusa com mensagem de negócio em vez de estourar a restrição.
          if (
            await tx.uma('SELECT id FROM retorno_lavanderia WHERE remessa_lavanderia_id = ? LIMIT 1', [
              envio.id,
            ])
          )
            throw recusa(
              'remessa-com-retorno-cancelado',
              'Este envio já teve um retorno, depois cancelado: cancele o envio e registre um novo envio com o retorno.',
            );
          id = await tx.incluir('retorno_lavanderia', {
            estabelecimento_id: est,
            remessa_lavanderia_id: envio.id,
            retornado_em: em,
            peso_total_kg: m.pesoKg,
            quantidade_pecas: m.itens.length ? pecas : null,
            diferenca_peso_kg: m.diferencaKg === null ? null : (-m.diferencaKg).toFixed(4),
            percentual_diferenca: m.diferencaPct === null ? null : (-m.diferencaPct).toFixed(4),
            divergente: m.ocorrencia,
            conferente_usuario_id: usuario,
            situacao: 'conferido',
            observacao: m.observacao,
          });
          for (const [k, i] of m.itens.entries())
            await tx.incluir('retorno_lavanderia_item', {
              retorno_lavanderia_id: id,
              sequencia: k + 1,
              peca_enxoval_id: i.peca,
              quantidade: i.quantidade,
            });
          await tx.alterar('remessa_lavanderia', envio.id, envio.versao, { situacao: 'retornado' });
          break;
        }
        case 'entrega': {
          const { hoje } = await relogio();
          const num = await numero(tx, 'distribuicao_enxoval', 'DE-');
          id = await tx.incluir('distribuicao_enxoval', {
            estabelecimento_id: est,
            numero: num.formatado,
            distribuido_em: em,
            setor_funcional_id: m.centroCusto,
            turno: 'integral',
            peso_kg: m.pesoKg,
            entregador_usuario_id: usuario,
            situacao: 'entregue',
            observacao: m.observacao,
          });
          for (const [k, i] of m.itens.entries()) {
            const cota = m.centroCusto === null ? null : await cotaVigente(m.centroCusto, i.peca, hoje);
            await tx.incluir('distribuicao_enxoval_item', {
              distribuicao_enxoval_id: id,
              sequencia: k + 1,
              peca_enxoval_id: i.peca,
              quantidade_cota: cota?.quantidade ?? null,
              quantidade_entregue: i.quantidade,
            });
          }
          break;
        }
        case 'perda':
          id = await registrarPerda(m, usuario);
          break;
        case 'inventario':
          throw modeloPendente(
            'O inventário do enxoval aguarda a tabela da contagem no modelo do banco: registre a contagem depois.',
          );
      }
      return { id: numeroDoMovimento(m.tipo, id), versao: 1 };
    },

    async cancelarMovimento(c) {
      const doc = documentoDoMovimento(c.id);
      if (!doc || doc.tipo === 'inventario')
        throw new ErroOperacao(
          404,
          'registro-inexistente',
          'Movimento não encontrado',
          'O movimento não existe.',
        );
      const tabela = TABELA_DO_TIPO[doc.tipo];
      const r = await relogio();
      const situacao = {
        coleta: 'cancelada',
        envio: 'cancelado',
        retorno: 'cancelado',
        entrega: 'cancelada',
        perda: 'cancelada',
      }[doc.tipo];
      const versao = await tx.alterar(tabela, doc.id, c.versaoVista, {
        situacao,
        // Todos os documentos guardam o instante e o motivo do cancelamento (CHECK de cancelamento no banco).
        cancelado_em: paraBanco(r.agora),
        motivo_cancelamento: c.motivo,
      });
      if (doc.tipo === 'retorno' && c.remessa !== null) {
        const envio = documentoDoMovimento(c.remessa);
        const e =
          envio?.tipo === 'envio' ? await travarDocumento(tx, 'remessa_lavanderia', envio.id, est) : null;
        if (!e || e.situacao !== 'retornado')
          throw recusa('remessa-inexistente', 'O envio deste retorno não está mais como retornado.');
        await tx.alterar('remessa_lavanderia', e.id, e.versao, { situacao: 'registrado' });
      }
      return { id: c.id, versao };
    },
  };
}

function contextoDe(c: ContextoPortaM18): ContextoNucleo {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: c.correlacao.slice(0, 64),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaRoupariaIndisponivel(): PortaRouparia {
  return portaIndisponivel<PortaRouparia>(METODOS_PORTA_ROUPARIA);
}
