// F3.8, 07-FIN linha 85: fechamento e reabertura do período financeiro e o saldo diário por conta, no banco próprio
// (periodo_financeiro, saldo_diario_conta, saldo_financeiro_periodo, evento_periodo_financeiro), pelo executor do
// @sgh/nucleo (trilha, outbox e idempotência na mesma transação). As regras são as do @sgh/dominio-financeiro
// (periodo-financeiro.ts); aqui ficam a leitura sob a trava e a gravação.
// Fechar: fecha em cadeia os meses abertos até a competência pedida (desde a última fechada ou, no primeiro fechamento,
// desde o primeiro movimento ou saldo inicial de conta), cada um com o saldo de abertura por conta (saldo inicial e o
// movimento anterior), um saldo por dia com movimento (fechado), o resumo da conta no período e o evento de fechamento.
// Reabrir: um usuário pede (só o último fechado, com justificativa) e outro decide (autoriza ou recusa); cada passo vira
// um evento, e o novo fechamento regrava os saldos.
// Trava: `exigirPeriodoAberto` recusa o lançamento com data até o fim do último mês fechado do estabelecimento.
// Concorrência: o lançamento lê os períodos do estabelecimento com FOR UPDATE (trava as linhas e, sem linha, o
// intervalo do índice único), e o fechamento começa travando as mesmas linhas e incluindo a da competência antes de
// qualquer leitura simples. Assim um lançamento em curso termina antes de o fechamento somar o movimento, e o que
// começa depois lê o período já fechado. O preço: os lançamentos do mesmo estabelecimento passam um de cada vez por
// esse ponto (transações curtas).
// Áreas: a trava é total (movimento, pagamento, recebimento, banco e caixa); por isso as seis marcas `bloqueia_*` vão
// todas ligadas no fechamento e desligadas na reabertura: dizem o que a trava faz, não um controle por área.
import {
  calcularSaldosDiarios,
  competenciaDe,
  conferirDecisaoReabertura,
  conferirLancamentoNoPeriodo,
  conferirPedidoReabertura,
  fimDaCompetencia,
  type MovimentoDoSaldo,
  planejarFechamentoPeriodo,
  type RecusaFinanceiro,
  resumoDoPeriodo,
  type SituacaoPeriodo,
} from '@sgh/dominio-financeiro';
import {
  type ContextoOperacao,
  definirOperacao,
  type Leitor,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { dataIso, numero } from './vocabulario.js';

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export const esquemaFecharPeriodo = z.object({ competencia: z.string().regex(DATA) }).strict();
export type FecharPeriodoEntrada = z.infer<typeof esquemaFecharPeriodo>;

export const esquemaPedirReabertura = z
  .object({ competencia: z.string().regex(DATA), justificativa: z.string().max(500) })
  .strict();
export type PedirReaberturaEntrada = z.infer<typeof esquemaPedirReabertura>;

/** A decisão sobre o pedido de reabertura: autorizar (reabre) ou recusar (fica fechado), por outro usuário. */
export const esquemaReabrirPeriodo = z
  .object({
    competencia: z.string().regex(DATA),
    decisao: z.enum(['autorizar', 'recusar']),
    observacao: z.string().max(500).optional(),
  })
  .strict();
export type ReabrirPeriodoEntrada = z.infer<typeof esquemaReabrirPeriodo>;

/** Recusa de negócio do domínio → erro da operação (409, com os campos). Local: sem ciclo com operacoes.ts. */
function recusar(r: RecusaFinanceiro | null): void {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: r.campos } : {});
}

const hojeIso = () => new Date().toISOString().slice(0, 10);

function estabelecimentoDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return ctx.estabelecimento;
}
function usuarioDe(ctx: ContextoOperacao): number {
  if (ctx.usuario === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
  return ctx.usuario;
}

interface LinhaPeriodo {
  readonly id: number;
  readonly versao: number;
  readonly competencia: string;
  readonly situacao: SituacaoPeriodo;
}

const SQL_PERIODOS = `SELECT id, versao, competencia, situacao FROM periodo_financeiro
  WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY competencia`;

/** Os períodos do estabelecimento, travados (FOR UPDATE): a chave que serializa o fechamento e o lançamento. */
async function periodosTravados(tx: TxOperacao, est: number): Promise<LinhaPeriodo[]> {
  return (await tx.consultarParaAtualizar(SQL_PERIODOS, [est], { teto: 5000 })).map((p) => ({
    id: numero(p['id']),
    versao: numero(p['versao']),
    competencia: dataIso(p['competencia']) ?? '',
    situacao: String(p['situacao']) as SituacaoPeriodo,
  }));
}

const ultimaFechadaDe = (linhas: readonly { competencia: string; situacao: string }[]): string | null =>
  linhas
    .filter((p) => p.situacao === 'fechado')
    .map((p) => p.competencia)
    .sort()
    .at(-1) ?? null;

/**
 * A situação da data no estabelecimento, para leitura (sem trava): fechada se cai até o fim do último mês fechado; se
 * não, a do registro da competência (nulo: sem registro, vale como aberta).
 */
export async function situacaoDaCompetencia(
  l: Leitor,
  est: number,
  data: string,
): Promise<SituacaoPeriodo | null> {
  const linhas = (await l.consultar(SQL_PERIODOS, [est])).map((p) => ({
    competencia: dataIso(p['competencia']) ?? '',
    situacao: String(p['situacao']) as SituacaoPeriodo,
  }));
  if (conferirLancamentoNoPeriodo(data, ultimaFechadaDe(linhas))) return 'fechado';
  return linhas.find((p) => p.competencia === competenciaDe(data))?.situacao ?? null;
}

/**
 * A trava do lançamento retroativo, na transação do lançamento: lê os períodos do estabelecimento travados e recusa a
 * data até o fim do último mês fechado (409 com o campo).
 */
export async function exigirPeriodoAberto(
  tx: TxOperacao,
  est: number,
  data: string,
  campo = 'data',
): Promise<void> {
  recusar(conferirLancamentoNoPeriodo(data, ultimaFechadaDe(await periodosTravados(tx, est)), campo));
}

const MARCAS_TRAVA = (ligada: boolean) => ({
  bloqueia_contas_pagar: ligada,
  bloqueia_pagamento: ligada,
  bloqueia_contas_receber: ligada,
  bloqueia_recebimento: ligada,
  bloqueia_banco: ligada,
  bloqueia_caixa: ligada,
});

async function registrarEvento(
  tx: TxOperacao,
  est: number,
  competencia: string,
  tipo: 'fechamento' | 'pedido_reabertura' | 'reabertura' | 'reabertura_recusada',
  usuario: number,
  agora: Date,
  extra: { justificativa?: string | null; quantidade_movimentos?: number } = {},
): Promise<void> {
  await tx.incluir('evento_periodo_financeiro', {
    estabelecimento_id: est,
    competencia,
    tipo,
    usuario_id: usuario,
    ocorrido_em: agora,
    justificativa: extra.justificativa ?? null,
    quantidade_movimentos: extra.quantidade_movimentos ?? null,
  });
}

/** O último evento da competência (o pedido pendente é o último evento quando ele é um pedido). */
async function ultimoEvento(
  tx: TxOperacao,
  est: number,
  competencia: string,
): Promise<{ tipo: string; usuario: number; justificativa: string | null } | null> {
  const e = await tx.uma(
    `SELECT tipo, usuario_id, justificativa FROM evento_periodo_financeiro
      WHERE estabelecimento_id = ? AND competencia = ? AND excluido_em IS NULL ORDER BY id DESC LIMIT 1`,
    [est, competencia],
  );
  return e
    ? {
        tipo: String(e['tipo']),
        usuario: numero(e['usuario_id']),
        justificativa: e['justificativa'] ? String(e['justificativa']) : null,
      }
    : null;
}

/** Fecha um mês: saldos de cada conta (dia a dia e resumo), a marca de fechado e o evento. Devolve as contagens. */
async function fecharMes(
  tx: TxOperacao,
  est: number,
  usuario: number,
  comp: string,
  periodo: number,
  agora: Date,
): Promise<{ contas: number; dias: number; movimentos: number }> {
  const fim = fimDaCompetencia(comp);
  const contas = await tx.consultar(
    `SELECT id, saldo_inicial, data_saldo_inicial FROM conta_bancaria
      WHERE estabelecimento_id = ? AND excluido_em IS NULL
        AND (data_saldo_inicial IS NULL OR data_saldo_inicial <= ?) ORDER BY id`,
    [est, fim],
  );
  let movimentos = 0;
  let dias = 0;
  for (const c of contas) {
    const conta = numero(c['id']);
    const inicio = dataIso(c['data_saldo_inicial']);
    // O saldo de abertura: o inicial da conta e o movimento ativo desde o início dela até a véspera da competência.
    const antes = await tx.uma(
      `SELECT COALESCE(SUM(CASE WHEN natureza = 'credito' THEN valor ELSE -valor END), 0) AS s
         FROM movimento_bancario
        WHERE conta_bancaria_id = ? AND situacao = 'ativo' AND excluido_em IS NULL
          AND data_movimento < ? AND (? IS NULL OR data_movimento >= ?)`,
      [conta, comp, inicio, inicio],
    );
    const abertura = numero(c['saldo_inicial']) + numero(antes?.['s']);
    const doMes: MovimentoDoSaldo[] = (
      await tx.consultar(
        `SELECT data_movimento, natureza, valor FROM movimento_bancario
          WHERE conta_bancaria_id = ? AND situacao = 'ativo' AND excluido_em IS NULL
            AND data_movimento BETWEEN ? AND ? AND (? IS NULL OR data_movimento >= ?)`,
        [conta, comp, fim, inicio, inicio],
      )
    ).map((r) => ({
      data: dataIso(r['data_movimento']) ?? comp,
      natureza: String(r['natureza']) === 'credito' ? 'credito' : 'debito',
      valor: numero(r['valor']),
    }));
    movimentos += doMes.length;
    // Os dias já gravados (fechamento anterior, antes da reabertura) entram de novo, mesmo que zerados.
    const gravados = await tx.consultar(
      'SELECT id, versao, data_saldo FROM saldo_diario_conta WHERE conta_bancaria_id = ? AND data_saldo BETWEEN ? AND ?',
      [conta, comp, fim],
    );
    const porData = new Map(gravados.map((g) => [dataIso(g['data_saldo']) ?? '', g]));
    const saldos = calcularSaldosDiarios(abertura, [
      ...doMes,
      ...[...porData.keys()].map((data) => ({ data, natureza: 'credito' as const, valor: 0 })),
    ]);
    for (const d of saldos) {
      const valores = {
        saldo_anterior: d.saldoAnterior,
        total_entradas: d.entradas,
        total_saidas: d.saidas,
        saldo_final: d.saldoFinal,
        fechado: true,
        ocorrido_em: agora,
        usuario_id: usuario,
      };
      const g = porData.get(d.data);
      if (g)
        await tx.alterar('saldo_diario_conta', numero(g['id']), numero(g['versao']), {
          ...valores,
          operacao: 'alteracao',
        });
      else
        await tx.incluir('saldo_diario_conta', {
          conta_bancaria_id: conta,
          data_saldo: d.data,
          operacao: 'inclusao',
          ...valores,
        });
      dias += 1;
    }
    const resumo = resumoDoPeriodo(abertura, saldos);
    const linha = {
      saldo_inicial: resumo.saldoInicial,
      total_credito: resumo.entradas,
      total_debito: resumo.saidas,
      saldo_final: resumo.saldoFinal,
      ocorrido_em: agora,
      usuario_id: usuario,
    };
    const existente = await tx.uma(
      `SELECT id, versao FROM saldo_financeiro_periodo
        WHERE periodo_financeiro_id = ? AND tipo_referencia = 'conta_bancaria' AND conta_bancaria_id = ?`,
      [periodo, conta],
    );
    if (existente)
      await tx.alterar('saldo_financeiro_periodo', numero(existente['id']), numero(existente['versao']), {
        ...linha,
        operacao: 'alteracao',
      });
    else
      await tx.incluir('saldo_financeiro_periodo', {
        estabelecimento_id: est,
        periodo_financeiro_id: periodo,
        tipo_referencia: 'conta_bancaria',
        conta_bancaria_id: conta,
        operacao: 'inclusao',
        ...linha,
      });
  }
  const relido = await tx.uma('SELECT versao FROM periodo_financeiro WHERE id = ?', [periodo]);
  await tx.alterar('periodo_financeiro', periodo, numero(relido?.['versao']), {
    situacao: 'fechado',
    fechado_em: agora,
    fechamento_usuario_id: usuario,
    quantidade_registros: movimentos,
    ...MARCAS_TRAVA(true),
  });
  await registrarEvento(tx, est, comp, 'fechamento', usuario, agora, { quantidade_movimentos: movimentos });
  return { contas: contas.length, dias, movimentos };
}

// ── financeiro.fecharPeriodo ───────────────────────────────────────────────────────────────────────────────────

const fecharPeriodo = definirOperacao<FecharPeriodoEntrada, ResultadoOperacao>({
  nome: 'financeiro.fechar_periodo',
  tabelas: [
    'periodo_financeiro',
    'saldo_diario_conta',
    'saldo_financeiro_periodo',
    'evento_periodo_financeiro',
  ],
  entrada: esquemaFecharPeriodo as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    const comp = e.competencia;
    const agora = new Date();
    // 1. A trava, antes de qualquer leitura simples (ver o cabeçalho): os períodos do estabelecimento.
    const linhas = await periodosTravados(tx, est);
    const ultimaFechada = ultimaFechadaDe(linhas);
    const situacao = {
      competencia: comp,
      atual: linhas.find((p) => p.competencia === comp) ?? null,
      hoje: hojeIso(),
      ultimaFechada,
    };
    const previa = planejarFechamentoPeriodo({ ...situacao, primeiraComMovimento: null });
    if ('recusa' in previa) recusar(previa.recusa);
    // 2. A linha da competência pedida, incluída já: espera o lançamento que travou o intervalo terminar.
    const ids = new Map(linhas.map((p) => [p.competencia, p.id]));
    const garantir = async (c: string): Promise<number> => {
      const id =
        ids.get(c) ??
        (await tx.incluir('periodo_financeiro', {
          estabelecimento_id: est,
          competencia: c,
          situacao: 'aberto',
          aberto_em: agora,
        }));
      ids.set(c, id);
      return id;
    };
    await garantir(comp);
    // 3. O primeiro mês com movimento ou saldo inicial (só conta no primeiro fechamento) e a cadeia.
    const primeira = await tx.uma(
      `SELECT LEAST(
          COALESCE((SELECT MIN(data_movimento) FROM movimento_bancario
                     WHERE estabelecimento_id = ? AND situacao = 'ativo' AND excluido_em IS NULL), '9999-12-31'),
          COALESCE((SELECT MIN(data_saldo_inicial) FROM conta_bancaria
                     WHERE estabelecimento_id = ? AND excluido_em IS NULL AND saldo_inicial <> 0), '9999-12-31')) AS d`,
      [est, est],
    );
    const d = dataIso(primeira?.['d']);
    const plano = planejarFechamentoPeriodo({
      ...situacao,
      primeiraComMovimento: d && d < '9999-12-31' ? competenciaDe(d) : null,
    });
    if ('recusa' in plano) return recusar(plano.recusa) as never;
    let total = { contas: 0, dias: 0, movimentos: 0 };
    for (const c of plano.competencias) {
      const r = await fecharMes(tx, est, usuario, c, await garantir(c), agora);
      total = { contas: r.contas, dias: total.dias + r.dias, movimentos: r.movimentos };
    }
    return {
      periodo: ids.get(comp) ?? 0,
      competencia: comp,
      meses: plano.competencias.length,
      desde: plano.competencias[0] ?? comp,
      contas: total.contas,
      dias: total.dias,
      movimentos: total.movimentos,
    };
  },
  alvo: (_e, r) => ({ tabela: 'periodo_financeiro', id: numero(r['periodo']) || null }),
  eventos: (e, r) => [
    {
      tipo: 'financeiro.periodo.fechado',
      carga: {
        periodo: numero(r['periodo']),
        competencia: e.competencia,
        meses: numero(r['meses']),
        contas: numero(r['contas']),
      },
    },
  ],
});

