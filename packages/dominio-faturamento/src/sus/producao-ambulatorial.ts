// Produção ambulatorial (ficha do M51, regra 4; cap-05a §5.3; referência 01 §2.4): a requisição de laboratório
// (RECADATE com LAB='S' e ESPEC=0) não é atendimento e não entra na CIHA nem no BPA. A consulta no banco já filtra
// ESPEC > 0; esta regra confere de novo cada linha lida (e é a que o teste prova).

export interface FichaAmbulatorial {
  /** RECADATE.LAB ('S' na requisição de laboratório). */
  readonly lab: string | null;
  /** RECADATE.ESPEC (0 na requisição). */
  readonly especialidade: number | null;
}

export function ehRequisicaoDeLaboratorio(f: FichaAmbulatorial): boolean {
  return (f.lab ?? '').trim().toUpperCase() === 'S' && (f.especialidade ?? 0) === 0;
}

/** É atendimento (entra na produção)? Precisa de especialidade e não pode ser requisição de laboratório. */
export function ehAtendimentoAmbulatorial(f: FichaAmbulatorial): boolean {
  return !ehRequisicaoDeLaboratorio(f) && (f.especialidade ?? 0) > 0;
}
