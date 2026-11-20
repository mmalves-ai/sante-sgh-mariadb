// Cobertura mínima e furo de escala (M52.2; ficha, seção 6, "cobertura mínima por turno"; regra 9). Na F2 o mínimo é
// o informado pela coordenação na escala; o dimensionamento COFEN 543/2017 (F3) passa a sugerir o número. Um plantão de
// jornada (presencial ou diarista) cobre o turno quando vai do começo ao fim dele (D-TURNO-52): o de 12 h diurno
// (7 h às 19 h) cobre manhã e tarde, o noturno (19 h às 7 h) cobre a noite.
import { CODIGOS_TURNO_ESCALA, PLANTOES_DE_JORNADA, TURNOS_ESCALA, type TurnoEscala } from '@sgh/contratos';
import { diaUtc } from '../datas.js';
import type { PlantaoProposto } from './plantao.js';
import { diasDaCompetencia, minutoLocal } from './tempo.js';

export type Cobertura = Readonly<Record<TurnoEscala, number>>;

export interface Furo {
  readonly dia: string;
  readonly turno: TurnoEscala;
  readonly minimo: number;
  readonly escalados: number;
}

const hm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** A janela do turno no dia, em minutos de relógio. */
export function janelaDoTurno(dia: string, turno: TurnoEscala): { inicio: number; fim: number } {
  const t = TURNOS_ESCALA[turno];
  const base = diaUtc(dia) * 1440;
  return { inicio: base + hm(t.inicio), fim: base + (t.viraODia ? 1440 : 0) + hm(t.fim) };
}

/** Os turnos da competência com menos escalados que o mínimo. */
export function furosDaEscala(
  competencia: string,
  cobertura: Cobertura,
  plantoes: readonly PlantaoProposto[],
): Furo[] {
  const jornadas = plantoes
    .filter((p) => PLANTOES_DE_JORNADA.includes(p.tipo))
    .map((p) => ({ a: minutoLocal(p.inicio), b: minutoLocal(p.fim) }));
  const r: Furo[] = [];
  for (const dia of diasDaCompetencia(competencia))
    for (const turno of CODIGOS_TURNO_ESCALA) {
      const minimo = cobertura[turno];
      if (minimo <= 0) continue;
      const j = janelaDoTurno(dia, turno);
      const escalados = jornadas.filter((p) => p.a <= j.inicio && p.b >= j.fim).length;
      if (escalados < minimo) r.push({ dia, turno, minimo, escalados });
    }
  return r;
}
