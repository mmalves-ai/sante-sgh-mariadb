// Regra 2 (ficha do M30): o significado de FECHADA; o novo grava só N e S.
import { describe, expect, it } from 'vitest';
import { aceitaLancamento, FECHADA_GRAVAVEL, situacaoDaConta } from '../index.js';

describe('situação da conta (regra 2)', () => {
  it('N aberta, S fechada, A apresentada; F, vazio e outro são erro de dado', () => {
    expect(situacaoDaConta('N')).toBe('aberta');
    expect(situacaoDaConta(' s ')).toBe('fechada');
    expect(situacaoDaConta('A')).toBe('apresentada');
    expect(situacaoDaConta('F')).toBe('erro-de-dado');
    expect(situacaoDaConta('')).toBe('erro-de-dado');
    expect(situacaoDaConta(null)).toBe('erro-de-dado');
    expect(situacaoDaConta(undefined)).toBe('erro-de-dado');
  });
  it('o novo só grava N e S', () => {
    expect([...FECHADA_GRAVAVEL]).toEqual(['N', 'S']);
  });
  it('regra 5: só a conta aberta e não emitida aceita lançamento', () => {
    expect(aceitaLancamento('N', 'F')).toBe(true);
    expect(aceitaLancamento('N', null)).toBe(true);
    expect(aceitaLancamento('N', 'T')).toBe(false);
    expect(aceitaLancamento('S', 'F')).toBe(false);
    expect(aceitaLancamento('A', 'T')).toBe(false);
  });
});
