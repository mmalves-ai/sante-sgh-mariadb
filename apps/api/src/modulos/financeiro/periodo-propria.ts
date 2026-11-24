// F3.8, 07-FIN linha 85: fechamento e reabertura do período financeiro e o saldo diário por conta, no banco próprio
// (periodo_financeiro, saldo_diario_conta, saldo_financeiro_periodo), pelo executor do @sgh/nucleo (trilha, outbox e
// idempotência na mesma transação). As regras são as do @sgh/dominio-financeiro (periodo-financeiro.ts); aqui ficam a
// leitura sob a trava e a gravação.
// Fechar: confere a ordem dos meses, calcula por conta do estabelecimento o saldo de abertura (saldo inicial da conta e
// o movimento anterior), grava um saldo por dia com movimento (fechado) e o resumo da conta no período, e marca a
// competência fechada com quem, quando e quantos movimentos. Reabrir: só o último fechado, com justificativa; os dias
// voltam a aceitar lançamento e o novo fechamento regrava os saldos (o registro anterior fica na trilha).
// Trava: `exigirPeriodoAberto` recusa o lançamento com data numa competência fechada (movimento e baixa).
import {
  calcularSaldosDiarios,
  competenciaDe,
  conferirFechamentoPeriodo,
  conferirLancamentoNoPeriodo,
  conferirReaberturaPeriodo,
  fimDaCompetencia,
  type MovimentoDoSaldo,
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

export const esquemaReabrirPeriodo = z
  .object({ competencia: z.string().regex(DATA), justificativa: z.string().max(500) })
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

/** A situação da competência da data no estabelecimento (nulo: sem registro, vale como aberta). */
export async function situacaoDaCompetencia(
  l: Leitor,
  est: number,
  data: string,
): Promise<SituacaoPeriodo | null> {
  const r = await l.uma(
    'SELECT situacao FROM periodo_financeiro WHERE estabelecimento_id = ? AND competencia = ? AND excluido_em IS NULL',
    [est, competenciaDe(data)],
  );
  return r ? (String(r['situacao']) as SituacaoPeriodo) : null;
}

/** A trava do lançamento retroativo: recusa a data numa competência fechada (409 com o campo). */
export async function exigirPeriodoAberto(
  l: Leitor,
  est: number,
  data: string,
  campo = 'data',
): Promise<void> {
  recusar(conferirLancamentoNoPeriodo(data, await situacaoDaCompetencia(l, est, data), campo));
}

const SQL_PERIODO = `SELECT id, versao, competencia, situacao FROM periodo_financeiro
  WHERE estabelecimento_id = ? AND competencia = ? AND excluido_em IS NULL`;

async function periodoTravado(tx: TxOperacao, est: number, competencia: string) {
  const [p] = await tx.consultarParaAtualizar(SQL_PERIODO, [est, competencia], { teto: 1 });
  return p
    ? {
        id: numero(p['id']),
        versao: numero(p['versao']),
        competencia: dataIso(p['competencia']) ?? competencia,
        situacao: String(p['situacao']) as SituacaoPeriodo,
      }
    : null;
}

// ── financeiro.fecharPeriodo ───────────────────────────────────────────────────────────────────────────────────

const fecharPeriodo = definirOperacao<FecharPeriodoEntrada, ResultadoOperacao>({
  nome: 'financeiro.fechar_periodo',
  tabelas: ['periodo_financeiro', 'saldo_diario_conta', 'saldo_financeiro_periodo'],
  entrada: esquemaFecharPeriodo as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    const comp = e.competencia;
    const atual = await periodoTravado(tx, est, comp);
    const anteriores = (
      await tx.consultar(
        `SELECT competencia FROM periodo_financeiro
          WHERE estabelecimento_id = ? AND competencia < ? AND situacao <> 'fechado' AND excluido_em IS NULL`,
        [est, comp],
      )
    ).map((r) => dataIso(r['competencia']) ?? '');
    recusar(conferirFechamentoPeriodo(comp, atual, hojeIso(), anteriores));
    const fim = fimDaCompetencia(comp);
    const agora = new Date();
    const marcas = {
      situacao: 'fechado',
      fechado_em: agora,
      fechamento_usuario_id: usuario,
      bloqueia_contas_pagar: true,
      bloqueia_pagamento: true,
      bloqueia_contas_receber: true,
      bloqueia_recebimento: true,
      bloqueia_banco: true,
      bloqueia_caixa: true,
    };
    const periodo = atual
      ? (await tx.alterar('periodo_financeiro', atual.id, atual.versao, marcas), atual.id)
      : await tx.incluir('periodo_financeiro', {
          estabelecimento_id: est,
          competencia: comp,
          aberto_em: agora,
          ...marcas,
        });

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
      quantidade_registros: movimentos,
    });
    return { periodo, competencia: comp, contas: contas.length, dias, movimentos };
  },
  alvo: (_e, r) => ({ tabela: 'periodo_financeiro', id: numero(r['periodo']) || null }),
  eventos: (e, r) => [
    {
      tipo: 'financeiro.periodo.fechado',
      carga: { periodo: numero(r['periodo']), competencia: e.competencia, contas: numero(r['contas']) },
    },
  ],
});

