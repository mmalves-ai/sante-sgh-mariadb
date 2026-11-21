import { describe, expect, it } from 'vitest';
import { valorPorExtenso } from './particular.js';

describe('valor por extenso do recibo', () => {
  it.each([
    [0, 'zero real'],
    [0.01, 'um centavo'],
    [1, 'um real'],
    [2.5, 'dois reais e cinquenta centavos'],
    [100, 'cem reais'],
    [101, 'cento e um reais'],
    [1000, 'mil reais'],
    [1200, 'mil e duzentos reais'],
    [1234.56, 'mil duzentos e trinta e quatro reais e cinquenta e seis centavos'],
    [21_015, 'vinte e um mil e quinze reais'],
    [1_000_000, 'um milhão de reais'],
    [2_500_000, 'dois milhões e quinhentos mil reais'],
    [1_001_234, 'um milhão, mil duzentos e trinta e quatro reais'],
  ])('%s → %s', (v, texto) => {
    expect(valorPorExtenso(v)).toBe(texto);
  });

  it('recusa valor fora da faixa', () => {
    expect(() => valorPorExtenso(-1)).toThrow(RangeError);
    expect(() => valorPorExtenso(Number.NaN)).toThrow(RangeError);
    expect(() => valorPorExtenso(1e12)).toThrow(RangeError);
  });
});
