import { describe, expect, it } from 'vitest';
import { ehSentinela, normalizarDescricao, opcoesSemSentinela, rotuloNaConsulta } from './sentinela.js';

describe('sentinelas "não informado" (regra 17)', () => {
  it('código 0, vazio ou descrição de sentinela', () => {
    expect(ehSentinela({ codigo: 0, descricao: 'Qualquer' })).toBe(true);
    expect(ehSentinela({ codigo: '0' })).toBe(true);
    expect(ehSentinela({ codigo: null })).toBe(true);
    expect(ehSentinela({ codigo: ' ' })).toBe(true);
    expect(ehSentinela({ codigo: 7, descricao: 'NÃO INFORMADA' })).toBe(true);
    expect(ehSentinela({ codigo: 8, descricao: '  não   informado ' })).toBe(true);
    expect(ehSentinela({ codigo: 9, descricao: 'Nenhum' })).toBe(true);
    expect(ehSentinela({ codigo: 2, descricao: 'Unidade Centro' })).toBe(false);
    expect(ehSentinela({ codigo: 'A', descricao: null })).toBe(false);
  });

  it('a lista de escolha não oferece a sentinela; a consulta mostra "não informado"', () => {
    const itens = [
      { codigo: 0, descricao: 'Não informado' },
      { codigo: 1, descricao: 'Clínica médica' },
      { codigo: 2, descricao: 'Não informada' },
    ];
    expect(opcoesSemSentinela(itens).map((i) => i.codigo)).toEqual([1]);
    expect(rotuloNaConsulta(itens[0] as (typeof itens)[number])).toBe('Não informado');
    expect(rotuloNaConsulta({ codigo: 1, descricao: ' Clínica médica ' })).toBe('Clínica médica');
    expect(rotuloNaConsulta({ codigo: 5, descricao: '' })).toBe('5');
    expect(rotuloNaConsulta({ codigo: 0 }, 'Sem unidade')).toBe('Sem unidade');
  });

  it('normaliza acento, caixa e espaços', () => {
    expect(normalizarDescricao(' ÁRea   Técnica ')).toBe('area tecnica');
    expect(normalizarDescricao(null)).toBe('');
  });
});
