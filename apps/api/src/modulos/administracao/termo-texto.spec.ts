// M60.3 (ensaio do manual): o termo de uso em RTF chega à pessoa como texto corrido. Texto sintético.
import { describe, expect, it } from 'vitest';
import { textoDoTermo } from './permissoes.controller.js';

describe('texto do termo de uso na sessão', () => {
  it('RTF vira texto corrido, sem códigos de controle', () => {
    const rtf =
      "{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fswiss Arial;}}\\pard\\qc\\b TERMO DE CONCORD\\'c2NCIA\\b0\\par Eu me comprometo.\\par}";
    const t = textoDoTermo(rtf);
    expect(t).toContain('TERMO DE CONCORDÂNCIA');
    expect(t).toContain('Eu me comprometo.');
    expect(t).not.toMatch(/\\rtf|\\par|fonttbl|\{|\}/);
  });

  it('texto simples passa como está', () => {
    expect(textoDoTermo('Termo de uso sintético.')).toBe('Termo de uso sintético.');
  });
});
