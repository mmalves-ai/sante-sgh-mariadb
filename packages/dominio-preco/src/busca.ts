// Busca por palavra (ficha do M12, seção 4: busca de convênio "sem acento, prefixo nos dois sentidos, palavras
// coladas"; ref 01 §4.4; reescrita de sante-api: src/utils/busca.js). Cada palavra do termo casa uma palavra
// do nome quando é igual, quando uma é prefixo da outra (a partir de 4 letras) ou quando palavras seguidas do
// nome, coladas, começam pela palavra do termo ("UNI MED" acha "UNIMED"; "UNIMED" acha "UNI MED"). A
// pontuação pesa a posição da palavra no termo; o resultado fica com os que chegam a 35% do melhor.
import { normalizarChave } from '@sgh/contratos';

const PREFIXO_MINIMO = 4;
const FRACAO_DO_MELHOR = 0.35;

/** Conectivos e títulos que não identificam nada. */
export const PALAVRAS_IGNORADAS: ReadonlySet<string> = new Set([
  'DE',
  'DA',
  'DO',
  'DAS',
  'DOS',
  'E',
  'DR',
  'DRA',
]);

export function palavras(texto: string): string[] {
  return normalizarChave(texto).split(' ').filter(Boolean);
}

export function casaPalavra(palavra: string, doNome: readonly string[]): boolean {
  for (const w of doNome) {
    if (w === palavra) return true;
    if (palavra.length >= PREFIXO_MINIMO && w.startsWith(palavra)) return true;
    if (w.length >= PREFIXO_MINIMO && palavra.startsWith(w)) return true;
  }
  for (let i = 0; i < doNome.length - 1; i++) {
    let colado = doNome[i] ?? '';
    for (let j = i + 1; j < doNome.length; j++) {
      colado += doNome[j] ?? '';
      if (colado.startsWith(palavra)) return true;
    }
  }
  return false;
}

/** Pontos do nome para o termo (0 = não casa; termo vazio casa tudo com 1). */
export function pontuar(termo: string, nome: string): number {
  const t = palavras(termo).filter((p) => !PALAVRAS_IGNORADAS.has(p));
  if (t.length === 0) return 1;
  const n = palavras(nome);
  // O termo inteiro, colado, também vale (ex.: "uni med" contra "UNIMED").
  const colado = t.join('');
  let pontos = 0;
  t.forEach((p, i) => {
    if (casaPalavra(p, n)) pontos += 1 / (1 + 0.5 * i);
  });
  if (pontos === 0 && t.length > 1 && casaPalavra(colado, n)) pontos = 1;
  if (pontos === 0) return 0;
  // Desempate: nome que começa pelo termo vem antes.
  return pontos + (normalizarChave(nome).startsWith(normalizarChave(termo)) ? 0.25 : 0);
}

/** Filtra e ordena pela relevância (empate pelo nome); código numérico exato vem primeiro. */
export function buscarPorPalavra<T>(
  itens: readonly T[],
  termo: string,
  nomeDe: (i: T) => string,
  codigoDe?: (i: T) => number,
): T[] {
  const limpo = termo.trim();
  if (!limpo) return [...itens];
  if (codigoDe && /^\d{1,6}$/.test(limpo)) {
    const exato = itens.filter((i) => codigoDe(i) === Number(limpo));
    if (exato.length) return exato;
  }
  const pontuados = itens
    .map((item) => ({ item, p: pontuar(limpo, nomeDe(item)) }))
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p || nomeDe(a.item).localeCompare(nomeDe(b.item), 'pt-BR'));
  const melhor = pontuados[0]?.p ?? 0;
  return pontuados.filter((x) => x.p >= melhor * FRACAO_DO_MELHOR).map((x) => x.item);
}
