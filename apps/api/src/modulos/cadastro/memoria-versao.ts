// Versão opaca do controle otimista das portas EM MEMÓRIA do cadastro (dev/ci): o retrato JSON das colunas da linha
// sintética, comparado coluna a coluna na gravação. A porta própria usa a coluna `versao` do banco (inteiro) e não
// passa por aqui.

/** Valor comparável (instante em ISO, texto sem espaço à direita, nulo). */
export function comparavelVersao(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v).trimEnd();
}

/** Versão opaca das colunas pedidas da linha. */
export function versaoDasColunas(colunas: readonly string[], l: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(Object.fromEntries(colunas.map((c) => [c, comparavelVersao(l[c])])));
}

/**
 * Lê a versão mandada pela tela: só as colunas pedidas, cada uma texto ou nulo. `todas`: exige exatamente as colunas
 * (falso: aceita um subconjunto, mas `obrigatoria` tem de estar). Inválida: null.
 */
export function lerVersaoColunas(
  versao: string,
  colunas: readonly string[],
  opcoes: { readonly todas?: boolean; readonly obrigatoria?: string } = { todas: true },
): Record<string, string | null> | null {
  try {
    const x = JSON.parse(versao) as unknown;
    if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
    const o = x as Record<string, unknown>;
    const chaves = Object.keys(o);
    if (chaves.some((k) => !colunas.includes(k))) return null;
    if (opcoes.todas && chaves.length !== colunas.length) return null;
    if (opcoes.obrigatoria && !(opcoes.obrigatoria in o)) return null;
    const r: Record<string, string | null> = {};
    for (const c of colunas) {
      if (!(c in o)) continue;
      const v = o[c];
      if (v !== null && typeof v !== 'string') return null;
      r[c] = v;
    }
    return r;
  } catch {
    return null;
  }
}
