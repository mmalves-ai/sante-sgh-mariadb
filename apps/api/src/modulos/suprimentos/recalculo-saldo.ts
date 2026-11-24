// Recálculo auditado do saldo e do custo médio (F3.6, 05-SUP linha 16). O razão (`movimento_estoque`) nunca é
// editado: a prévia refaz a projeção de cada saldo do escopo a partir da posição do último mês fechado (ou de zero) e
// dos movimentos depois dela, e mostra a diferença para o gravado; a aplicação, pelo Executor (trilha, outbox e
// idempotência na mesma transação), grava só os saldos com diferença e sem razão negativo e registra o recálculo em
// `recalculo_saldo_estoque` com o escopo, o período, o motivo, o usuário e as diferenças apuradas (o saldo com razão
// negativo fica pendente, listado no registro, sem gravar). As regras puras moram em `regras/recalculo-saldo.ts`.
import {
  conferirRecalculo,
  diferencaRecalculo,
  type DiferencaRecalculo,
  type MovimentoRecalculo,
  type PreviaRecalculo,
  projetarRazao,
  type RecalcularSaldosEntrada,
} from '@sgh/contratos';
import type { RecusaSuprimentos } from '@sgh/contratos/regras-suprimentos';
import { type Leitor, recusa, type ResultadoOperacao, type TxOperacao } from '@sgh/nucleo';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export const OPERACAO_RECALCULO_SALDO = 'suprimentos.recalcularSaldos';
export const TABELAS_RECALCULO_SALDO = ['saldo_estoque', 'recalculo_saldo_estoque'] as const;

/** A data do banco (DATE ou texto) como AAAA-MM-DD. */
function iso(v: unknown): string {
  if (v instanceof Date)
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  return String(v ?? '').slice(0, 10);
}
const comp = (ano: number, mes: number) => `${ano}-${String(mes).padStart(2, '0')}-01`;
const rotulo = (d: string) => `${d.slice(5, 7)}/${d.slice(0, 4)}`;

function recusarTodas(rs: readonly RecusaSuprimentos[]): void {
  const [r] = rs;
  if (r)
    throw recusa(r.codigo, rs.map((x) => x.mensagem).join(' '), {
      campos: [...new Set(rs.flatMap((x) => x.campos ?? []))],
    });
}

interface Apuracao extends PreviaRecalculo {
  readonly versoes: ReadonlyMap<number, number>;
  readonly inicio: string;
  readonly fim: string;
}