// ── financeiro.reabrirPeriodo ──────────────────────────────────────────────────────────────────────────────────

const reabrirPeriodo = definirOperacao<ReabrirPeriodoEntrada, ResultadoOperacao>({
  nome: 'financeiro.reabrir_periodo',
  tabelas: ['periodo_financeiro', 'saldo_diario_conta'],
  entrada: esquemaReabrirPeriodo as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    const atual = await periodoTravado(tx, est, e.competencia);
    const posteriores = (
      await tx.consultar(
        `SELECT competencia FROM periodo_financeiro
          WHERE estabelecimento_id = ? AND competencia > ? AND situacao = 'fechado' AND excluido_em IS NULL`,
        [est, e.competencia],
      )
    ).map((r) => dataIso(r['competencia']) ?? '');
    recusar(conferirReaberturaPeriodo(atual, posteriores, e.justificativa));
    const p = atual as NonNullable<typeof atual>;
    const agora = new Date();
    // Quem reabre é quem autoriza: a reabertura exige a permissão própria (a do parâmetro do financeiro).
    await tx.alterar('periodo_financeiro', p.id, p.versao, {
      situacao: 'reaberto',
      reaberto_em: agora,
      reabertura_usuario_id: usuario,
      autorizador_usuario_id: usuario,
      justificativa_reabertura: e.justificativa.trim(),
      bloqueia_contas_pagar: false,
      bloqueia_pagamento: false,
      bloqueia_contas_receber: false,
      bloqueia_recebimento: false,
      bloqueia_banco: false,
      bloqueia_caixa: false,
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
        usuario_id: usuario,
      });
    return { periodo: p.id, competencia: e.competencia, dias: diasFechados.length };
  },
  alvo: (_e, r) => ({ tabela: 'periodo_financeiro', id: numero(r['periodo']) || null }),
  eventos: (e, r) => [
    {
      tipo: 'financeiro.periodo.reaberto',
      carga: { periodo: numero(r['periodo']), competencia: e.competencia },
    },
  ],
});

export const OPERACOES_PERIODO = {
  'financeiro.fecharPeriodo': fecharPeriodo,
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
  readonly justificativa: string | null;
}

const instante = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v);

/** As competências registradas do estabelecimento, da mais recente à mais antiga (até 36). */
export async function listarPeriodos(l: Leitor, est: number): Promise<PeriodoFinanceiroResposta[]> {
  const linhas = await l.consultar(
    `SELECT p.competencia, p.situacao, p.fechado_em, uf.login AS fechou, p.quantidade_registros, p.reaberto_em,
            ur.login AS reabriu, p.justificativa_reabertura
       FROM periodo_financeiro p
       LEFT JOIN usuario uf ON uf.id = p.fechamento_usuario_id
       LEFT JOIN usuario ur ON ur.id = p.reabertura_usuario_id
      WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL
      ORDER BY p.competencia DESC LIMIT 36`,
    [est],
  );
  return linhas.map((r) => ({
    competencia: dataIso(r['competencia']) ?? '',
    situacao: String(r['situacao']) as SituacaoPeriodo,
    fechadoEm: instante(r['fechado_em']),
    fechadoPor: r['fechou'] ? String(r['fechou']) : null,
    movimentos: r['quantidade_registros'] === null ? null : numero(r['quantidade_registros']),
    reabertoEm: instante(r['reaberto_em']),
    reabertoPor: r['reabriu'] ? String(r['reabriu']) : null,
    justificativa: r['justificativa_reabertura'] ? String(r['justificativa_reabertura']) : null,
  }));
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
