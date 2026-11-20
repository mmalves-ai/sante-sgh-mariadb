// Competência do estoque (ficha do M28, regra 9): lançamento em mês fechado é recusado nas telas do novo. O fechamento
// é por ano e mês (o registro do mês fechado); reabrir exige a permissão específica e o motivo (P2).
import { recusa, type RecusaSuprimentos } from './recusa.js';

export interface Competencia {
  readonly ano: number;
  readonly mes: number;
}

export const chaveCompetencia = (c: Competencia): number => c.ano * 100 + c.mes;

export function rotuloCompetencia(c: Competencia): string {
  return `${String(c.mes).padStart(2, '0')}/${c.ano}`;
}

/** Fechado quando o mês está entre os fechados (cada mês fechado é um registro). */
export function mesFechado(c: Competencia, fechados: readonly Competencia[]): boolean {
  const k = chaveCompetencia(c);
  return fechados.some((f) => chaveCompetencia(f) === k);
}

/** Regra 9. */
export function conferirCompetencia(
  c: Competencia,
  fechados: readonly Competencia[],
): RecusaSuprimentos | null {
  return mesFechado(c, fechados)
    ? recusa(
        'mes-fechado',
        `O mês ${rotuloCompetencia(c)} já foi fechado no estoque: o lançamento não é aceito.`,
        ['data'],
      )
    : null;
}

/** O próximo mês a fechar: o seguinte ao último fechado (ou o corrente, sem fechamento). */
export function proximoAFechar(fechados: readonly Competencia[], corrente: Competencia): Competencia {
  if (fechados.length === 0) return corrente;
  const u = fechados.reduce((a, b) => (chaveCompetencia(b) > chaveCompetencia(a) ? b : a));
  return u.mes === 12 ? { ano: u.ano + 1, mes: 1 } : { ano: u.ano, mes: u.mes + 1 };
}

/** Reabrir: só o último fechado, com a permissão de desbloqueio e o motivo. */
export function conferirReabertura(
  c: Competencia,
  fechados: readonly Competencia[],
  o: { podeReabrir: boolean; motivo: string },
): RecusaSuprimentos | null {
  if (!o.podeReabrir)
    return recusa('sem-permissao-reabrir', 'Seu usuário não tem a permissão de desbloquear o fechamento.');
  if (o.motivo.trim().length < 10)
    return recusa('sem-motivo', 'Escreva o motivo da reabertura (10 letras ou mais).', ['motivo']);
  if (!mesFechado(c, fechados)) return recusa('mes-aberto', 'O mês não está fechado.');
  const ultimo = Math.max(...fechados.map(chaveCompetencia));
  return chaveCompetencia(c) !== ultimo
    ? recusa('nao-e-o-ultimo', 'Só o último mês fechado pode ser reaberto.')
    : null;
}
