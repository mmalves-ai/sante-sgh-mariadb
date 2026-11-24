// Recálculo auditado do saldo e do custo médio (F3.6, 05-SUP linha 16). O razão (`movimento_estoque`: natureza,
// quantidade, valor) nunca é editado: a prévia refaz a projeção de cada saldo do escopo a partir da posição do último
// mês fechado (ou de zero) e dos movimentos depois dela, e mostra a diferença para o gravado. A aplicação, pelo
// Executor (trilha, outbox e idempotência na mesma transação), grava nos saldos com diferença e sem pendência tudo o
// que deriva do razão: o saldo do item (quantidade e custo), o saldo de cada lote (pelo `movimento_lote`) e a posição
// depois de cada movimento do período (`saldo_apos` e `custo_medio_apos`), para o histórico do item explicar o saldo
// corrigido e o fechamento seguinte tomar o custo refeito. Registra o recálculo em `recalculo_saldo_estoque` com o
// escopo, o período de fato refeito, o motivo, o usuário e TODAS as diferenças (as pendentes também, sem gravar).
// Memória e trava limitadas: os saldos são lidos em lotes de LOTE_SALDOS, os movimentos filtrados no SQL a partir da
// menor abertura do lote, e a aplicação aceita até TETO_SALDOS_APLICACAO saldos por vez (acima disso, por local ou
// item). As regras puras moram em `regras/recalculo-saldo.ts`.
import {
  conferirLotesRecalculo,
  conferirRecalculo,
  diferencaRecalculo,
  type DiferencaRecalculo,
  type LoteRecalculo,
  type MovimentoRecalculo,
  passosRazao,
  type PreviaRecalculo,
  projetarRazao,
  type RecalcularSaldosEntrada,
} from '@sgh/contratos';
import type { RecusaSuprimentos } from '@sgh/contratos/regras-suprimentos';
import { type Leitor, recusa, type ResultadoOperacao, type TxOperacao } from '@sgh/nucleo';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const tem = (v: unknown) => v !== null && v !== undefined;

export const OPERACAO_RECALCULO_SALDO = 'suprimentos.recalcularSaldos';
export const TABELAS_RECALCULO_SALDO = ['saldo_estoque', 'recalculo_saldo_estoque'] as const;
/** Saldos lidos por vez (memória limitada mesmo no escopo de todo o estabelecimento). */
const LOTE_SALDOS = 200;
/** Saldos aplicados numa transação (todos travados durante ela): acima disso, recalcule por local ou por item. */
export const TETO_SALDOS_APLICACAO = 10_000;

/** A data do banco (DATE ou texto) como AAAA-MM-DD. */
function iso(v: unknown): string {
  if (v instanceof Date)
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  return String(v ?? '').slice(0, 10);
}
const comp = (ano: number, mes: number) => `${ano}-${String(mes).padStart(2, '0')}-01`;
const rotulo = (d: string) => `${d.slice(5, 7)}/${d.slice(0, 4)}`;
/** O primeiro dia do mês seguinte a uma competência AAAA-MM-01. */
function mesSeguinte(d: string): string {
  const a = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  return m === 12 ? comp(a + 1, 1) : comp(a, m + 1);
}
const q4 = (v: number) => Math.round(v * 10_000) / 10_000;

function recusarTodas(rs: readonly RecusaSuprimentos[]): void {
  const [r] = rs;
  if (r)
    throw recusa(r.codigo, rs.map((x) => x.mensagem).join(' '), {
      campos: [...new Set(rs.flatMap((x) => x.campos ?? []))],
    });
}

/** Um movimento do período de um saldo, com o que o histórico do item gravou depois dele. */
interface MovimentoDoSaldo {
  readonly id: number;
  readonly versao: number;
  readonly comp: string;
  readonly saldoApos: number | null;
  readonly custoApos: number | null;
  readonly mov: MovimentoRecalculo;
}

/** O que a aplicação grava de um saldo aplicável (lido no mesmo lote). */
export interface SaldoAplicavel {
  readonly diferenca: DiferencaRecalculo;
  readonly versao: number;
  readonly movimentos: readonly MovimentoDoSaldo[];
  readonly passos: readonly { quantidade: number; custo: number }[];
  readonly lotes: readonly { lote: number; de: number; para: number; id: number | null; versao: number }[];
}

interface Apuracao extends PreviaRecalculo {
  readonly ids: readonly number[];
  readonly inicioComp: string;
  readonly fim: string;
}

