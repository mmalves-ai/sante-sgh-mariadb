import { describe, expect, it } from 'vitest';
import { dataDe, diaUtc, diasEntre } from './datas.js';

describe('datas civis', () => {
  it('conta os dias sem fuso, inclusive na virada do ano e em ano bissexto', () => {
    expect(diasEntre('2026-12-31', '2027-01-01')).toBe(1);
    expect(diasEntre('2028-02-28', '2028-03-01')).toBe(2);
    expect(diasEntre('2026-10-24', '2026-10-01')).toBe(-23);
  });

  it('recusa data fora do formato ou inexistente', () => {
    expect(() => diaUtc('24/10/2026')).toThrow(/inválida/);
    expect(() => diaUtc('2026-02-30')).toThrow(/inválida/);
  });

  it('tira a data de um instante local', () => {
    expect(dataDe('2026-10-24T19:00')).toBe('2026-10-24');
    expect(dataDe('2026-10-24')).toBe('2026-10-24');
  });
});
