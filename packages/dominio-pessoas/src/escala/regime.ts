// Modelos de regime e jornada (M52.2; ficha, seção 6, SGH_PES_REGIME; regras 5 e 6): a sigla única, a duração do
// plantão e o descanso coerentes, o acordo para a exceção da interjornada e o limite semanal. O regime do vínculo vale
// a partir de uma data (só inclusão): o que vale num dia é o de maior "desde" até aquele dia.
import { INTERJORNADA_MINIMA_MIN } from '@sgh/contratos';
import { diasEntre } from '../datas.js';
import { OK, recusar, type Conferencia } from './plantao.js';

export interface RegimeProposto {
  readonly minutosPlantao: number;
  readonly descansoMinimoMin: number;
  readonly limiteSemanalHoras: number;
  readonly acordo: string | null;
}

export function conferirRegime(r: RegimeProposto): Conferencia {
  if (r.descansoMinimoMin < INTERJORNADA_MINIMA_MIN && !(r.acordo && r.acordo.trim()))
    return recusar(
      'descanso-sem-acordo',
      'Descanso abaixo de 11 horas só com o acordo ou a convenção coletiva registrados no regime.',
    );
  if (r.minutosPlantao > r.limiteSemanalHoras * 60)
    return recusar('plantao-acima-do-limite', 'O plantão do regime é maior que o limite semanal.');
  return OK;
}

export interface VigenciaDeRegime {
  readonly regime: number;
  readonly desde: string;
}

/** O regime que vale no dia (a vigência de maior "desde" até o dia; null se nenhuma). */
export function regimeNoDia<T extends VigenciaDeRegime>(vigencias: readonly T[], dia: string): T | null {
  let melhor: T | null = null;
  for (const v of vigencias)
    if (diasEntre(v.desde, dia) >= 0 && (!melhor || diasEntre(melhor.desde, v.desde) >= 0)) melhor = v;
  return melhor;
}
