// Regras puras da assinatura sobre o modelo próprio (lote 02-01, correção da revisão): quais documentos do prontuário
// podem receber assinatura e o estado de um envelope com várias assinaturas no verificador público. Sem I/O: a porta
// própria lê as linhas e decide por aqui. Pedido ao integrador (saida/02-01.json): mover para o
// @sgh/dominio-documento (assinatura/verificador.ts e politica.ts) quando o pacote puder ser editado por este lote.
// Melhoria: lista positiva das situações assináveis (rascunho, corrigido e arquivado nunca recebem assinatura).
// Melhoria: o envelope só é "válido" com todas as assinaturas válidas e a quantidade exigida alcançada.

/** As categorias de situação do documento do prontuário que podem receber assinatura (ck_situacao_..._categoria). */
export const CATEGORIAS_ASSINAVEIS = ['lancado', 'validado', 'aguardando_assinatura'] as const;

export const categoriaAssinavel = (categoria: string): boolean =>
  (CATEGORIAS_ASSINAVEIS as readonly string[]).includes(categoria);

/**
 * O documento não pode receber assinatura (a recusa "documento-suspenso"): toda categoria fora da lista positiva,
 * menos a "assinado" (o documento já assinado segue legível para o PDF, o reprocessamento e o verificador; a
 * segunda assinatura é barrada pela trava do envelope).
 */
export const bloqueadoParaAssinatura = (categoria: string): boolean =>
  !categoriaAssinavel(categoria) && categoria !== 'assinado';

/** Situações do envelope ainda sem todas as assinaturas (ck_documento_assinado_situacao). */
const ENVELOPE_INCOMPLETO = new Set(['pendente', 'parcial']);

export interface EnvelopeParaVerificar {
  /** documento_assinado.situacao: pendente, parcial, assinado, cancelado, invalidado. */
  readonly situacao: string;
  readonly assinaturasExigidas: number;
  /** As assinaturas não excluídas do envelope (assinatura_documento.situacao). */
  readonly assinaturas: readonly { readonly situacao: string }[];
}

export interface EstadoDoEnvelope {
  readonly estado: 'pendente' | 'assinada' | 'falha';
  /** O resultado da validação no servidor; null enquanto o envelope não está completo. */
  readonly resultado: 'valida' | 'invalida' | 'indeterminada' | null;
}

/**
 * O estado do envelope no verificador. Sem assinatura: null (o verificador responde "não encontrado"). Qualquer
 * assinatura que não seja válida nem expirada (inválida, revogada ou desconhecida): falha. Envelope pendente ou
 * parcial, ou com menos assinaturas válidas que as exigidas: pendente. Alguma expirada: assinada, indeterminada.
 * Só com todas válidas e a quantidade exigida alcançada: válida.
 */
export function estadoDoEnvelope(e: EnvelopeParaVerificar): EstadoDoEnvelope | null {
  if (e.assinaturas.length === 0) return null;
  if (e.assinaturas.some((a) => a.situacao !== 'valida' && a.situacao !== 'expirada'))
    return { estado: 'falha', resultado: 'invalida' };
  const exigidas = Math.max(1, Math.floor(e.assinaturasExigidas));
  if (ENVELOPE_INCOMPLETO.has(e.situacao) || e.assinaturas.length < exigidas)
    return { estado: 'pendente', resultado: null };
  if (e.assinaturas.some((a) => a.situacao === 'expirada'))
    return { estado: 'assinada', resultado: 'indeterminada' };
  return { estado: 'assinada', resultado: 'valida' };
}

/** O registro no conselho como o selo mostra (sigla-UF número); sem número, null. */
export function registroExibido(
  r: { sigla: string | null; uf: string | null; numero: string | null } | null,
): string | null {
  if (!r?.numero) return null;
  return `${r.sigla ?? 'Conselho'}${r.uf ? `-${r.uf}` : ''} ${r.numero}`;
}
