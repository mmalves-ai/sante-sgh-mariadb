// Aritmética da contabilidade em centavos inteiros (sem ponto flutuante na soma). O banco grava NUMERIC(10,2) e
// NUMERIC(15,2); o valor do item da conta tem 5 casas e o total da conta é ponto flutuante: tudo passa por `paraCentavos`, que
// arredonda metade para longe do zero pela representação decimal (nunca por multiplicação em ponto flutuante).

/** Valor lido do banco (número, texto decimal ou nulo) → centavos inteiros; nulo e vazio viram 0. */
export function paraCentavos(valor: number | string | null | undefined): number {
  if (valor === null || valor === undefined || valor === '') return 0;
  const t = typeof valor === 'number' ? numeroParaTexto(valor) : valor.trim().replace(',', '.');
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(t);
  if (!m) throw new RangeError(`Valor inválido: ${String(valor)}`);
  const negativo = m[1] === '-';
  const inteiro = Number(m[2] || '0');
  const casas = (m[3] ?? '').padEnd(3, '0');
  let c = inteiro * 100 + Number(casas.slice(0, 2));
  if (Number(casas[2]) >= 5) c += 1;
  return negativo && c !== 0 ? -c : c;
}

function numeroParaTexto(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError(`Valor inválido: ${n}`);
  // toFixed(6) evita a notação científica e guarda as casas que importam para o arredondamento em 2.
  return n.toFixed(6);
}

/** Centavos → texto com 2 casas e ponto (para leiaute e trilha). */
export function centavosParaTexto(c: number): string {
  const s = c < 0 ? '-' : '';
  const a = Math.abs(c);
  return `${s}${Math.trunc(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

/**
 * Divide `total` em partes proporcionais a `pesos` (percentuais ou qualquer peso positivo), sem perder centavo: o resto
 * vai às maiores frações (desempate pela ordem), então a soma das partes é sempre igual ao total.
 */
export function ratearCentavos(total: number, pesos: readonly number[]): number[] {
  if (pesos.length === 0) return [];
  if (pesos.some((p) => !(p > 0))) throw new RangeError('Peso de rateio tem de ser positivo.');
  const soma = pesos.reduce((s, p) => s + p, 0);
  const sinal = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const brutas = pesos.map((p) => (abs * p) / soma);
  const partes = brutas.map((b) => Math.floor(b));
  let resto = abs - partes.reduce((s, x) => s + x, 0);
  const ordem = brutas.map((b, i) => ({ i, f: b - Math.floor(b) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (const { i } of ordem) {
    if (resto <= 0) break;
    partes[i] = (partes[i] ?? 0) + 1;
    resto -= 1;
  }
  return partes.map((x) => x * sinal);
}

/** AAAA-MM-DD (ou ISO com hora) → competência AAAA-MM. */
export function competenciaDaData(data: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(data);
  if (!m) throw new RangeError(`Data inválida: ${data}`);
  return `${m[1]}-${m[2]}`;
}
