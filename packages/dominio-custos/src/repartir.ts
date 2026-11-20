// Repartição exata em centavos (M54-F5): o total é dividido pelos pesos e o resto vai, um centavo por vez, a quem tem a
// maior fração (maior resto; empate pela ordem de entrada). A soma das partes é sempre o total: nenhum centavo some nem
// nasce no rateio. A conta é feita em BigInt (total em centavos × peso em centésimos passa de 2^53 num hospital grande).

/**
 * Reparte `total` (centavos, inteiro) pelos `pesos` (inteiros ≥ 0). Sem peso positivo, devolve null (quem chama trata
 * o "sem base"). Total negativo é repartido pelo módulo e devolvido com o sinal.
 */
export function repartir(total: number, pesos: readonly number[]): number[] | null {
  if (!Number.isSafeInteger(total)) throw new RangeError('total precisa ser inteiro (centavos)');
  if (pesos.some((p) => !Number.isSafeInteger(p) || p < 0))
    throw new RangeError('pesos precisam ser inteiros não negativos');
  const soma = pesos.reduce((s, p) => s + BigInt(p), 0n);
  if (soma === 0n) return null;
  const sinal = total < 0 ? -1n : 1n;
  const t = BigInt(Math.abs(total));
  const partes = pesos.map((p) => (t * BigInt(p)) / soma);
  const restos = pesos.map((p, i) => ({ i, r: (t * BigInt(p)) % soma }));
  let falta = t - partes.reduce((s, x) => s + x, 0n);
  restos.sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
  for (const { i } of restos) {
    if (falta === 0n) break;
    if (pesos[i] === 0) continue;
    partes[i] = (partes[i] ?? 0n) + 1n;
    falta -= 1n;
  }
  return partes.map((x) => Number(x * sinal));
}

/** Divisão inteira arredondada (meio para longe do zero), em BigInt; null com divisor zero. */
export function dividirArredondado(numerador: number, denominador: number): number | null {
  if (denominador === 0) return null;
  const n = BigInt(Math.round(numerador));
  const d = BigInt(Math.round(denominador));
  const neg = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (ad * 2n);
  return Number(neg ? -q : q);
}
