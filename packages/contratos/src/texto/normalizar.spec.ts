import { describe, expect, it } from 'vitest';
import { casaBusca, normalizarChave } from './normalizar.js';

describe('normalizarChave', () => {
  it('ignora acento, caixa e pontuação', () => {
    expect(normalizarChave('Preferências do usuário!')).toBe('PREFERENCIAS DO USUARIO');
    expect(normalizarChave(null)).toBe('');
  });
  it('busca por partes, em qualquer ordem', () => {
    expect(casaBusca('Tema, densidade, atalhos', 'densid tema')).toBe(true);
    expect(casaBusca('Tema, densidade, atalhos', 'agenda')).toBe(false);
    expect(casaBusca('qualquer', '')).toBe(true);
  });
});
