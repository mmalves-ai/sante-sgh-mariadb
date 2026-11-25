// Instrumento de saída (ficha do M51, regra 1; cap-06b §6.6, Regras): a conta é uma só, com financiador; o instrumento
// é escolhido pelo financiador e pelo instrumento de registro do procedimento na SIGTAP (a
// rl_procedimento_registro da SIGTAP). Convênio sai em guia TISS (M31), particular em recibo (M30) e os dois entram na
// CIHA; o SUS sai em BPA, APAC ou AIH, conforme o registro, e não entra na CIHA.

/** Instrumentos de registro da SIGTAP (tb_registro). */
export const REGISTROS_SIGTAP = {
  '01': 'bpa-c',
  '02': 'bpa-i',
  '03': 'aih-principal',
  '04': 'aih-especial',
  '05': 'aih-secundario',
  '06': 'apac-principal',
  '07': 'apac-secundario',
  // Tabela unificada (tb_registro): 08 é a RAAS da atenção domiciliar e 09 a da atenção psicossocial.
  '08': 'raas-domiciliar',
  '09': 'raas-psicossocial',
} as const;
export type RegistroSigtap = (typeof REGISTROS_SIGTAP)[keyof typeof REGISTROS_SIGTAP];

export function registroSigtap(codigo: string | number | null | undefined): RegistroSigtap | null {
  const k = String(codigo ?? '')
    .trim()
    .padStart(2, '0') as keyof typeof REGISTROS_SIGTAP;
  return REGISTROS_SIGTAP[k] ?? null;
}

/** O financiador da conta: o convênio SUS (convênio de código 1 nos dois hospitais), o particular (10) ou outro convênio. */
export type Financiador = 'sus' | 'particular' | 'convenio';

export interface ConveniosEspeciais {
  /** Códigos de convênio do SUS (parâmetro por estabelecimento; padrão [1]). */
  readonly sus: readonly number[];
  /** Códigos de convênio do particular (padrão [10], o mesmo do M30). */
  readonly particular: readonly number[];
}

export const CONVENIOS_ESPECIAIS_PADRAO: ConveniosEspeciais = { sus: [1], particular: [10] };

export function financiadorDoConvenio(
  convenio: number,
  c: ConveniosEspeciais = CONVENIOS_ESPECIAIS_PADRAO,
): Financiador {
  if (c.sus.includes(convenio)) return 'sus';
  if (c.particular.includes(convenio)) return 'particular';
  return 'convenio';
}

export type InstrumentoCobranca = 'tiss' | 'recibo' | 'bpa-c' | 'bpa-i' | 'apac' | 'aih';

export interface InstrumentoDeSaida {
  /** Por onde o procedimento é cobrado (null: SUS sem registro compatível na SIGTAP, vai para a crítica). */
  readonly cobranca: InstrumentoCobranca | null;
  /** Entra na comunicação da CIHA? (todo não SUS). */
  readonly ciha: boolean;
}

/**
 * Regra 1. Para o SUS, a ordem de preferência pelo tipo de atendimento: internação → AIH (principal, especial ou
 * secundário); ambulatorial → APAC (principal ou secundário), BPA-I e, por último, BPA-C (o BPA-I é preferido quando
 * os dois são permitidos, porque identifica o paciente).
 */
export function instrumentoDeSaida(
  financiador: Financiador,
  modalidade: 'internacao' | 'ambulatorial',
  registros: readonly RegistroSigtap[],
): InstrumentoDeSaida {
  if (financiador === 'convenio') return { cobranca: 'tiss', ciha: true };
  if (financiador === 'particular') return { cobranca: 'recibo', ciha: true };
  const tem = (...r: RegistroSigtap[]) => r.some((x) => registros.includes(x));
  if (modalidade === 'internacao')
    return { cobranca: tem('aih-principal', 'aih-especial', 'aih-secundario') ? 'aih' : null, ciha: false };
  if (tem('apac-principal', 'apac-secundario')) return { cobranca: 'apac', ciha: false };
  if (tem('bpa-i')) return { cobranca: 'bpa-i', ciha: false };
  if (tem('bpa-c')) return { cobranca: 'bpa-c', ciha: false };
  return { cobranca: null, ciha: false };
}
