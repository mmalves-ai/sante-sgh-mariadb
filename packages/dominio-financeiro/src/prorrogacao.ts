// F3.8, 07-FIN linha 63: prorrogar o vencimento da parcela a pagar. A parcela guarda o vencimento vigente e o original
// (que nunca muda); cada prorrogação fica no histórico com o anterior, o novo, o motivo, quem e quando. Regra pura.
import { type RecusaFinanceiro, recusaFin } from '@sgh/contratos/regras-financeiro';

export interface ParcelaProrrogavel {
  /** Situação da parcela: aberta, parcial, paga, cancelada, renegociada, bloqueada. */
  readonly situacao: string;
  readonly saldo: number;
  /** Vencimento vigente (AAAA-MM-DD). */
  readonly vencimento: string;
  /** A parcela já está num borderô ou remessa ainda não liquidados (o banco paga na data combinada). */
  readonly emLotePendente: boolean;
}

/** O motivo mínimo: 5 letras (o histórico tem de dizer por que, não só "ok"). */
export const MOTIVO_PRORROGACAO_MINIMO = 5;
/** O teto de uma prorrogação: um ano além do vencimento vigente (além disso é renegociação). */
export const PRORROGACAO_DIAS_MAXIMO = 366;

const dias = (de: string, ate: string): number =>
  Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);

/**
 * Confere a prorrogação: só a parcela com saldo em aberto, fora de borderô ou remessa pendente, para uma data posterior
 * ao vencimento vigente (antecipar não é prorrogar) e até um ano depois, com motivo.
 */
export function conferirProrrogacao(
  p: ParcelaProrrogavel,
  novo: string,
  motivo: string,
): RecusaFinanceiro | null {
  if (!['aberta', 'parcial', 'bloqueada'].includes(p.situacao) || !(p.saldo > 0))
    return recusaFin(
      'parcela-nao-prorrogavel',
      'Só a parcela com saldo em aberto pode ter o vencimento prorrogado.',
    );
  if (p.emLotePendente)
    return recusaFin(
      'parcela-em-lote',
      'A parcela está num borderô ou remessa ainda não liquidados: tire-a do lote antes de prorrogar.',
    );
  if (!/^\d{4}-\d{2}-\d{2}$/.test(novo) || Number.isNaN(Date.parse(`${novo}T00:00:00Z`)))
    return recusaFin('data-invalida', 'Informe o novo vencimento.', ['vencimento']);
  const d = dias(p.vencimento, novo);
  if (d <= 0)
    return recusaFin(
      'prorrogacao-para-tras',
      'O novo vencimento tem de ser depois do vencimento atual (antecipar não é prorrogar).',
      ['vencimento'],
    );
  if (d > PRORROGACAO_DIAS_MAXIMO)
    return recusaFin('prorrogacao-longa', 'Prorrogação de mais de um ano: faça a renegociação do título.', [
      'vencimento',
    ]);
  if (motivo.trim().length < MOTIVO_PRORROGACAO_MINIMO)
    return recusaFin('motivo-obrigatorio', 'Diga o motivo da prorrogação (vai para o histórico).', [
      'motivo',
    ]);
  return null;
}

/** Dias de prorrogação acumulados entre o vencimento original e o vigente (0 quando nunca prorrogada). */
export function diasProrrogados(original: string, vigente: string): number {
  return Math.max(0, dias(original, vigente));
}
