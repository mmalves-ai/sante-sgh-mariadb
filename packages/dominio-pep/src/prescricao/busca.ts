// Busca de item prescritível (ficha do M24, seção 4: "chave normalizada sem acento em cache, recarregada do banco;
// 30 sugestões / p95 < 200 ms"): o índice tem o nome do item e os nomes dos princípios ativos sem acento e em
// maiúsculas, com o padronizado primeiro; a busca casa todas as palavras digitadas no nome ou nos princípios
// ("dipirona sodica" acha "DIPIRONA SÓDICA"). Nada de banco a cada tecla: o índice vem do cache.

/** O item como o cadastro o descreve (nomes como gravados). */
export interface ItemParaIndice {
  readonly produto: number;
  readonly nome: string;
  readonly padronizado: boolean;
  readonly principios: readonly string[];
}

/** Linha do índice (chaves já normalizadas; serializável para o cache). */
export interface LinhaIndiceBusca {
  readonly p: number;
  /** Nome normalizado. */
  readonly n: string;
  /** Princípios ativos normalizados, separados por " | ". */
  readonly a: string;
}

export const TETO_SUGESTOES = 30;

/** Sem acento, maiúsculas, espaços simples. */
export function chaveDeBusca(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

/** O índice: padronizado primeiro, depois o nome normalizado. */
export function montarIndiceBusca(itens: readonly ItemParaIndice[]): LinhaIndiceBusca[] {
  return [...itens]
    .map((i) => ({
      p: i.produto,
      n: chaveDeBusca(i.nome),
      a: i.principios.map(chaveDeBusca).join(' | '),
      s: i.padronizado,
    }))
    .sort((x, y) => (x.s === y.s ? x.n.localeCompare(y.n) || x.p - y.p : x.s ? -1 : 1))
    .map(({ p, n, a }) => ({ p, n, a }));
}

/** Os itens cujo nome (ou princípio ativo) tem todas as palavras do termo; no máximo `teto`, na ordem do índice. */
export function buscarNoIndice(
  indice: readonly LinhaIndiceBusca[],
  termo: string,
  teto = TETO_SUGESTOES,
): number[] {
  const t = chaveDeBusca(termo);
  if (t.replace(/ /g, '').length < 2) return [];
  const palavras = t.split(' ');
  const r: number[] = [];
  for (const l of indice) {
    if (palavras.every((w) => l.n.includes(w)) || (l.a !== '' && palavras.every((w) => l.a.includes(w))))
      r.push(l.p);
    if (r.length >= teto) break;
  }
  return r;
}
