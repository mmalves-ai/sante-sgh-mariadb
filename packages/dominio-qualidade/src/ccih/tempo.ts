// Datas da CCIH: instantes locais (`AAAA-MM-DDTHH:mm[:ss]`, o horário de parede do estabelecimento) e datas civis
// (`AAAA-MM-DD`), contados em UTC sobre o texto local (o Brasil não tem horário de verão desde 2019), como o NSP.
import { msLocal } from '../nsp/prazos.js';

const DIA_MS = 86_400_000;

/** A data civil do instante (ou a própria data). */
export const diaDe = (instante: string): string => instante.slice(0, 10);

export function somarDias(data: string, dias: number): string {
  return new Date(msLocal(data) + dias * DIA_MS).toISOString().slice(0, 10);
}

/** Dias corridos de `de` até `ate` (datas civis; negativo se `ate` vem antes). */
export function diferencaDias(de: string, ate: string): number {
  return Math.round((msLocal(diaDe(ate)) - msLocal(diaDe(de))) / DIA_MS);
}

/** As datas civis da competência `AAAA-MM`. */
export function diasDaCompetencia(competencia: string): string[] {
  const [a, m] = competencia.split('-').map(Number) as [number, number];
  const total = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return Array.from({ length: total }, (_, i) => `${competencia}-${String(i + 1).padStart(2, '0')}`);
}

/** O primeiro e o último dia da competência. */
export function limitesDaCompetencia(competencia: string): { de: string; ate: string } {
  const dias = diasDaCompetencia(competencia);
  return { de: dias[0] as string, ate: dias[dias.length - 1] as string };
}
