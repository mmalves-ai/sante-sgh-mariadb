// Aritmética do repasse em centavos inteiros (sem ponto flutuante na conta). O arredondamento é o do banco ao gravar
// em NUMERIC(15,2): metade para longe do zero. Percentuais com 4 casas (TBREPGER.PERC é NUMERIC(6,4)).

/** Reais (número com até 2 casas) → centavos inteiros. */
export function centavos(reais: number): number {
  return Math.round(reais * 100);
}

/** Centavos → reais (para exibir e gravar). */
export function reais(c: number): number {
  return c / 100;
}

/** Percentual com até 4 casas → inteiro em décimos de milésimo (70,5 → 705000). */
export function percentualE4(p: number): number {
  return Math.round(p * 10_000);
}

/** Divisão inteira com arredondamento de metade para longe do zero (BigInt: o produto passa de 2^53). */
export function dividirArredondando(numerador: bigint, denominador: bigint): bigint {
  if (denominador === 0n) throw new RangeError('Divisão por zero.');
  const negativo = numerador < 0n !== denominador < 0n;
  const n = numerador < 0n ? -numerador : numerador;
  const d = denominador < 0n ? -denominador : denominador;
  const q = (n * 2n + d) / (d * 2n);
  return negativo ? -q : q;
}

/** base (centavos) × percentual (%) → centavos arredondados. */
export function aplicarPercentual(baseCentavos: number, percentual: number): number {
  return Number(dividirArredondando(BigInt(baseCentavos) * BigInt(percentualE4(percentual)), 1_000_000n));
}

/** Competência AAAA-MM seguinte (o estorno e a correção entram no período seguinte). */
export function competenciaSeguinte(competencia: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(competencia);
  if (!m) throw new RangeError(`Competência inválida: ${competencia}`);
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  return mes === 12 ? `${ano + 1}-01` : `${ano}-${String(mes + 1).padStart(2, '0')}`;
}