// ── financeiro.pedirReaberturaPeriodo ──────────────────────────────────────────────────────────────────────────

const pedirReaberturaPeriodo = definirOperacao<PedirReaberturaEntrada, ResultadoOperacao>({
  nome: 'financeiro.pedir_reabertura_periodo',
  tabelas: ['evento_periodo_financeiro'],
  entrada: esquemaPedirReabertura as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    const linhas = await periodosTravados(tx, est);
    const atual = linhas.find((p) => p.competencia === e.competencia) ?? null;
    const posteriores = linhas.filter((p) => p.situacao === 'fechado').map((p) => p.competencia);
    const ultimo = await ultimoEvento(tx, est, e.competencia);
    recusar(
      conferirPedidoReabertura(
        atual,
        posteriores,
        e.justificativa,
        atual?.situacao === 'fechado' && ultimo?.tipo === 'pedido_reabertura',
      ),
    );
    await registrarEvento(tx, est, e.competencia, 'pedido_reabertura', usuario, new Date(), {
      justificativa: e.justificativa.trim(),
    });
    return { periodo: (atual as LinhaPeriodo).id, competencia: e.competencia };
  },
  alvo: (_e, r) => ({ tabela: 'periodo_financeiro', id: numero(r['periodo']) || null }),
  eventos: (e, r) => [
    {
      tipo: 'financeiro.periodo.reabertura_pedida',
      carga: { periodo: numero(r['periodo']), competencia: e.competencia },
    },
  ],
});

