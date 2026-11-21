// Regra 6 do M52 (ref 02; cap-07 §7.1.2): limite de horas do contrato. No tempo parcial (domínio de tempo parcial: 1 = 25 h,
// 2 = 30 h, 3 = 26 h semanais) vale o limite do domínio; fora dele, o limite semanal do regime; sem regime, o teto do
// tipo de vínculo (D-CARGA-52). A conta é por semana de segunda a domingo, só com as jornadas (presencial e diarista),
// dividindo o plantão que atravessa a virada da semana (D-LIM-52). Teste: `limite-contrato.spec.ts`.
import { LIMITES_TEMPO_PARCIAL, PLANTOES_DE_JORNADA, type TipoVinculo } from '@sgh/contratos';
import { limiteCargaSemanal } from '../colaborador/vinculo.js';
import { OK, recusar, type Conferencia, type PlantaoProposto } from './plantao.js';
import { minutosPorSemana } from './tempo.js';

export interface RegraLimite {
  /** Código de tempo parcial do regime (0: não é tempo parcial). */
  readonly contratoParcial: number;
  /** O limite semanal lido no domínio para o código (null: a coluna veio vazia; vale a legenda da ref 02). */
  readonly limiteParcialDominio: number | null;
  readonly limiteSemanalHoras: number;
}

/** O limite semanal, em horas, que a escala aplica ao vínculo. */
export function limiteSemanalEfetivo(regime: RegraLimite | null, tipoVinculo: TipoVinculo): number {
  if (!regime) return limiteCargaSemanal(tipoVinculo);
  if (regime.contratoParcial > 0) {
    const doDominio = regime.limiteParcialDominio;
    const padrao = LIMITES_TEMPO_PARCIAL[regime.contratoParcial] ?? null;
    const l = doDominio !== null && doDominio > 0 ? doDominio : padrao;
    if (l !== null) return l;
  }
  return regime.limiteSemanalHoras;
}

const fmt = (min: number) => {
  const h = min / 60;
  return Number.isInteger(h) ? `${h} h` : `${h.toFixed(1).replace('.', ',')} h`;
};

const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** Confere as semanas que o plantão novo toca, somando as outras jornadas do mesmo vínculo. */
export function conferirLimiteSemanal(
  novo: PlantaoProposto,
  outros: readonly PlantaoProposto[],
  limiteHoras: number,
): Conferencia {
  if (!PLANTOES_DE_JORNADA.includes(novo.tipo)) return OK;
  const doNovo = minutosPorSemana([novo]);
  const total = minutosPorSemana([...outros.filter((o) => PLANTOES_DE_JORNADA.includes(o.tipo)), novo]);
  for (const semana of [...doNovo.keys()].sort()) {
    const m = total.get(semana) ?? 0;
    if (m > limiteHoras * 60)
      return recusar(
        'limite-do-contrato',
        `Na semana de ${dataBr(semana)} o colaborador passaria a ${fmt(m)} de jornada; o limite do contrato é ${limiteHoras} h semanais.`,
      );
  }
  return OK;
}

/** As horas de jornada de cada semana da lista, para a grade (horas com uma casa). */
export function horasPorSemana(plantoes: readonly PlantaoProposto[]): Map<string, number> {
  const m = minutosPorSemana(plantoes.filter((o) => PLANTOES_DE_JORNADA.includes(o.tipo)));
  return new Map([...m].map(([k, v]) => [k, Math.round((v / 60) * 10) / 10]));
}
