// Regra 5 do M52 (cap-07 §7.1.2): intervalo interjornada de 11 h entre duas jornadas do mesmo contrato, salvo o regime
// 12x36 previsto em acordo registrado. O sobreaviso não é jornada (não entra na conta; D-SOBRE-52). A exceção só vale
// com o acordo registrado no regime (número e data); sem acordo, o descanso do regime nunca fica abaixo de 11 h
// (D-INTER-52). Teste: `interjornada.spec.ts` (10 h 59 min recusado).
import { INTERJORNADA_MINIMA_MIN, PLANTOES_DE_JORNADA } from '@sgh/contratos';
import { OK, recusar, type Conferencia, type PlantaoProposto } from './plantao.js';
import { minutoLocal } from './tempo.js';

export interface RegraDescanso {
  readonly descansoMinimoMin: number;
  readonly acordo: string | null;
}

/** O descanso mínimo que vale: o do regime, que só fica abaixo de 11 h com acordo registrado. */
export function descansoMinimo(regime: RegraDescanso | null): number {
  if (!regime) return INTERJORNADA_MINIMA_MIN;
  if (regime.acordo && regime.acordo.trim()) return regime.descansoMinimoMin;
  return Math.max(regime.descansoMinimoMin, INTERJORNADA_MINIMA_MIN);
}

const horas = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
};

/**
 * Confere o descanso entre o plantão novo e as outras jornadas do mesmo vínculo (antes e depois). Sobreposição não é
 * desta regra (é a da sobreposição): aqui só os que não se sobrepõem.
 */
export function conferirInterjornada(
  novo: PlantaoProposto,
  outros: readonly PlantaoProposto[],
  regime: RegraDescanso | null,
): Conferencia {
  if (!PLANTOES_DE_JORNADA.includes(novo.tipo)) return OK;
  const minimo = descansoMinimo(regime);
  const a = minutoLocal(novo.inicio);
  const b = minutoLocal(novo.fim);
  for (const o of outros) {
    if (!PLANTOES_DE_JORNADA.includes(o.tipo)) continue;
    const oa = minutoLocal(o.inicio);
    const ob = minutoLocal(o.fim);
    const intervalo = ob <= a ? a - ob : b <= oa ? oa - b : null;
    if (intervalo !== null && intervalo < minimo)
      return recusar(
        'interjornada',
        `O descanso entre as jornadas seria de ${horas(intervalo)}; o mínimo deste contrato é ${horas(minimo)}.`,
      );
  }
  return OK;
}
