// Regra dos combos (ADR 0027): toda lista com mais de LIMIAR_BUSCA opções tem busca.
export const LIMIAR_BUSCA = 10;

const semAcento = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');

/**
 * Opções cujo rótulo contém todas as palavras do termo (sem acento e sem caixa), na ordem original.
 * `manter` (o valor escolhido) fica sempre na lista, para o select nunca perder a seleção atual.
 */
export function filtrarOpcoes<O extends { readonly valor: unknown; readonly rotulo: string }>(
  opcoes: readonly O[],
  termo: string,
  manter?: unknown,
): readonly O[] {
  const palavras = semAcento(termo).split(/\s+/).filter(Boolean);
  if (!palavras.length) return opcoes;
  return opcoes.filter((o) => {
    if (manter !== undefined && o.valor === manter) return true;
    const r = semAcento(o.rotulo);
    return palavras.every((p) => r.includes(p));
  });
}
