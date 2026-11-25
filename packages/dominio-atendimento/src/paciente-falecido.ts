// 02-CAD linha 13: o óbito registrado no cadastro (emissão da declaração de óbito) fecha a porta de entrada do paciente.
// Nenhum ato novo de cuidado começa para quem morreu: abertura de atendimento, marcação de horário, admissão e
// pré-internação recusam com o motivo e a data do óbito. O que já existe (prontuário, contas, documentos) segue
// legível e nunca é apagado; a declaração cancelada devolve o paciente à situação de vivo.

/** O ato que abriria um cuidado novo para o paciente. */
export type AtoDeEntrada = 'atendimento' | 'marcacao' | 'internacao' | 'pre-internacao';

/** O que o cadastro diz sobre a vida do paciente (lido do banco pela porta). */
export interface VidaDoPaciente {
  /** Atributo derivado da declaração de óbito emitida. */
  readonly falecido: boolean;
  /** A situação do cadastro; 'obito' também vale como falecido (cadastro antigo sem a declaração ligada). */
  readonly situacao?: string | null;
  /** Data do óbito copiada da declaração (AAAA-MM-DD ou ISO), quando conhecida. */
  readonly dataObito?: string | null;
}

export type RecusaPorObito =
  | { readonly ok: true }
  | { readonly ok: false; readonly codigo: 'paciente-falecido'; readonly mensagem: string };

const DO_ATO: Record<AtoDeEntrada, string> = {
  atendimento: 'abrir atendimento',
  marcacao: 'marcar horário',
  internacao: 'internar',
  'pre-internacao': 'agendar internação',
};

/** Data do óbito em DD/MM/AAAA, sem fuso (a parte da data da cópia gravada). */
function dataBr(d: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d ?? '').trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

/** O paciente está falecido pelo cadastro: o atributo da declaração ou a situação 'obito'. */
export function pacienteFalecido(v: VidaDoPaciente): boolean {
  return v.falecido === true || v.situacao === 'obito';
}

/**
 * Recusa o ato de entrada para o paciente falecido. Vem antes da conferência de cadastro inativo, para a recepção
 * ver o motivo certo (e não "cadastro inativo").
 */
export function recusarEntradaDeFalecido(v: VidaDoPaciente, ato: AtoDeEntrada): RecusaPorObito {
  if (!pacienteFalecido(v)) return { ok: true };
  const data = dataBr(v.dataObito);
  return {
    ok: false,
    codigo: 'paciente-falecido',
    mensagem: `Não é possível ${DO_ATO[ato]}: o paciente tem óbito registrado${data ? ` em ${data}` : ''}.`,
  };
}
