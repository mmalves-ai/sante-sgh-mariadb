// Sigilo da psicologia (ficha do M23, regra 15; cap-05b §5.9): no novo, o conteúdo da sessão de psicologia é visível
// só para a categoria (o profissional de psicologia); as demais veem que houve atendimento (data, profissional e
// categoria), sem o conteúdo. O outro sistema continua mostrando conforme as próprias regras (concessão provisória).
import type { CategoriaAssistencial } from '@sgh/contratos';

/** Categorias cujo registro é sigiloso para as demais (só a psicologia nesta versão). */
export const CATEGORIAS_SIGILOSAS: ReadonlySet<CategoriaAssistencial> = new Set(['psicologia']);

/** O leitor vê o conteúdo do registro do autor? */
export function podeVerConteudo(
  autor: CategoriaAssistencial | null,
  leitor: CategoriaAssistencial | null,
): boolean {
  if (autor === null || !CATEGORIAS_SIGILOSAS.has(autor)) return true;
  return leitor === autor;
}

export const TEXTO_SIGILO =
  'Houve atendimento. O conteúdo é restrito à categoria profissional que o registrou.';

/** Aplica o sigilo: mantém data, profissional e categoria; troca o conteúdo pelo aviso. */
export function comSigilo<T extends { readonly categoria: CategoriaAssistencial | null }>(
  item: T,
  leitor: CategoriaAssistencial | null,
  apagar: (x: T) => T,
): T & { readonly sigilo: boolean } {
  return podeVerConteudo(item.categoria, leitor)
    ? { ...item, sigilo: false }
    : { ...apagar(item), sigilo: true };
}