// ── financeiro.reabrirPeriodo (a decisão sobre o pedido) ──────────────────────────────────────────────────────────

const reabrirPeriodo = definirOperacao<ReabrirPeriodoEntrada, ResultadoOperacao>({
  nome: 'financeiro.reabrir_periodo',
  tabelas: ['periodo_financeiro', 'saldo_diario_conta', 'evento_periodo_financeiro'],
  entrada: esquemaReabrirPeriodo as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const decisor = usuarioDe(ctx);
    const linhas = await periodosTravados(tx, est);
    const atual = linhas.find((p) => p.competencia === e.competencia) ?? null;
    const ultimo = await ultimoEvento(tx, est, e.competencia);
    const pedido = ultimo?.tipo === 'pedido_reabertura' ? ultimo : null;
    recusar(
      conferirDecisaoReabertura({
        atual,
        posterioresFechadas: linhas.filter((p) => p.situacao === 'fechado').map((p) => p.competencia),
        solicitante: pedido?.usuario ?? null,
        decisor,
      }),
    );
    const p = atual as LinhaPeriodo;
    const solicitante = (pedido as NonNullable<typeof pedido>).usuario;
    const agora = new Date();
    const observacao = e.observacao?.trim() || null;
    if (e.decisao === 'recusar') {
      await registrarEvento(tx, est, e.competencia, 'reabertura_recusada', decisor, agora, {
        justificativa: observacao,
      });
      return { periodo: p.id, competencia: e.competencia, decisao: 'recusar', dias: 0 };
    }
    await tx.alterar('periodo_financeiro', p.id, p.versao, {
      situacao: 'reaberto',
      reaberto_em: agora,
      reabertura_usuario_id: solicitante,
      autorizador_usuario_id: decisor,
      justificativa_reabertura: (pedido as NonNullable<typeof pedido>).justificativa,
      ...MARCAS_TRAVA(false),
    });
    const diasFechados = await tx.consultar(
      `SELECT s.id, s.versao FROM saldo_diario_conta s JOIN conta_bancaria c ON c.id = s.conta_bancaria_id
        WHERE c.estabelecimento_id = ? AND s.data_saldo BETWEEN ? AND ? AND s.fechado = TRUE`,
      [est, e.competencia, fimDaCompetencia(e.competencia)],
    );
    for (const d of diasFechados)
      await tx.alterar('saldo_diario_conta', numero(d['id']), numero(d['versao']), {
        fechado: false,
        operacao: 'alteracao',
        ocorrido_em: agora,
        usuario_id: decisor,
      });
    await registrarEvento(tx, est, e.competencia, 'reabertura', decisor, agora, {
      justificativa: observacao,
    });
    return { periodo: p.id, competencia: e.competencia, decisao: 'autorizar', dias: diasFechados.length };
  },
  alvo: (_e, r) => ({ tabela: 'periodo_financeiro', id: numero(r['periodo']) || null }),
  eventos: (e, r) => [
    {
      tipo:
        e.decisao === 'autorizar' ? 'financeiro.periodo.reaberto' : 'financeiro.periodo.reabertura_recusada',
      carga: { periodo: numero(r['periodo']), competencia: e.competencia },
    },
  ],
});

