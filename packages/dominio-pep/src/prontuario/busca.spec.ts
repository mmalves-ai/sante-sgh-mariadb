import { describe, expect, it } from 'vitest';
import { dobrar, procurarPalavra } from './busca.js';

describe('busca de palavra', () => {
  it('ignora acento e maiúscula, conta as ocorrências e recorta o trecho', () => {
    const t = `${'x '.repeat(100)}Dor TORÁCICA ao esforço; nega dor torácica em repouso. ${'y '.repeat(100)}`;
    const r = procurarPalavra(t, 'toracica');
    expect(r.ocorrencias).toBe(2);
    expect(r.trecho).toContain('TORÁCICA');
    expect(r.trecho.startsWith('…')).toBe(true);
    expect(r.trecho.endsWith('…')).toBe(true);
    expect(r.trecho.length).toBeLessThanOrEqual(170);
  });
  it('termo curto ou ausente: nada', () => {
    expect(procurarPalavra('abc', 'ab')).toEqual({ ocorrencias: 0, trecho: '' });
    expect(procurarPalavra('abc', 'xyz')).toEqual({ ocorrencias: 0, trecho: '' });
    expect(dobrar('Ação')).toBe('acao');
    expect(procurarPalavra('início', 'INICIO').trecho).toBe('início');
  });
});
