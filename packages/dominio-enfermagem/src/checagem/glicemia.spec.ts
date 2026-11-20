// Regra 12 do M25: a glicemia checada indica a dose da faixa da escala prescrita (limites inclusivos).
import { describe, expect, it } from 'vitest';
import { doseDaGlicemia, faixaDaGlicemia } from './glicemia.js';

const faixas = [
  { de: 0, ate: 150, dose: null, unidade: null, produto: null },
  { de: 151, ate: 200, dose: 2, unidade: 'UI', produto: 900 },
  { de: 201, ate: 250, dose: 4, unidade: 'UI', produto: 900 },
  { de: 251, ate: 400, dose: 6, unidade: 'UI', produto: 900 },
];

describe('regra 12: glicemia pela escala', () => {
  it('a dose da faixa, com os limites inclusivos', () => {
    expect(doseDaGlicemia(150, faixas)).toMatchObject({ dose: null });
    expect(doseDaGlicemia(151, faixas)).toMatchObject({ dose: 2, unidade: 'UI' });
    expect(doseDaGlicemia(250, faixas)).toMatchObject({ dose: 4 });
    expect(doseDaGlicemia(251, faixas).faixa).toMatchObject({ de: 251, ate: 400 });
  });
  it('fora de todas as faixas, sem indicação', () => {
    expect(faixaDaGlicemia(450, faixas)).toBeNull();
    expect(doseDaGlicemia(450, faixas)).toEqual({ dose: null, unidade: null, faixa: null });
    expect(doseDaGlicemia(120, [])).toEqual({ dose: null, unidade: null, faixa: null });
  });
});
