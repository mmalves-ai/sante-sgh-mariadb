// F3.7 (06-FAT linha 39) e F7 (07-FIN linha 92): a devolução do saldo do adiantamento ao paciente passa por duas
// pessoas (segregação de funções, boa prática de controle interno de caixa): quem pede não aprova.
// - Pedido: a devolução nasce "solicitada" e reserva o valor; o saldo disponível para outro pedido é o saldo menos o
//   que já está pedido e não decidido.
// - Decisão: a aprovação (por outra pessoa) efetiva a devolução; o cancelamento (pelo próprio ou por outro, com motivo)
//   libera a reserva. Só a solicitada é decidida; a decidida fica como está (nada é apagado).

export type SituacaoDevolucao = 'solicitada' | 'aprovada' | 'devolvida' | 'cancelada';
export type DecisaoDevolucao = 'aprovar' | 'cancelar';

export interface RecusaDevolucao {
  readonly codigo: string;
  readonly mensagem: string;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/** O que ainda pode ser pedido em devolução: o saldo menos os pedidos ainda não decididos (nunca negativo). */
export function disponivelParaDevolver(saldo: number, pendentes: readonly number[]): number {
  return Math.max(0, r2(saldo - pendentes.reduce((t, v) => t + v, 0)));
}

/** Confere a decisão sobre o pedido de devolução (nulo: pode decidir). */
export function conferirDecisaoDevolucao(e: {
  readonly situacao: SituacaoDevolucao;
  readonly solicitante: number | null;
  readonly decisor: number;
  readonly decisao: DecisaoDevolucao;
}): RecusaDevolucao | null {
  if (e.situacao !== 'solicitada')
    return {
      codigo: 'devolucao-decidida',
      mensagem: 'A devolução já foi decidida: só o pedido em aberto é aprovado ou cancelado.',
    };
  if (e.decisao === 'aprovar' && (e.solicitante === null || e.solicitante === e.decisor))
    return {
      codigo: 'aprovacao-pelo-solicitante',
      mensagem: 'A devolução é aprovada por outra pessoa, não por quem a pediu.',
    };
  return null;
}
