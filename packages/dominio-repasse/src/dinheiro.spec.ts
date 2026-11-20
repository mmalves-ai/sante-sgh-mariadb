// Aritmética em centavos e competência seguinte.
import { describe, expect, it } from 'vitest';
import {
  aplicarPercentual,
  centavos,
  competenciaSeguinte,
  dividirArredondando,
  percentualE4,
  reais,
} from './dinheiro.js';

describe('dinheiro', () => {
  it('converte reais, centavos e percentual com 4 casas', () => {
    expect(centavos(508581.47)).toBe(50858147);
    expect(reais(50858147)).toBe(508581.47);
    expect(percentualE4(18.5)).toBe(185000);
  });

  it('arredonda metade para longe do zero, nos dois sinais', () => {
    expect(dividirArredondando(5n, 2n)).toBe(3n);
    expect(dividirArredondando(-5n, 2n)).toBe(-3n);
    expect(dividirArredondando(5n, -2n)).toBe(-3n);
    expect(dividirArredondando(4n, 3n)).toBe(1n);
    expect(() => dividirArredondando(1n, 0n)).toThrow(RangeError);
  });

  it('base grande × percentual sem perder precisão: 99.999.999,99 × 99,9999%', () => {
    expect(aplicarPercentual(9_999_999_999, 99.9999)).toBe(9_999_989_999);
  });

  it('competência seguinte vira o ano', () => {
    expect(competenciaSeguinte('2026-10')).toBe('2026-11');
    expect(competenciaSeguinte('2026-12')).toBe('2027-01');
    expect(() => competenciaSeguinte('2026/10')).toThrow(RangeError);
  });
});