export const OPERACOES_PERIODO = {
  'financeiro.fecharPeriodo': fecharPeriodo,
  'financeiro.pedirReaberturaPeriodo': pedirReaberturaPeriodo,
  'financeiro.reabrirPeriodo': reabrirPeriodo,
} as const;

// ── Leituras ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface PeriodoFinanceiroResposta {
  readonly competencia: string;
  readonly situacao: SituacaoPeriodo;
  readonly fechadoEm: string | null;
  readonly fechadoPor: string | null;
  readonly movimentos: number | null;
  readonly reabertoEm: string | null;
  readonly reabertoPor: string | null;
  readonly autorizadoPor: string | null;
  readonly justificativa: string | null;
  /** O pedido de reabertura à espera de decisão (nulo: nenhum). */
  readonly pedido: { readonly por: string; readonly usuario: number; readonly justificativa: string } | null;
}

export interface EventoPeriodoResposta {
  readonly competencia: string;
  readonly tipo: 'fechamento' | 'pedido_reabertura' | 'reabertura' | 'reabertura_recusada';
  readonly em: string | null;
  readonly usuario: number;
  readonly por: string | null;
  readonly justificativa: string | null;
  readonly movimentos: number | null;
}

const instante = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v);

/** O histórico de fechamentos, pedidos e decisões do estabelecimento, do mais recente ao mais antigo (até 300). */
export async function listarEventosPeriodo(l: Leitor, est: number): Promise<EventoPeriodoResposta[]> {
  const linhas = await l.consultar(
    `SELECT e.competencia, e.tipo, e.ocorrido_em, e.usuario_id, u.login, e.justificativa, e.quantidade_movimentos
       FROM evento_periodo_financeiro e LEFT JOIN usuario u ON u.id = e.usuario_id
      WHERE e.estabelecimento_id = ? AND e.excluido_em IS NULL ORDER BY e.id DESC LIMIT 300`,
    [est],
  );
  return linhas.map((r) => ({
    competencia: dataIso(r['competencia']) ?? '',
    tipo: String(r['tipo']) as EventoPeriodoResposta['tipo'],
    em: instante(r['ocorrido_em']),
    usuario: numero(r['usuario_id']),
    por: r['login'] ? String(r['login']) : null,
    justificativa: r['justificativa'] ? String(r['justificativa']) : null,
    movimentos: r['quantidade_movimentos'] === null ? null : numero(r['quantidade_movimentos']),
  }));
}

