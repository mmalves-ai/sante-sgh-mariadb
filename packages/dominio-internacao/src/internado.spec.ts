// Regra 2 (ficha do M21): internado é a alta na sentinela 1899-12-30, nunca NULL; a alta antes da entrada (24
// internações antigas) vai ao relatório do SAME e fica fora dos cálculos.
import { describe, expect, it } from 'vitest';
import { altaAntesDaEntrada, estaInternado } from './adt.js';

describe('internado pela sentinela', () => {
  it('sem alta ou a sentinela 1899-12-30 é internado; com a data da saída, não', () => {
    expect(estaInternado(null)).toBe(true);
    expect(estaInternado('1899-12-30')).toBe(true);
    expect(estaInternado('2026-07-01')).toBe(false);
  });

  it('a alta antes da entrada é incoerência (relatório), a internação aberta não', () => {
    expect(altaAntesDaEntrada({ entrada: '2026-06-05', alta: '2026-06-04' })).toBe(true);
    expect(altaAntesDaEntrada({ entrada: '2026-06-05', alta: '2026-06-05' })).toBe(false);
    expect(altaAntesDaEntrada({ entrada: '2026-06-05', alta: null })).toBe(false);
    expect(altaAntesDaEntrada({ entrada: '2026-06-05', alta: '1899-12-30' })).toBe(false);
  });
});
