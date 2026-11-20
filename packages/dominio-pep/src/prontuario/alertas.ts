// Alertas ao Auditor sobre as leituras do prontuário (regra 12 da ficha do M15; cap-08 §8.12): muitos
// prontuários diferentes em pouco tempo e acesso fora do horário habitual. Os limites vêm dos parâmetros do
// sistema novo (SGH_CFG_PARAMETRO); o nível de criticidade, do cadastro de níveis do legado. Regra pura: a API
// guarda as aberturas recentes de cada usuário (só o ID do paciente e o instante) e pergunta a cada abertura.

export interface LimitesLeitura {
  /** Janela, em minutos, da contagem de prontuários diferentes. */
  readonly janelaMinutos: number;
  /** Mais que isto na janela gera alerta. */
  readonly maxPacientes: number;
  /** Horário habitual (hora local do estabelecimento, 0–23), início inclusive e fim exclusivo. */
  readonly inicioHabitual: number;
  readonly fimHabitual: number;
}

export const LIMITES_PADRAO: LimitesLeitura = {
  janelaMinutos: 60,
  maxPacientes: 30,
  inicioHabitual: 6,
  fimHabitual: 22,
};

export type TipoAlertaLeitura = 'muitos-prontuarios' | 'fora-do-horario';

export interface AlertaLeitura {
  readonly tipo: TipoAlertaLeitura;
  /** Nível de criticidade (cadastro de níveis do legado: 2 alerta, 4 erro, 7 informativo). */
  readonly criticidade: 2 | 4 | 7;
  readonly detalhe: string;
}

export interface AberturaRecente {
  readonly paciente: number;
  readonly em: number;
}

function dentroDoHorario(hora: number, l: LimitesLeitura): boolean {
  return l.inicioHabitual <= l.fimHabitual
    ? hora >= l.inicioHabitual && hora < l.fimHabitual
    : hora >= l.inicioHabitual || hora < l.fimHabitual;
}

/**
 * Avalia uma abertura nova. `horaLocal` é a hora do estabelecimento (America/Sao_Paulo) no instante da
 * abertura. O alerta de volume sai uma vez, quando o limite é ultrapassado (não a cada abertura seguinte).
 */
export function avaliarLeitura(
  recentes: readonly AberturaRecente[],
  nova: AberturaRecente,
  horaLocal: number,
  l: LimitesLeitura = LIMITES_PADRAO,
): AlertaLeitura[] {
  const alertas: AlertaLeitura[] = [];
  const desde = nova.em - l.janelaMinutos * 60_000;
  const naJanela = recentes.filter((r) => r.em >= desde && r.em <= nova.em);
  const antes = new Set(naJanela.map((r) => r.paciente));
  const depois = new Set([...antes, nova.paciente]);
  if (depois.size > l.maxPacientes && antes.size <= l.maxPacientes)
    alertas.push({
      tipo: 'muitos-prontuarios',
      criticidade: 2,
      detalhe: `${depois.size} prontuários diferentes em ${l.janelaMinutos} min (limite ${l.maxPacientes})`,
    });
  const primeiraDoPaciente = !naJanela.some((r) => r.paciente === nova.paciente);
  if (!dentroDoHorario(horaLocal, l) && primeiraDoPaciente)
    alertas.push({
      tipo: 'fora-do-horario',
      criticidade: 4,
      detalhe: `abertura às ${String(horaLocal).padStart(2, '0')} h, fora do horário habitual (${l.inicioHabitual} h às ${l.fimHabitual} h)`,
    });
  return alertas;
}

/** Hora local do estabelecimento (America/Sao_Paulo), sem depender do fuso do processo. */
export function horaLocal(instante: number, fuso = 'America/Sao_Paulo'): number {
  const h = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', hourCycle: 'h23', timeZone: fuso }).format(
    new Date(instante),
  );
  return Number(h) % 24;
}