/** As competências registradas do estabelecimento, da mais recente à mais antiga (até 36), com o pedido pendente. */
export async function listarPeriodos(l: Leitor, est: number): Promise<PeriodoFinanceiroResposta[]> {
  const linhas = await l.consultar(
    `SELECT p.competencia, p.situacao, p.fechado_em, uf.login AS fechou, p.quantidade_registros, p.reaberto_em,
            ur.login AS reabriu, ua.login AS autorizou, p.justificativa_reabertura
       FROM periodo_financeiro p
       LEFT JOIN usuario uf ON uf.id = p.fechamento_usuario_id
       LEFT JOIN usuario ur ON ur.id = p.reabertura_usuario_id
       LEFT JOIN usuario ua ON ua.id = p.autorizador_usuario_id
      WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL
      ORDER BY p.competencia DESC LIMIT 36`,
    [est],
  );
  const ultimos = new Map<string, EventoPeriodoResposta>();
  for (const ev of await listarEventosPeriodo(l, est))
    if (!ultimos.has(ev.competencia)) ultimos.set(ev.competencia, ev);
  return linhas.map((r) => {
    const competencia = dataIso(r['competencia']) ?? '';
    const situacao = String(r['situacao']) as SituacaoPeriodo;
    const ev = ultimos.get(competencia);
    return {
      competencia,
      situacao,
      fechadoEm: instante(r['fechado_em']),
      fechadoPor: r['fechou'] ? String(r['fechou']) : null,
      movimentos: r['quantidade_registros'] === null ? null : numero(r['quantidade_registros']),
      reabertoEm: instante(r['reaberto_em']),
      reabertoPor: r['reabriu'] ? String(r['reabriu']) : null,
      autorizadoPor: r['autorizou'] ? String(r['autorizou']) : null,
      justificativa: r['justificativa_reabertura'] ? String(r['justificativa_reabertura']) : null,
      pedido:
        situacao === 'fechado' && ev?.tipo === 'pedido_reabertura'
          ? { por: ev.por ?? '', usuario: ev.usuario, justificativa: ev.justificativa ?? '' }
          : null,
    };
  });
}

