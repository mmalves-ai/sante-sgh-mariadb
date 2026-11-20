// Identificação SUS (ficha do M51, regra 5; DP-47.12): paciente com CNS ou CPF válido (o CPF é o identificador
// principal do novo; o CNS, quando houver, vai no campo próprio do leiaute); profissional executante com CNS ou CPF e
// CBO. O validador do CNS é o do M11 (@sgh/dominio-cadastro), injetado pela API: domínio não depende de domínio
// (fronteira Nx). Nenhum número sai daqui em log; a crítica só diz qual regra falhou.
import { cpfValido, somenteDigitos } from '@sgh/contratos';

export interface DocumentosPessoa {
  readonly cns: string | null;
  readonly cpf: string | null;
}

export type ValidadorCns = (cns: string) => boolean;

export type ProblemaIdentificacao = 'sem-identificacao' | 'cns-invalido' | 'cpf-invalido';

export interface Identificacao {
  /** CNS válido (null quando não há ou é inválido). */
  readonly cns: string | null;
  /** CPF válido (null quando não há ou é inválido). */
  readonly cpf: string | null;
  readonly problemas: readonly ProblemaIdentificacao[];
}

/** O número como o legado guarda: '0', vazio ou só zeros é "não informado". */
export function documentoInformado(v: string | null | undefined): string | null {
  const d = somenteDigitos(String(v ?? ''));
  return d.length === 0 || /^0+$/.test(d) ? null : d;
}

/**
 * Regra 5. Basta um documento válido. O inválido informado vira problema mesmo quando o outro é válido? Não: o
 * inválido só é acusado quando não sobra documento válido (decisão do preparo, POL-5: a CIHA aceita CNS ou CPF e a
 * correção do cadastro é do M11; o aviso do documento inválido aparece na ficha do paciente).
 */
export function identificarPessoa(d: DocumentosPessoa, cnsValido: ValidadorCns): Identificacao {
  const cns = documentoInformado(d.cns);
  const cpf = documentoInformado(d.cpf)?.padStart(11, '0') ?? null;
  const cnsOk = cns !== null && cnsValido(cns) ? cns : null;
  const cpfOk = cpf !== null && cpfValido(cpf) ? cpf : null;
  if (cnsOk || cpfOk) return { cns: cnsOk, cpf: cpfOk, problemas: [] };
  const problemas: ProblemaIdentificacao[] = [];
  if (cns !== null) problemas.push('cns-invalido');
  if (cpf !== null) problemas.push('cpf-invalido');
  if (problemas.length === 0) problemas.push('sem-identificacao');
  return { cns: null, cpf: null, problemas };
}

/** CBO no formato da tabela do Ministério (6 caracteres: 4 dígitos, um dígito ou letra e um dígito). */
export function cboValido(cbo: string | null | undefined): boolean {
  return /^\d{4}[0-9A-Z]\d$/.test((cbo ?? '').trim().toUpperCase());
}

/** CNES do estabelecimento: 7 dígitos, nunca zero (no banco de dev, TBEMPHOS.CNES está zerado: vem do parâmetro). */
export function cnesValido(cnes: string | number | null | undefined): boolean {
  const d = somenteDigitos(String(cnes ?? ''));
  return /^\d{1,7}$/.test(d) && Number(d) > 0;
}
