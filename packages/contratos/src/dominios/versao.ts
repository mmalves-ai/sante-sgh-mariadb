// Controle otimista do CRUD genérico (ficha, seção 4 e §5; cap-10 §10.2): as tabelas de domínio não têm
// DATA_HORA_ULTIMA_ATUALIZACAO, então a versão é o conjunto das colunas MOSTRADAS, como a tela leu. A
// operação relê a linha WITH LOCK e compara; mudou por fora: 409 conflito-versao com os campos.
import type { ValorCampo } from './tipos.js';

/** Versão opaca (JSON canônico, chaves em ordem) dos valores mostrados. */
export function versaoDoItem(valores: Readonly<Record<string, ValorCampo>>, ativo: boolean): string {
  const ordenado = Object.fromEntries(
    Object.keys(valores)
      .sort()
      .map((k) => [k, valores[k] ?? null]),
  );
  return JSON.stringify({ v: ordenado, a: ativo });
}

export function lerVersao(versao: string): { valores: Record<string, ValorCampo>; ativo: boolean } | null {
  try {
    const x = JSON.parse(versao) as { v?: unknown; a?: unknown };
    if (!x || typeof x !== 'object' || typeof x.v !== 'object' || x.v === null || typeof x.a !== 'boolean')
      return null;
    const valores: Record<string, ValorCampo> = {};
    for (const [k, v] of Object.entries(x.v as Record<string, unknown>)) {
      if (v !== null && typeof v !== 'string' && typeof v !== 'number') return null;
      valores[k] = v;
    }
    return { valores, ativo: x.a };
  } catch {
    return null;
  }
}

/** Campos cujo valor atual difere do que a tela leu. */
export function camposMudados(
  lido: Readonly<Record<string, ValorCampo>>,
  atual: Readonly<Record<string, ValorCampo>>,
): string[] {
  const norm = (v: ValorCampo | undefined) =>
    v === null || v === undefined ? '\u0000' : String(v).trimEnd();
  return [...new Set([...Object.keys(lido), ...Object.keys(atual)])]
    .filter((k) => norm(lido[k]) !== norm(atual[k]))
    .sort();
}
