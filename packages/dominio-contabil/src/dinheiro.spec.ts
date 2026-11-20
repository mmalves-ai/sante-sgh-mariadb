import { describe, expect, it } from 'vitest';
import { centavosParaTexto, competenciaDaData, paraCentavos, ratearCentavos } from './dinheiro.js';

describe('dinheiro em centavos', () => {
  it('converte número, texto e nulo com arredondamento de metade para longe do zero', () => {
    expect(paraCentavos(1234.56)).toBe(123_456);
    expect(paraCentavos('10,005')).toBe(1001);
    expect(paraCentavos(0.1 + 0.2)).toBe(30);
    expect(paraCentavos(-2.345)).toBe(-235);
    expect(paraCentavos('-0.001')).toBe(0);
    expect(paraCentavos(null)).toBe(0);
    expect(paraCentavos(undefined)).toBe(0);
    expect(paraCentavos('')).toBe(0);
    expect(paraCentavos('.5')).toBe(50);
    expect(() => paraCentavos('abc')).toThrow(RangeError);
    expect(() => paraCentavos(Number.NaN)).toThrow(RangeError);
  });

  it('formata com duas casas', () => {
    expect(centavosParaTexto(123_456)).toBe('1234.56');
    expect(centavosParaTexto(-5)).toBe('-0.05');
  });

  it('rateia sem perder centavo (as parcelas somam o total)', () => {
    const p = ratearCentavos(100, [1, 1, 1]);
    expect(p).toEqual([34, 33, 33]);
    expect(p.reduce((s, x) => s + x, 0)).toBe(100);
    expect(ratearCentavos(-1000, [70, 30])).toEqual([-700, -300]);
    expect(ratearCentavos(5, [])).toEqual([]);
    expect(() => ratearCentavos(5, [1, 0])).toThrow(RangeError);
  });

  it('competência da data', () => {
    expect(competenciaDaData('2027-02-28')).toBe('2027-02');
    expect(competenciaDaData('2027-02-28T10:00:00Z')).toBe('2027-02');
    expect(() => competenciaDaData('28/02/2027')).toThrow(RangeError);
  });
});
