// Busca do item prescritível (M24, seção 4): sem acento, todas as palavras, padronizado primeiro, 30 sugestões.
import { describe, expect, it } from 'vitest';
import { buscarNoIndice, chaveDeBusca, montarIndiceBusca } from './busca.js';

const indice = montarIndiceBusca([
  { produto: 3, nome: 'DIPIRONA SÓDICA 500 MG/ML SINTETICO', padronizado: false, principios: ['DIPIRONA'] },
  { produto: 1, nome: 'DIPIRONA SÓDICA 1 G SINTETICO', padronizado: true, principios: ['DIPIRONA'] },
  { produto: 2, nome: 'NOVALGINA SINTETICO', padronizado: true, principios: ['DIPIRONA SÓDICA'] },
  { produto: 4, nome: 'AÇÚCAR SINTETICO', padronizado: true, principios: [] },
]);

describe('busca de item prescritível', () => {
  it('sem acento e sem maiúscula: "dipirona sodica" acha o nome com acento e o princípio ativo', () => {
    expect(chaveDeBusca('  Dipirona   sódica ')).toBe('DIPIRONA SODICA');
    expect(buscarNoIndice(indice, 'dipirona sodica')).toEqual([1, 2, 3]);
    expect(buscarNoIndice(indice, 'acucar')).toEqual([4]);
    expect(buscarNoIndice(indice, 'sódica 500')).toEqual([3]);
  });
  it('padronizado primeiro; teto de sugestões; termo curto não busca', () => {
    expect(buscarNoIndice(indice, 'sintetico')).toEqual([4, 1, 2, 3]);
    expect(buscarNoIndice(indice, 'sintetico', 2)).toEqual([4, 1]);
    expect(buscarNoIndice(indice, 'd')).toEqual([]);
    expect(buscarNoIndice(indice, 'inexistente')).toEqual([]);
  });
});