const filtroEscopo = (e: RecalcularSaldosEntrada) =>
  `${e.local === null ? '' : ' AND s.local_estoque_id = ?'}${e.insumo === null ? '' : ' AND s.insumo_id = ?'}`;
const paramsEscopo = (e: RecalcularSaldosEntrada) => [
  ...(e.local === null ? [] : [e.local]),
  ...(e.insumo === null ? [] : [e.insumo]),
];

/**
 * Apura o recálculo (lê; grava só pelo `aoAplicar`, que a aplicação passa dentro da transação): confere o pedido e
 * refaz cada saldo do escopo pelo razão, lote a lote de saldos.
 */
export async function apurarRecalculo(
  l: Leitor,
  est: number,
  e: RecalcularSaldosEntrada,
  hoje: string,
  aoAplicar?: (lote: readonly SaldoAplicavel[]) => Promise<void>,
): Promise<Apuracao> {
  const fechados = (
    await l.consultar<Linha>(
      "SELECT competencia FROM fechamento_estoque WHERE estabelecimento_id = ? AND situacao = 'fechado' AND excluido_em IS NULL",
      [est],
    )
  ).map((r) => ({
    ano: Number(iso(r['competencia']).slice(0, 4)),
    mes: Number(iso(r['competencia']).slice(5, 7)),
  }));
  const corrente = { ano: Number(hoje.slice(0, 4)), mes: Number(hoje.slice(5, 7)) };
  const pedido = e.ano !== undefined && e.mes !== undefined ? { ano: e.ano, mes: e.mes } : corrente;
  recusarTodas(conferirRecalculo({ competencia: pedido, motivo: e.motivo }, fechados, corrente));
  const ids = (
    await l.consultar<Linha>(
      `SELECT s.id FROM saldo_estoque s JOIN local_estoque le ON le.id = s.local_estoque_id JOIN insumo i ON i.id = s.insumo_id
        WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL${filtroEscopo(e)} ORDER BY le.nome, i.nome, s.id`,
      [est, ...paramsEscopo(e)],
    )
  ).map((r) => n(r['id']));
  if (ids.length === 0)
    throw recusa('sem-saldo', 'Nenhum saldo no escopo escolhido (local e item).', {
      campos: ['local', 'insumo'],
    });
  if (aoAplicar && ids.length > TETO_SALDOS_APLICACAO)
    throw recusa(
      'escopo-grande',
      `O escopo tem ${ids.length} saldos; aplique até ${TETO_SALDOS_APLICACAO} por vez (escolha um local ou um item).`,
      { campos: ['local', 'insumo'] },
    );
  const fim = comp(corrente.ano, corrente.mes);
  const diferencas: DiferencaRecalculo[] = [];
  let inicio: string | null = null;
  let abertura: string | null = null;
  for (let k = 0; k < ids.length; k += LOTE_SALDOS) {
    const fatia = ids.slice(k, k + LOTE_SALDOS);
    const saldos = await l.consultar<Linha>(
      `SELECT s.id, s.versao, s.local_estoque_id, s.insumo_id, s.quantidade, s.custo_medio,
              le.nome AS local_nome, i.nome AS insumo_nome,
              sm.competencia AS abertura_comp, sm.quantidade_final AS abertura_qtd, sm.custo_medio AS abertura_custo
         FROM saldo_estoque s
         JOIN local_estoque le ON le.id = s.local_estoque_id
         JOIN insumo i ON i.id = s.insumo_id
         LEFT JOIN saldo_estoque_mensal sm ON sm.saldo_estoque_id = s.id AND sm.fechado = TRUE
              AND sm.competencia = (SELECT MAX(x.competencia) FROM saldo_estoque_mensal x
                                     WHERE x.saldo_estoque_id = s.id AND x.fechado = TRUE AND x.competencia < ?)
        WHERE s.id IN (${fatia.map(() => '?').join(', ')})
        ORDER BY le.nome, i.nome, s.id`,
      [comp(pedido.ano, pedido.mes), ...fatia],
    );
    const aberturas = saldos.map((s) => (tem(s['abertura_comp']) ? iso(s['abertura_comp']) : null));
    // Os movimentos só depois da menor abertura do lote (sem abertura em algum saldo: desde o primeiro).
    const desde = aberturas.some((a) => a === null)
      ? null
      : (aberturas as string[]).reduce((a, b) => (b < a ? b : a));
    const pares = saldos.map(() => '(m.local_estoque_id = ? AND m.insumo_id = ?)').join(' OR ');
    const paresP = saldos.flatMap((s) => [n(s['local_estoque_id']), n(s['insumo_id'])]);
    const movs = await l.consultar<Linha>(
      `SELECT m.id, m.versao, m.local_estoque_id, m.insumo_id, m.natureza, m.quantidade_estoque, m.valor_total,
              m.competencia, m.saldo_apos, m.custo_medio_apos,
              o.natureza AS estornado_natureza, o.valor_total AS estornado_valor
         FROM movimento_estoque m
         LEFT JOIN movimento_estoque o ON o.id = m.estorno_movimento_estoque_id
        WHERE m.estabelecimento_id = ? AND m.excluido_em IS NULL AND (${pares})${desde ? ' AND m.competencia > ?' : ''}
        ORDER BY m.ocorrido_em, m.id`,
      [est, ...paresP, ...(desde ? [desde] : [])],
    );
    const porSaldo = new Map<string, MovimentoDoSaldo[]>();
    for (const m of movs) {
      const chave = `${n(m['local_estoque_id'])}:${n(m['insumo_id'])}`;
      const lista = porSaldo.get(chave) ?? [];
      lista.push({
        id: n(m['id']),
        versao: n(m['versao']),
        comp: iso(m['competencia']),
        saldoApos: tem(m['saldo_apos']) ? n(m['saldo_apos']) : null,
        custoApos: tem(m['custo_medio_apos']) ? n(m['custo_medio_apos']) : null,
        mov: {
          natureza: m['natureza'] === 'entrada' ? 'entrada' : 'saida',
          quantidade: n(m['quantidade_estoque']),
          valor: n(m['valor_total']),
          valorEstornado:
            m['natureza'] === 'saida' && m['estornado_natureza'] === 'entrada'
              ? n(m['estornado_valor'])
              : null,
        },
      });
      porSaldo.set(chave, lista);
    }
    const doLote: {
      d: DiferencaRecalculo;
      versao: number;
      movs: MovimentoDoSaldo[];
      passos: { quantidade: number; custo: number }[];
    }[] = [];
    saldos.forEach((s, i) => {
      const aberturaComp = aberturas[i] ?? null;
      if (aberturaComp && (abertura === null || aberturaComp > abertura)) abertura = aberturaComp;
      const doSaldo = (porSaldo.get(`${n(s['local_estoque_id'])}:${n(s['insumo_id'])}`) ?? []).filter(
        (x) => aberturaComp === null || x.comp > aberturaComp,
      );
      const comeco = aberturaComp ? mesSeguinte(aberturaComp) : doSaldo[0]?.comp;
      if (comeco && (inicio === null || comeco < inicio)) inicio = comeco;
      const gravado = { quantidade: n(s['quantidade']), custo: n(s['custo_medio']) };
      const base = aberturaComp
        ? { quantidade: n(s['abertura_qtd']), custo: n(s['abertura_custo']) }
        : { quantidade: 0, custo: 0 };
      const movsR = doSaldo.map((x) => x.mov);
      const p = projetarRazao(base, movsR, e.recalculaCusto, gravado.custo);
      const d = diferencaRecalculo(gravado, p);
      if (
        d.quantidade === 0 &&
        Math.abs(p.custo - gravado.custo) < 0.000001 &&
        p.negativoNoMovimento === null
      )
        return;
      // Sem movimento nem mês fechado, o razão não explica o saldo gravado: nunca se zera um saldo assim.
      const semRazao = aberturaComp === null && doSaldo.length === 0;
      doLote.push({
        d: {
          saldo: n(s['id']),
          local: n(s['local_estoque_id']),
          localNome: texto(s['local_nome']),
          insumo: n(s['insumo_id']),
          insumoNome: texto(s['insumo_nome']),
          movimentos: doSaldo.length,
          quantidadeGravada: gravado.quantidade,
          quantidadeRefeita: p.quantidade,
          custoGravado: gravado.custo,
          custoRefeito: p.custo,
          diferencaQuantidade: d.quantidade,
          diferencaValor: d.valor,
          negativoNoMovimento: p.negativoNoMovimento,
          pendencia: semRazao ? 'sem-razao' : p.negativoNoMovimento !== null ? 'razao-negativo' : null,
        },
        versao: n(s['versao']),
        movs: doSaldo,
        passos: passosRazao(base, movsR).passos,
      });
    });
    // Os lotes dos saldos cuja quantidade muda: o razão por lote (`movimento_lote`) e o gravado (`saldo_lote`).
    const comLote = doLote.filter((x) => x.d.pendencia === null && x.d.diferencaQuantidade !== 0);
    const lotesPorSaldo = new Map<number, SaldoAplicavel['lotes']>();
    if (comLote.length > 0) {
      const paresL = comLote.map(() => '(m.local_estoque_id = ? AND m.insumo_id = ?)').join(' OR ');
      const paresG = comLote.map(() => '(sl.local_estoque_id = ? AND li.insumo_id = ?)').join(' OR ');
      const pp = comLote.flatMap((x) => [x.d.local, x.d.insumo]);
      const razao = await l.consultar<Linha>(
        `SELECT m.local_estoque_id, m.insumo_id, ml.lote_insumo_id,
                SUM(CASE WHEN m.natureza = 'entrada' THEN ml.quantidade ELSE -ml.quantidade END) AS q
           FROM movimento_lote ml JOIN movimento_estoque m ON m.id = ml.movimento_estoque_id
          WHERE m.estabelecimento_id = ? AND m.excluido_em IS NULL AND ml.excluido_em IS NULL AND (${paresL})
          GROUP BY m.local_estoque_id, m.insumo_id, ml.lote_insumo_id`,
        [est, ...pp],
      );
      const gravados = await l.consultar<Linha>(
        `SELECT sl.id, sl.versao, sl.local_estoque_id, li.insumo_id, sl.lote_insumo_id, sl.quantidade
           FROM saldo_lote sl JOIN lote_insumo li ON li.id = sl.lote_insumo_id
          WHERE sl.excluido_em IS NULL AND (${paresG})`,
        pp,
      );
      for (const x of comLote) {
        const doPar = (r: Linha) =>
          n(r['local_estoque_id']) === x.d.local && n(r['insumo_id']) === x.d.insumo;
        const g = gravados.filter(doPar);
        const lr: LoteRecalculo[] = razao
          .filter(doPar)
          .map((r) => ({ lote: n(r['lote_insumo_id']), quantidade: n(r['q']) }));
        const lg: LoteRecalculo[] = g.map((r) => ({
          lote: n(r['lote_insumo_id']),
          quantidade: n(r['quantidade']),
        }));
        const c = conferirLotesRecalculo(x.d.quantidadeRefeita, lr, lg);
        if (c.divergente) {
          x.d = { ...x.d, pendencia: 'lote-divergente' };
          continue;
        }
        lotesPorSaldo.set(
          x.d.saldo,
          c.ajustes.map((a) => {
            const linha = g.find((r) => n(r['lote_insumo_id']) === a.lote);
            return { ...a, id: linha ? n(linha['id']) : null, versao: linha ? n(linha['versao']) : 0 };
          }),
        );
      }
    }
    for (const x of doLote) diferencas.push(x.d);
    if (aoAplicar)
      await aoAplicar(
        doLote
          .filter((x) => x.d.pendencia === null)
          .map((x) => ({
            diferenca: x.d,
            versao: x.versao,
            movimentos: x.movs,
            passos: x.passos,
            lotes: lotesPorSaldo.get(x.d.saldo) ?? [],
          })),
      );
  }
  const aplicaveis = diferencas.filter((d) => d.pendencia === null);
  const inicioComp = inicio ?? fim;
  return {
    abertura: abertura ? rotulo(abertura) : null,
    inicio: rotulo(inicioComp),
    saldos: ids.length,
    diferencas,
    diferencaQuantidadeTotal: q4(aplicaveis.reduce((a, d) => a + d.diferencaQuantidade, 0)),
    diferencaValorTotal: Math.round(aplicaveis.reduce((a, d) => a + d.diferencaValor, 0) * 100) / 100,
    pendentes: diferencas.length - aplicaveis.length,
    ids,
    inicioComp,
    fim,
  };
}

