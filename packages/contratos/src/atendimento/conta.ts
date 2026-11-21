// Regra 2 da ficha do M20 (cap-05a §5.3): antes de lançar procedimento extra, conferir a situação da conta externa e
// AVISAR. O gatilho do legado (TRG_REPROEXT_AI) deixa de lançar em silêncio quando a conta está fechada (S),
// apresentada (A) ou emitida (IND_EMI = T): o item some sem erro. O novo recusa antes, com a mensagem, e o faturista
// reabre a conta (M30, Fase 3) ou o lançamento é feito depois. Contas externas de 2025-10 a 2026-09 (cópia pc, só
// contagens): A/T 26.222, N/F 2.312, S/T 1.776, N/T 16. No contrato (a receita do legado também a usa e não pode
// importar domínio; D-CONT-19); @sgh/dominio-atendimento a reexporta.
import { SITUACOES_CONTA, type SituacaoConta } from './vocabulario.js';

export interface ContaLida {
  /** Situação da conta: N aberta, S fechada, A apresentada; null: o atendimento não tem conta. */
  readonly fechada: string | null;
  /** Emissão da conta: T emitida. */
  readonly emitida: string | null;
}

/** Situação da conta pela regra do gatilho (a emissão vence a abertura: N/T é emitida). */
export function situacaoDaConta(c: ContaLida | null): SituacaoConta {
  if (!c || c.fechada === null) return 'semConta';
  const f = c.fechada.trim().toUpperCase();
  if (f === 'S') return 'fechada';
  if (f === 'A') return 'apresentada';
  if ((c.emitida ?? '').trim().toUpperCase() === 'T') return 'emitida';
  if (f === 'N') return 'aberta';
  // Valor fora do domínio visto: não adivinha (trata como fechada, que não lança).
  return 'fechada';
}

export function rotuloConta(s: SituacaoConta): string {
  return SITUACOES_CONTA.find((x) => x.codigo === s)?.rotulo ?? s;
}

export function permiteLancar(s: SituacaoConta): boolean {
  return SITUACOES_CONTA.find((x) => x.codigo === s)?.permiteLancar ?? false;
}

/** A mensagem do aviso (sem citar outro sistema): o que aconteceria e o que fazer. */
export function avisoContaSemLancamento(s: SituacaoConta): string | null {
  switch (s) {
    case 'aberta':
      return null;
    case 'semConta':
      return 'Este atendimento não tem conta de convênio (SUS ou sem faturamento): o procedimento não iria para a conta.';
    case 'emitida':
      return 'A conta deste atendimento já foi emitida: o procedimento não entraria nela. Peça ao faturamento para reabrir a conta, ou lance depois.';
    case 'apresentada':
      return 'A conta deste atendimento já foi apresentada ao convênio: o procedimento não entraria nela. Peça ao faturamento para reabrir a conta, ou lance depois.';
    case 'fechada':
      return 'A conta deste atendimento está fechada: o procedimento não entraria nela. Peça ao faturamento para reabrir a conta, ou lance depois.';
  }
}
