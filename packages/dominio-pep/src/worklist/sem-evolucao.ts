// Internado sem evolução médica nas últimas 24 horas (ficha do M27, regra 3; cap-05b §5.6, alertas de completude;
// ref 01 §3.16): contam os registros dos DOIS sistemas (a evolução lida no banco do estabelecimento, venha do novo ou do
// outro sistema); a evolução suspensa não conta; só a evolução médica (CBO 225…). Limite exato: a evolução feita há
// 24 h em ponto ainda está "nas últimas 24 h" (sem alerta); um milissegundo depois, alerta. Sem evolução médica, conta
// a entrada: recém-internado há menos de 24 h ainda não alerta.

export interface EvolucaoDoEpisodio {
  /** ISO do horário clínico da evolução. */
  readonly em: string;
  /** CBO do autor (225… = médico). */
  readonly cbo: string | null;
  readonly suspensa: boolean;
}

export const JANELA_EVOLUCAO_MS = 24 * 3_600_000;

/** A evolução conta para o alerta (médica e não suspensa). */
export function evolucaoMedicaValida(e: EvolucaoDoEpisodio): boolean {
  return !e.suspensa && (e.cbo ?? '').replace(/\D/g, '').startsWith('225');
}

/** O instante de referência: a última evolução médica válida, ou a entrada quando não há nenhuma. */
export function referenciaDaEvolucao(
  evolucoes: readonly EvolucaoDoEpisodio[],
  entrada: string | null,
): number | null {
  const validas = evolucoes
    .filter(evolucaoMedicaValida)
    .map((x) => Date.parse(x.em))
    .filter(Number.isFinite);
  if (validas.length) return Math.max(...validas);
  const t = entrada ? Date.parse(entrada) : NaN;
  return Number.isFinite(t) ? t : null;
}

/** Internado sem evolução médica nas últimas 24 h (estritamente mais de 24 h desde a referência). */
export function semEvolucaoMedica24h(e: {
  readonly internado: boolean;
  readonly evolucoes: readonly EvolucaoDoEpisodio[];
  readonly entrada: string | null;
  readonly agora: Date;
}): boolean {
  if (!e.internado) return false;
  const ref = referenciaDaEvolucao(e.evolucoes, e.entrada);
  return ref !== null && e.agora.getTime() - ref > JANELA_EVOLUCAO_MS;
}

/** Horas desde a última evolução médica válida (arredondadas para baixo), ou null. */
export function horasSemEvolucao(
  evolucoes: readonly EvolucaoDoEpisodio[],
  entrada: string | null,
  agora: Date,
): number | null {
  const ref = referenciaDaEvolucao(evolucoes, entrada);
  return ref === null ? null : Math.max(0, Math.floor((agora.getTime() - ref) / 3_600_000));
}