/**
 * A aplicação do recálculo: trava os saldos do escopo, apura de novo dentro da transação e, nos saldos com diferença
 * e sem pendência, grava o saldo do item, o de cada lote e a posição depois de cada movimento do período; registra o
 * recálculo concluído com todas as diferenças.
 */
export async function recalcularSaldos(
  tx: TxOperacao,
  est: number,
  e: RecalcularSaldosEntrada,
  hoje: string,
): Promise<ResultadoOperacao> {
  const travados = await tx.consultarParaAtualizar<Linha>(
    `SELECT s.id FROM saldo_estoque s WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL${filtroEscopo(e)}
      LIMIT ${TETO_SALDOS_APLICACAO + 1}`,
    [est, ...paramsEscopo(e)],
  );
  if (travados.length > TETO_SALDOS_APLICACAO)
    throw recusa(
      'escopo-grande',
      `O escopo passa de ${TETO_SALDOS_APLICACAO} saldos; escolha um local ou um item.`,
      { campos: ['local', 'insumo'] },
    );
  const competenciaHoje = `${hoje.slice(0, 7)}-01`;
  let aplicados = 0;
  let historicos = 0;
  let lotes = 0;
  const insumos = new Set<number>();
  const a = await apurarRecalculo(tx, est, e, hoje, async (lote) => {
    for (const x of lote) {
      const d = x.diferenca;
      await tx.alterar('saldo_estoque', d.saldo, x.versao, {
        quantidade: d.quantidadeRefeita,
        custo_medio: d.custoRefeito,
      });
      aplicados += 1;
      insumos.add(d.insumo);
      // O histórico do item: a posição depois de cada movimento do período, refeita (o fato do movimento fica igual).
      for (const [i, m] of x.movimentos.entries()) {
        const p = x.passos[i];
        if (!p) continue;
        const novo: Record<string, unknown> = {};
        if (m.saldoApos === null || Math.abs(m.saldoApos - p.quantidade) > 0.00005)
          novo['saldo_apos'] = p.quantidade;
        const custo = q4(p.custo);
        if (e.recalculaCusto && (m.custoApos === null || Math.abs(m.custoApos - custo) > 0.00005))
          novo['custo_medio_apos'] = custo;
        if (Object.keys(novo).length === 0) continue;
        await tx.alterar('movimento_estoque', m.id, m.versao, novo);
        historicos += 1;
      }
      for (const l of x.lotes) {
        if (l.id !== null) await tx.alterar('saldo_lote', l.id, l.versao, { quantidade: l.para });
        else
          await tx.incluir('saldo_lote', {
            estabelecimento_id: est,
            local_estoque_id: d.local,
            lote_insumo_id: l.lote,
            quantidade: l.para,
            competencia: competenciaHoje,
          });
        lotes += 1;
      }
    }
  });
  const agora = new Date();
  const unico = a.saldos === 1 ? (a.ids[0] ?? null) : null;
  const id = await tx.incluir('recalculo_saldo_estoque', {
    estabelecimento_id: est,
    saldo_estoque_id: unico,
    operacao: 'inclusao',
    dados: JSON.stringify({
      abertura: a.abertura,
      inicio: a.inicio,
      saldos: a.saldos,
      corrigidos: aplicados,
      pendentes: a.pendentes,
      movimentosReprojetados: historicos,
      lotesAjustados: lotes,
      // Todas as diferenças, aplicadas e pendentes; só ids e números (nunca nome de pessoa).
      diferencas: a.diferencas.map((d) => ({
        saldo: d.saldo,
        local: d.local,
        insumo: d.insumo,
        de: d.quantidadeGravada,
        para: d.quantidadeRefeita,
        custoDe: d.custoGravado,
        custoPara: d.custoRefeito,
        valor: d.diferencaValor,
        negativoNoMovimento: d.negativoNoMovimento,
        pendencia: d.pendencia,
      })),
    }),
    ocorrido_em: agora,
    usuario_id: tx.contexto.usuario ?? null,
    local_estoque_id: e.local,
    insumo_id: e.insumo,
    competencia_inicio: a.inicioComp,
    competencia_fim: a.fim < a.inicioComp ? a.inicioComp : a.fim,
    recalcula_custo: e.recalculaCusto,
    concluido_em: agora,
    situacao: 'concluido',
    insumos_atingidos: insumos.size,
    diferenca_quantidade_total: a.diferencaQuantidadeTotal,
    diferenca_valor_total: a.diferencaValorTotal,
    motivo: e.motivo,
    endereco_ip: tx.contexto.enderecoIp ?? null,
  });
  return {
    id,
    saldos: a.saldos,
    corrigidos: aplicados,
    pendentes: a.pendentes,
    diferencaValor: a.diferencaValorTotal,
  };
}
