// Arredondamento e moeda das mensagens da conta.
import { describe, expect, it } from 'vitest';
import { centavos, quatroCasas, reaisTexto, recusaFat } from '../index.js';

describe('valores', () => {
  it('2 e 4 casas; moeda em português', () => {
    expect(centavos(1.005)).toBe(1.01);
    expect(quatroCasas(1.23456)).toBe(1.2346);
    expect(reaisTexto(1234.5)).toBe('R$ 1.234,50');
    expect(recusaFat('x', 'y')).toEqual({ codigo: 'x', mensagem: 'y' });
    expect(recusaFat('x', 'y', ['a'])).toEqual({ codigo: 'x', mensagem: 'y', campos: ['a'] });
  });
});