export interface SaldoDiarioResposta {
  readonly data: string;
  readonly saldoAnterior: number;
  readonly entradas: number;
  readonly saidas: number;
  readonly saldoFinal: number;
  readonly fechado: boolean;
}

/** O saldo diário gravado de uma conta do estabelecimento entre duas datas (até 400 dias). */
export async function saldosDiarios(
  l: Leitor,
  est: number,
  conta: number,
  de: string,
  ate: string,
): Promise<SaldoDiarioResposta[]> {
  const linhas = await l.consultar(
    `SELECT s.data_saldo, s.saldo_anterior, s.total_entradas, s.total_saidas, s.saldo_final, s.fechado
       FROM saldo_diario_conta s JOIN conta_bancaria c ON c.id = s.conta_bancaria_id
      WHERE s.conta_bancaria_id = ? AND c.estabelecimento_id = ? AND s.data_saldo BETWEEN ? AND ?
      ORDER BY s.data_saldo LIMIT 400`,
    [conta, est, de, ate],
  );
  return linhas.map((r) => ({
    data: dataIso(r['data_saldo']) ?? '',
    saldoAnterior: numero(r['saldo_anterior']),
    entradas: numero(r['total_entradas']),
    saidas: numero(r['total_saidas']),
    saldoFinal: numero(r['saldo_final']),
    fechado: Boolean(numero(r['fechado'])),
  }));
}