/** A prévia do recálculo (lê, nunca grava): confere o pedido e refaz cada saldo do escopo pelo razão. */
export async function apurarRecalculo(
  l: Leitor,
  est: number,
  e: RecalcularSaldosEntrada,
  hoje: string,
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
  recusarTodas(
    conferirRecalculo({ competencia: { ano: e.ano, mes: e.mes }, motivo: e.motivo }, fechados, corrente),
  );
  const filtro = `${e.local === null ? '' : ' AND s.local_estoque_id = ?'}${e.insumo === null ? '' : ' AND s.insumo_id = ?'}`;
  const params = [est, ...(e.local === null ? [] : [e.local]), ...(e.insumo === null ? [] : [e.insumo])];
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
      WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL${filtro}
      ORDER BY le.nome, i.nome, s.id`,
    [comp(e.ano, e.mes), ...params],
  );
  if (saldos.length === 0)
    throw recusa('sem-saldo', 'Nenhum saldo no escopo escolhido (local e item).', {
      campos: ['local', 'insumo'],
    });
  const movs = await l.consultar<Linha>(
    `SELECT m.local_estoque_id, m.insumo_id, m.natureza, m.quantidade_estoque, m.valor_total, m.competencia,
            o.natureza AS estornado_natureza, o.valor_total AS estornado_valor
       FROM movimento_estoque m
       JOIN saldo_estoque s ON s.local_estoque_id = m.local_estoque_id AND s.insumo_id = m.insumo_id
       LEFT JOIN movimento_estoque o ON o.id = m.estorno_movimento_estoque_id
      WHERE m.estabelecimento_id = ? AND m.excluido_em IS NULL AND s.estabelecimento_id = ? AND s.excluido_em IS NULL
            ${filtro}
      ORDER BY m.ocorrido_em, m.id`,
    [est, ...params],
  );
  const porSaldo = new Map<string, { comp: string; mov: MovimentoRecalculo }[]>();
  for (const m of movs) {
    const k = `${n(m['local_estoque_id'])}:${n(m['insumo_id'])}`;
    const lista = porSaldo.get(k) ?? [];
    lista.push({
      comp: iso(m['competencia']),
      mov: {
        natureza: m['natureza'] === 'entrada' ? 'entrada' : 'saida',
        quantidade: n(m['quantidade_estoque']),
        valor: n(m['valor_total']),
        valorEstornado:
          m['natureza'] === 'saida' && m['estornado_natureza'] === 'entrada' ? n(m['estornado_valor']) : null,
      },
    });
    porSaldo.set(k, lista);
  }
  const diferencas: DiferencaRecalculo[] = [];
  const versoes = new Map<number, number>();
  let inicio = comp(e.ano, e.mes);
  let abertura: string | null = null;
  for (const s of saldos) {
    const aberturaComp =
      s['abertura_comp'] === null || s['abertura_comp'] === undefined ? null : iso(s['abertura_comp']);
    if (aberturaComp && (abertura === null || aberturaComp > abertura)) abertura = aberturaComp;
    const doSaldo = (porSaldo.get(`${n(s['local_estoque_id'])}:${n(s['insumo_id'])}`) ?? []).filter(
      (x) => aberturaComp === null || x.comp > aberturaComp,
    );
    const primeiro = doSaldo[0]?.comp;
    if (aberturaComp === null && primeiro && primeiro < inicio) inicio = primeiro;
    const gravado = { quantidade: n(s['quantidade']), custo: n(s['custo_medio']) };
    const p = projetarRazao(
      aberturaComp
        ? { quantidade: n(s['abertura_qtd']), custo: n(s['abertura_custo']) }
        : { quantidade: 0, custo: 0 },
      doSaldo.map((x) => x.mov),
      e.recalculaCusto,
      gravado.custo,
    );
    const d = diferencaRecalculo(gravado, p);
    versoes.set(n(s['id']), n(s['versao']));
    if (d.quantidade === 0 && Math.abs(p.custo - gravado.custo) < 0.000001 && p.negativoNoMovimento === null)
      continue;
    diferencas.push({
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
    });
  }
  const aplicaveis = diferencas.filter((d) => d.negativoNoMovimento === null);
  return {
    abertura: abertura ? rotulo(abertura) : null,
    saldos: saldos.length,
    diferencas,
    diferencaQuantidadeTotal:
      Math.round(aplicaveis.reduce((a, d) => a + d.diferencaQuantidade, 0) * 10_000) / 10_000,
    diferencaValorTotal: Math.round(aplicaveis.reduce((a, d) => a + d.diferencaValor, 0) * 100) / 100,
    pendentes: diferencas.length - aplicaveis.length,
    versoes,
    inicio,
    fim: comp(corrente.ano, corrente.mes),
  };
}

/**
 * A aplicação do recálculo: trava os saldos do escopo, apura de novo dentro da transação, grava a projeção refeita nos
 * saldos com diferença (nunca nos pendentes) e registra o recálculo concluído com as diferenças.
 */
export async function recalcularSaldos(
  tx: TxOperacao,
  est: number,
  e: RecalcularSaldosEntrada,
  hoje: string,
): Promise<ResultadoOperacao> {
  await tx.consultarParaAtualizar<Linha>(
    `SELECT s.id FROM saldo_estoque s WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL${
      e.local === null ? '' : ' AND s.local_estoque_id = ?'
    }${e.insumo === null ? '' : ' AND s.insumo_id = ?'}`,
    [est, ...(e.local === null ? [] : [e.local]), ...(e.insumo === null ? [] : [e.insumo])],
  );
  const a = await apurarRecalculo(tx, est, e, hoje);
  const agora = new Date();
  const aplicados = a.diferencas.filter((d) => d.negativoNoMovimento === null);
  for (const d of aplicados)
    await tx.alterar('saldo_estoque', d.saldo, a.versoes.get(d.saldo) ?? 0, {
      quantidade: d.quantidadeRefeita,
      custo_medio: d.custoRefeito,
    });
  const unico = a.saldos === 1 ? ([...a.versoes.keys()][0] ?? null) : null;
  const id = await tx.incluir('recalculo_saldo_estoque', {
    estabelecimento_id: est,
    saldo_estoque_id: unico,
    operacao: 'inclusao',
    dados: JSON.stringify({
      abertura: a.abertura,
      saldos: a.saldos,
      pendentes: a.pendentes,
      // Só ids e números (nunca nome de pessoa): o registro explica cada saldo refeito.
      diferencas: a.diferencas.slice(0, 500).map((d) => ({
        saldo: d.saldo,
        local: d.local,
        insumo: d.insumo,
        de: d.quantidadeGravada,
        para: d.quantidadeRefeita,
        custoDe: d.custoGravado,
        custoPara: d.custoRefeito,
        valor: d.diferencaValor,
        negativoNoMovimento: d.negativoNoMovimento,
      })),
    }),
    ocorrido_em: agora,
    usuario_id: tx.contexto.usuario ?? null,
    local_estoque_id: e.local,
    insumo_id: e.insumo,
    competencia_inicio: a.inicio,
    competencia_fim: a.fim < a.inicio ? a.inicio : a.fim,
    recalcula_custo: e.recalculaCusto,
    concluido_em: agora,
    situacao: 'concluido',
    insumos_atingidos: new Set(aplicados.map((d) => d.insumo)).size,
    diferenca_quantidade_total: a.diferencaQuantidadeTotal,
    diferenca_valor_total: a.diferencaValorTotal,
    motivo: e.motivo,
    endereco_ip: tx.contexto.enderecoIp ?? null,
  });
  return {
    id,
    saldos: a.saldos,
    corrigidos: aplicados.length,
    pendentes: a.pendentes,
    diferencaValor: a.diferencaValorTotal,
  };
}
