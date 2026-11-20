// Chave de busca sem acento e sem caixa (porta de normalizarChave da sante-api, src/utils/sgh.js).
export function normalizarChave(valor: string | null | undefined): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/** Verdadeiro se todas as palavras da busca aparecem (como prefixo de palavra ou trecho) no texto. */
export function casaBusca(texto: string, busca: string): boolean {
  const alvo = normalizarChave(texto);
  const termos = normalizarChave(busca).split(' ').filter(Boolean);
  return termos.every((t) => alvo.includes(t));
}
