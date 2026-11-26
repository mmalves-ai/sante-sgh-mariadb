// Foto do paciente para a identificação positiva (F3.1, 02-CAD linha 5; decisão da classe C, 26/11): a fase 1 é só a
// foto facial, captada na ficha (webcam ou arquivo) e conferida na recepção e na guia.
//   - Base legal: LGPD art. 11, II, f (tutela da saúde, por profissional de saúde) e g (prevenção à fraude e segurança
//     do titular na identificação). Não depende de consentimento: o termo, se houver, é só registro.
//   - Retenção: a do prontuário (Lei 13.787/2018, art. 6: 20 anos desde o último registro); a foto substituída ou
//     revogada fica guardada até a mesma data (é parte do prontuário), mas deixa de valer para a conferência.
//   - Digital ou face com leitor homologado (a guia TISS com biometria) ficam para a fase 2, por porta de integração
//     com o fornecedor do leitor, guardando só o modelo biométrico, nunca a imagem.
// Regras puras: sem banco e sem HTTP.

export const BASE_LEGAL_FOTO_IDENTIFICACAO = 'lgpd_art11_ii_f_g' as const;
/** Guarda do prontuário (Lei 13.787/2018): a foto é parte dele. */
export const ANOS_GUARDA_FOTO_IDENTIFICACAO = 20;
/** A tela reduz a foto a 480 px em JPEG (abaixo de 300 KB); o servidor aceita até 300 KB. */
export const TAMANHO_MAXIMO_FOTO_IDENTIFICACAO = 300 * 1024;
/** Tipo de autenticação da conferência por foto e da conferência por documento (quando a foto é dispensada). */
export const TIPO_CONFERENCIA_FOTO = 'FOTO_CONFERIDA' as const;
export const TIPO_CONFERENCIA_DOCUMENTO = 'DOCUMENTO_CONFERIDO' as const;

export const CONTEXTOS_CONFERENCIA = [
  'recepcao',
  'guia',
  'leito',
  'dispensacao',
  'procedimento',
  'outro',
] as const;
export type ContextoConferencia = (typeof CONTEXTOS_CONFERENCIA)[number];
export const RESULTADOS_CONFERENCIA = ['confirmada', 'nao_confirmada', 'dispensada'] as const;
export type ResultadoConferencia = (typeof RESULTADOS_CONFERENCIA)[number];

export type TipoFotoIdentificacao = 'image/jpeg' | 'image/png';

/** O tipo pela assinatura do conteúdo (nunca pelo nome nem pelo tipo declarado): JPEG ou PNG; outro, null. */
export function tipoDaFotoIdentificacao(b: Uint8Array): TipoFotoIdentificacao | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return null;
}

/** Erros da foto enviada: 'foto-tipo' (não é JPEG nem PNG) ou 'foto-tamanho' (vazia ou acima do teto). */
export function errosFotoIdentificacao(b: Uint8Array): ('foto-tipo' | 'foto-tamanho')[] {
  const erros: ('foto-tipo' | 'foto-tamanho')[] = [];
  if (tipoDaFotoIdentificacao(b) === null) erros.push('foto-tipo');
  if (b.length === 0 || b.length > TAMANHO_MAXIMO_FOTO_IDENTIFICACAO) erros.push('foto-tamanho');
  return erros;
}

/** Data da guarda (AAAA-MM-DD) a partir da data da captura (AAAA-MM-DD): 20 anos; 29/02 cai em 28/02. */
export function guardaFotoIdentificacaoAte(captura: string): string {
  const [a, m, d] = captura.slice(0, 10).split('-').map(Number) as [number, number, number];
  const ano = a + ANOS_GUARDA_FOTO_IDENTIFICACAO;
  const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
  const dia = m === 2 && d === 29 && !bissexto ? 28 : d;
  return `${ano}-${String(m).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export interface EntradaConferenciaIdentidade {
  readonly resultado: string;
  readonly contexto: string;
  readonly motivoDispensa: string | null;
  /** O paciente tem foto ativa cadastrada. */
  readonly temFotoAtiva: boolean;
}

export type ErroConferencia = 'resultado' | 'contexto' | 'motivoDispensa' | 'sem-foto';

/**
 * Erros da conferência da identidade: o resultado e o ponto do fluxo têm de ser conhecidos; confirmar ou negar a
 * identidade pela foto exige a foto ativa; a dispensa (paciente sem foto, inconsciente, sem condição de ser
 * fotografado) exige o motivo, com ao menos 5 letras, e é feita pelo documento.
 */
export function errosConferenciaIdentidade(e: EntradaConferenciaIdentidade): ErroConferencia[] {
  const erros: ErroConferencia[] = [];
  const resultado = RESULTADOS_CONFERENCIA.includes(e.resultado as ResultadoConferencia)
    ? (e.resultado as ResultadoConferencia)
    : null;
  if (!resultado) erros.push('resultado');
  if (!CONTEXTOS_CONFERENCIA.includes(e.contexto as ContextoConferencia)) erros.push('contexto');
  if (resultado === 'dispensada' && (e.motivoDispensa ?? '').trim().length < 5) erros.push('motivoDispensa');
  if (resultado !== null && resultado !== 'dispensada' && !e.temFotoAtiva) erros.push('sem-foto');
  return erros;
}

/** O tipo de autenticação usado: a foto, ou o documento quando a conferência pela foto é dispensada. */
export const tipoDaConferencia = (resultado: ResultadoConferencia) =>
  resultado === 'dispensada' ? TIPO_CONFERENCIA_DOCUMENTO : TIPO_CONFERENCIA_FOTO;

/** O motivo só acompanha a dispensa (nos outros resultados é descartado). */
export const motivoDaConferencia = (resultado: ResultadoConferencia, motivo: string | null): string | null =>
  resultado === 'dispensada' ? (motivo ?? '').trim().slice(0, 200) || null : null;

/** Revogar a foto (pessoa errada, foto imprópria) exige o motivo, com ao menos 5 letras. */
export const motivoRevogacaoValido = (motivo: string | null): boolean => (motivo ?? '').trim().length >= 5;
