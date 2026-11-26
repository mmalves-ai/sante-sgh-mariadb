import { describe, expect, it } from 'vitest';
import { casasDaUnidade, composicaoDaPorcao, validarPorcao } from './composicao.js';

const N = [
  { codigo: 'ENERC_KCAL', descricao: 'Energia', tipo: 'energia', unidade: 'kcal', quantidade100g: 128.3 },
  { codigo: 'PROCNT', descricao: 'Proteína', tipo: 'macronutriente', unidade: 'g', quantidade100g: 2.54 },
  { codigo: 'NA', descricao: 'Sódio', tipo: 'micronutriente', unidade: 'mg', quantidade100g: 1.237 },
  { codigo: 'VITA_RAE', descricao: 'Vitamina A', tipo: 'micronutriente', unidade: 'mcg', quantidade100g: 0 },
] as const;

describe('composição nutricional da porção', () => {
  it('escala pela porção e arredonda pela unidade', () => {
    const r = composicaoDaPorcao(N, 150);
    expect(r.map((x) => x.quantidadePorcao)).toEqual([192, 3.8, 1.86, 0]);
    expect(r[0]?.quantidade100g).toBe(128.3);
  });

  it('100 g devolve os valores da tabela no arredondamento da unidade', () => {
    expect(composicaoDaPorcao(N, 100).map((x) => x.quantidadePorcao)).toEqual([128, 2.5, 1.24, 0]);
  });

  it('recusa porção fora da faixa', () => {
    expect(validarPorcao(0)).toMatch(/1 g a 5000 g/);
    expect(validarPorcao(Number.NaN)).toMatch(/Informe/);
    expect(validarPorcao(5000)).toBeNull();
    expect(() => composicaoDaPorcao(N, 5001)).toThrow(RangeError);
  });

  it('casas por unidade', () => {
    expect([casasDaUnidade('kJ'), casasDaUnidade('g'), casasDaUnidade('mg'), casasDaUnidade('mcg')]).toEqual([
      0, 1, 2, 0,
    ]);
  });
});
