// Vínculo assistencial (ficha do M06, regra 7; cap-08 §8.5): sobre dados do legado segue o parâmetro
// PRPARAM.REST_ACESS_PACI_NAO_ESTE_ATEND, igual nos dois sistemas (se o novo restringisse o que o legado
// libera, a pessoa abriria pelo SPDATA sem justificativa nem alerta); nos recursos novos vale sempre. A
// porta responde se há vínculo; até o M15/M21 é servida por massa sintética.

/** Paciente do legado pelo ID (RICADPAC.ID) e, quando houver, o atendimento (REG). */
export interface PacienteAlvo {
  readonly idPaciente: number;
  readonly atendimento?: number | null;
}

export type FormaVinculo = 'internado-no-setor' | 'atendimento-em-curso' | 'agenda-do-dia' | 'equipe';

export interface VinculoAssistencialPort {
  /** Forma do vínculo do usuário com o paciente, ou null sem vínculo. */
  vinculo(login: string, alvo: PacienteAlvo): Promise<FormaVinculo | null>;
}

/** Exige vínculo? Recurso novo: sempre; dado do legado: só com o parâmetro ligado. */
export function exigeVinculo(recursoNovo: boolean, restricaoDoParametro: boolean): boolean {
  return recursoNovo || restricaoDoParametro;
}

/** Porta servida por massa sintética (testes e dev até o M15/M21): pares login × paciente. */
export class VinculoSintetico implements VinculoAssistencialPort {
  private readonly pares: Map<string, FormaVinculo>;
  constructor(pares: readonly { login: string; idPaciente: number; forma: FormaVinculo }[] = []) {
    this.pares = new Map(pares.map((p) => [`${p.login}\u0000${p.idPaciente}`, p.forma]));
  }
  vinculo(login: string, alvo: PacienteAlvo): Promise<FormaVinculo | null> {
    return Promise.resolve(this.pares.get(`${login}\u0000${alvo.idPaciente}`) ?? null);
  }
}
