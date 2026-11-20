// OIDs que o motor de assinatura conhece de saída (M49; DOC-ICP-04, DOC-ICP-04.01, RFC 5280, RFC 3161). Os OIDs dos
// conselhos profissionais (CRM, COREN e os demais) e os das políticas de assinatura vigentes NÃO ficam no código:
// vêm do cadastro de OIDs (85 linhas no pc, 14 por tipo de conselho) e da lista de políticas do ITI, que mudam de
// versão sem mudar o motor.

/** Otheername da pessoa física: data de nascimento (8), CPF (11), NIS (11), RG (15) e órgão/UF (6). DOC-ICP-04 §7.1.2. */
export const OID_PF_DADOS_TITULAR = '2.16.76.1.3.1';
/** Otheername da pessoa física: título de eleitor. */
export const OID_PF_TITULO_ELEITOR = '2.16.76.1.3.5';
/** Otheername da pessoa física: número do CEI. */
export const OID_PF_CEI = '2.16.76.1.3.6';
/** Otheername da pessoa jurídica: CNPJ. */
export const OID_PJ_CNPJ = '2.16.76.1.3.3';

export const OID_EXT_SUBJECT_ALT_NAME = '2.5.29.17';
export const OID_EXT_KEY_USAGE = '2.5.29.15';
export const OID_EXT_POLITICAS_CERTIFICADO = '2.5.29.32';

export const OID_SHA256 = '2.16.840.1.101.3.4.2.1';

/**
 * Raiz das políticas de certificado da ICP-Brasil por tipo (DOC-ICP-04): A1 (chave em software), A3 (token, cartão ou
 * HSM, inclusive em nuvem) e A4. O tipo é o prefixo do OID da política do certificado.
 */
export const RAIZ_POLITICA_POR_TIPO = {
  A1: '2.16.76.1.2.1',
  A2: '2.16.76.1.2.2',
  A3: '2.16.76.1.2.3',
  A4: '2.16.76.1.2.4',
} as const;
export type TipoCertificadoIcp = keyof typeof RAIZ_POLITICA_POR_TIPO;

/** Tipo ICP-Brasil do certificado pelas políticas dele; null se nenhuma é ICP-Brasil de assinatura. */
export function tipoPelaPolitica(politicas: readonly string[]): TipoCertificadoIcp | null {
  for (const [tipo, raiz] of Object.entries(RAIZ_POLITICA_POR_TIPO) as [TipoCertificadoIcp, string][])
    if (politicas.some((p) => p === raiz || p.startsWith(`${raiz}.`))) return tipo;
  return null;
}

/** OID bem formado (só dígitos e pontos, primeiro arco 0 a 2). */
export const oidValido = (s: string) => /^[0-2](\.(0|[1-9]\d*))+$/.test(s);
