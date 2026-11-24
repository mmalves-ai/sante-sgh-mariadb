import { describe, expect, it } from 'vitest';
import { fraseDaEmissao, numeroDoLaudo, SEQUENCIA_NUMERO_LAUDO } from './numero.js';

describe('número do laudo (F3.5, linha 16)', () => {
  it('a numeração do laudo é a do estabelecimento, pelo tipo de negócio', () => {
    expect(SEQUENCIA_NUMERO_LAUDO).toBe('laudo_exame');
  });

  it('aceita o número sequencial com o texto que termina no valor; recusa o resto', () => {
    expect(numeroDoLaudo({ valor: 12, formatado: 'LAU7-12' })).toBe('LAU7-12');
    expect(numeroDoLaudo({ valor: 1, formatado: '1' })).toBe('1');
    expect(() => numeroDoLaudo({ valor: 0, formatado: 'LAU7-0' })).toThrow();
    expect(() => numeroDoLaudo({ valor: 12, formatado: 'LAU7-13' })).toThrow();
    expect(() => numeroDoLaudo({ valor: 12, formatado: `${'X'.repeat(30)}12` })).toThrow();
  });

  it('a frase leva o número do laudo (o mesmo em todas as vias), a via e o código', () => {
    expect(fraseDaEmissao({ numero: '3', via: 1, codigo: 'abc' })).toBe(
      'Laudo emitido: número 3 (autenticação abc).',
    );
    expect(fraseDaEmissao({ numero: '3', via: 2, codigo: 'abc' })).toBe(
      '2ª via do laudo número 3 emitida (autenticação abc).',
    );
    expect(fraseDaEmissao({ numero: '3', via: 3, codigo: 'abc' })).toMatch(/^3ª via .*número 3/);
    expect(() => fraseDaEmissao({ numero: '3', via: 0, codigo: 'abc' })).toThrow();
  });
});
