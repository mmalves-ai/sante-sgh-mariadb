// Instantes da anestesia: a entrada chega como "AAAA-MM-DDTHH:mm[:ss]" (contratos); a aritmética usa os minutos
// absolutos do tempo.ts do M18 (sem fuso: os horários são os civis do estabelecimento).
import { deMinutosAbsolutos, minutosAbsolutos } from '../tempo.js';

/** Minutos absolutos de um instante local com "T" ou espaço; os segundos são ignorados. */
export function minutosDoInstante(v: string): number {
  return minutosAbsolutos(v.trim().replace('T', ' ').slice(0, 16));
}

/** Instante local "AAAA-MM-DDTHH:mm" dos minutos absolutos. */
export function instanteDosMinutos(min: number): string {
  return deMinutosAbsolutos(min).replace(' ', 'T');
}

export function somarAoInstante(v: string, min: number): string {
  return instanteDosMinutos(minutosDoInstante(v) + min);
}
