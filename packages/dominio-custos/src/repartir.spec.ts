// Repartição exata em centavos (base da regra 7 e do custo por conta): a soma das partes é sempre o total.
import { describe, expect, it } from 'vitest';
import { dividirArredondado, repartir } from './repartir.js';

describe('repartir', () => {
  it('proporcional, com o resto pelo maior resto e empate pela ordem', () => {
    expect(repartir(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(repartir(10, [1, 2, 0, 2])).toEqual([2, 4, 0, 4]);
    expect(repartir(7, [3, 1])).toEqual([5, 2]);
  });
  it('total negativo é repartido pelo módulo e devolvido com o sinal', () => {
    expect(repartir(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
  });
  it('sem peso positivo: null (sem base)', () => {
    expect(repartir(100, [0, 0])).toBeNull();
    expect(repartir(100, [])).toBeNull();
  });
  it('números grandes não perdem centavo (BigInt)', () => {
    const p = repartir(9_007_199_254_740, [3_000_000_007, 7_000_000_011, 1]);
    expect(p!.reduce((s, x) => s + x, 0)).toBe(9_007_199_254_740);
  });
  it('recusa total fracionado e peso negativo', () => {
    expect(() => repartir(1.5, [1])).toThrow(RangeError);
    expect(() => repartir(1, [-1])).toThrow(RangeError);
  });
  it('dividirArredondado: meio para longe do zero; divisor zero dá null', () => {
    expect(dividirArredondado(5, 2)).toBe(3);
    expect(dividirArredondado(-5, 2)).toBe(-3);
    expect(dividirArredondado(4, -3)).toBe(-1);
    expect(dividirArredondado(1, 0)).toBeNull();
  });
});
