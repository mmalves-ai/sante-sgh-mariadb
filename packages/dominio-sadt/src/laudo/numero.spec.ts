import { describe, expect, it } from 'vitest';
import { fraseDaEmissao, numeroDoLaudo, prefixoDoNumeroLaudo, SEQUENCIA_NUMERO_LAUDO } from './numero.js';

describe('número do laudo (F3.5, linha 16)', () => {
  it('o prefixo é do estabelecimento; estabelecimento inválido recusa', () => {
    expect(SEQUENCIA_NUMERO_LAUDO).toBe('laudo_exame');
    expect(prefixoDoNumeroLaudo(7)).toBe('LAU7-');
    expect(() => prefixoDoNumeroLaudo(0)).toThrow();
    expect(() => prefixoDoNumeroLaudo(1.5)).toThrow();
  });

  it('aceita o número sequencial com o texto que termina no valor; recusa o resto', () => {
    expect(numeroDoLaudo({ valor: 12, formatado: 'LAU7-12' })).toBe('LAU7-12');
    expect(numeroDoLaudo({ valor: 1, formatado: '1' })).toBe('1');
    expect(() => numeroDoLaudo({ valor: 0, formatado: 'LAU7-0' })).toThrow();
    expect(() => numeroDoLaudo({ valor: 12, formatado: 'LAU7-13' })).toThrow();
    expect(() => numeroDoLaudo({ valor: 12, formatado: `${'X'.repeat(30)}12` })).toThrow();
  });

  it('a frase leva o número, a via e o código', () => {
    expect(fraseDaEmissao({ numero: 'LAU7-3', segundaVia: false, codigo: 'abc' })).toBe(
      'Laudo emitido: número LAU7-3 (autenticação abc).',
    );
    expect(fraseDaEmissao({ numero: 'LAU7-4', segundaVia: true, codigo: 'abc' })).toMatch(/^2ª via .*LAU7-4/);
  });
});
