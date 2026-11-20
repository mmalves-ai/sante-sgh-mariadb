// Regra 8 do M32 (cap-06b §6.8; DP-46.3): a situação do título é DERIVADA do par data de pagamento e borderô, não de
// STATUS. O STATUS gravado é o que o outro sistema grava em cada cenário (0 = 60.254, 1 = 11.013), com a legenda
// "a confirmar" até a DP-46.3: 1 parece "baixa sem borderô ou remessa" e 0 "pago por borderô ou remessa, ou ainda
// aberto" (confiança baixa a média).
import { dataVazia, TOLERANCIA } from './recusa.js';

export const SITUACOES_TITULO_PAGAR = ['aberto', 'vencido', 'em-bordero', 'pago', 'pago-parcial'] as const;
export type SituacaoTituloPagar = (typeof SITUACOES_TITULO_PAGAR)[number];

export const ROTULO_SITUACAO_PAGAR: Readonly<Record<SituacaoTituloPagar, string>> = {
  aberto: 'Em aberto',
  vencido: 'Vencido',
  'em-bordero': 'Em borderô',
  pago: 'Pago',
  'pago-parcial': 'Pago a menor',
};

export interface TituloParaSituacao {
  readonly vencimento: string | null;
  readonly dataPagamento: string | null;
  readonly valor: number;
  readonly pago: number;
  readonly bordero: number;
}

export function situacaoTituloPagar(t: TituloParaSituacao, hoje: string): SituacaoTituloPagar {
  if (!dataVazia(t.dataPagamento) || t.pago > 0)
    return t.pago + TOLERANCIA >= t.valor ? 'pago' : 'pago-parcial';
  if (t.bordero > 0) return 'em-bordero';
  if (t.vencimento && t.vencimento.slice(0, 10) < hoje) return 'vencido';
  return 'aberto';
}

/** Legenda do STATUS gravado (DP-46.3): só exibido, nunca usado para decidir. */
export function legendaStatusPagar(status: number | null): string {
  if (status === 1) return '1 — baixa sem borderô (a confirmar)';
  if (status === 0) return '0 — por borderô ou em aberto (a confirmar)';
  return status === null ? '—' : `${status} (a confirmar)`;
}

/** STATUS que o outro sistema grava em cada cenário da baixa (só valores vistos; DP-46.3). */
export const STATUS_DA_BAIXA = { 'pagar-sem-bordero': 1, 'pagar-por-bordero': 0 } as const;

/** Formas de pagamento vistas (MFCONPAG.TP_PGTO e MFCTAREC.TP_PGTO): legenda candidata em TBTIPOPAGFOR (DP-46.3). */
export const TP_PGTO_VISTOS = [0, 1, 11, 12, 13, 21, 22, 23, 24, 31, 33, 34, 80, 81, 82, 83, 84, 85] as const;
export const tpPgtoVisto = (n: number): boolean => (TP_PGTO_VISTOS as readonly number[]).includes(n);
