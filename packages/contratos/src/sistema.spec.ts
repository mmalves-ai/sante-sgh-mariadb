import { describe, expect, it } from 'vitest';
import { esquemaVersao } from './index.js';

describe('esquemaVersao', () => {
  it('aceita versão com commit e recusa produto vazio', () => {
    const base = {
      produto: 'Produto de teste',
      versao: '0.1.0',
      commit: 'abcdef123456',
      construidoEm: '2026-10-19T19:00:00.000Z',
      identificacao: '0.1.0+abcdef123456',
    };
    expect(esquemaVersao.parse(base)).toEqual(base);
    expect(esquemaVersao.safeParse({ ...base, produto: '' }).success).toBe(false);
  });
});
