import { describe, expect, it } from 'vitest';
import { carimboBr, dataBr, dataDaEntrada, diferencas, somenteDigitos } from './formato.js';

describe('formato do cadastro', () => {
  it('mostra datas e carimbos no padrão brasileiro', () => {
    expect(dataBr('1980-02-29')).toBe('29/02/1980');
    expect(dataBr(null)).toBe('');
    expect(carimboBr('2026-10-20T14:05:00.000Z')).toBe('20/10/2026 14:05');
  });
  it('lê a data digitada e recusa data impossível', () => {
    expect(dataDaEntrada('29/02/1980')).toBe('1980-02-29');
    expect(dataDaEntrada('1980-02-29')).toBe('1980-02-29');
    expect(dataDaEntrada('30/02/1980')).toBeNull();
    expect(dataDaEntrada('ontem')).toBeNull();
  });
  it('separa só o que mudou', () => {
    expect(diferencas({ a: 1, b: 'x' }, { a: 1, b: 'y' })).toEqual({ b: 'y' });
    expect(somenteDigitos('(31) 9 9999-0000')).toBe('31999990000');
  });
});
