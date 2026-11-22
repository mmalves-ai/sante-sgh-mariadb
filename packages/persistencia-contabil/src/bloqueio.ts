// Regra pura do bloqueio do período contábil para um novo lançamento (sem banco): o período encerrado ou bloqueado não
// aceita lançamento, e o bloqueio diário (bloqueado_ate) recusa a data até aquele dia, inclusive. A porta própria a
// aplica na transação que trava o período. Pedido do lote 04-01: levar a regra e a situação "bloqueado" ao
// @sgh/dominio-contabil e ao contrato do período (SITUACOES_PERIODO), para a tela e o domínio a conhecerem.

export interface PeriodoParaLancar {
  readonly situacao: string;
  /** Bloqueio diário (AAAA-MM-DD): nenhum lançamento com data até este dia. */
  readonly bloqueadoAte: string | null;
}

export interface BloqueioDoLancamento {
  readonly codigo: 'periodo-encerrado' | 'periodo-bloqueado' | 'data-bloqueada';
  readonly mensagem: string;
}

const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

export function bloqueioDoLancamento(
  periodo: PeriodoParaLancar,
  data: string,
  competencia: string,
): BloqueioDoLancamento | null {
  if (periodo.situacao === 'encerrado')
    return {
      codigo: 'periodo-encerrado',
      mensagem: `A competência ${competencia} está encerrada: reabra-a para lançar.`,
    };
  if (periodo.situacao === 'bloqueado')
    return {
      codigo: 'periodo-bloqueado',
      mensagem: `A competência ${competencia} está bloqueada para lançamentos: reabra-a para lançar.`,
    };
  if (periodo.bloqueadoAte !== null && data.slice(0, 10) <= periodo.bloqueadoAte)
    return {
      codigo: 'data-bloqueada',
      mensagem: `Os lançamentos estão bloqueados até ${dataBr(periodo.bloqueadoAte)}: escolha uma data posterior.`,
    };
  return null;
}

/** O aviso do bloqueio na observação do período (a tela ainda não conhece a situação "bloqueado"). */
export function avisoDoBloqueio(periodo: PeriodoParaLancar): string | null {
  if (periodo.situacao === 'bloqueado') return 'Período bloqueado para lançamentos.';
  if (periodo.bloqueadoAte !== null) return `Lançamentos bloqueados até ${dataBr(periodo.bloqueadoAte)}.`;
  return null;
}
