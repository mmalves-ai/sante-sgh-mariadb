// Casos reescritos de sante-api: test/busca-catalogo.test.js, com nomes sintéticos (nenhum nome real).
import { describe, expect, it } from 'vitest';
import { buscarPorPalavra, casaPalavra, palavras, pontuar } from './busca.js';

const CONVENIOS = [
  { codigo: 10, nome: 'PARTICULAR' },
  { codigo: 1, nome: 'S.U.S. SINTÉTICO' },
  { codigo: 710, nome: 'UNIMED REGIONAL SINTÉTICA' },
  { codigo: 711, nome: 'UNI MED COOPERATIVA SINTÉTICA' },
  { codigo: 320, nome: 'CAIXA ASSISTÊNCIA SINTÉTICA' },
  { codigo: 315, nome: 'OPERADORA GOLDEN SINTÉTICA' },
  { codigo: 340, nome: 'SAÚDE CORPORATIVA DO SERVIDOR' },
];
const buscar = (t: string) =>
  buscarPorPalavra(
    CONVENIOS,
    t,
    (c) => c.nome,
    (c) => c.codigo,
  ).map((c) => c.codigo);

describe('busca de convênio por palavra (sem acento, prefixo nos dois sentidos, palavras coladas)', () => {
  it('acento e caixa não importam', () => {
    expect(buscar('saude')).toEqual([340]);
    expect(buscar('ASSISTENCIA')).toEqual([320]);
  });
  it('prefixo nos dois sentidos (a partir de 4 letras)', () => {
    expect(buscar('corpor')).toEqual([340]);
    expect(buscar('servidores')).toEqual([340]);
    expect(casaPalavra('UNI', ['UNIMED'])).toBe(false);
  });
  it('palavras coladas: "uni med" acha "UNIMED" e "unimed" acha "UNI MED"', () => {
    expect(buscar('unimed')).toEqual(expect.arrayContaining([710, 711]));
    expect(buscar('uni med')).toEqual(expect.arrayContaining([710, 711]));
  });
  it('conectivo não puxa resultado; termo sem relação dá zero', () => {
    expect(buscar('do')).toHaveLength(CONVENIOS.length);
    expect(buscar('ortopedia')).toEqual([]);
    expect(pontuar('', 'X')).toBe(1);
  });
  it('código exato vem primeiro; sem termo devolve todos', () => {
    expect(buscar('315')).toEqual([315]);
    expect(buscar('  ')).toHaveLength(CONVENIOS.length);
    expect(buscar('999')).toEqual([]);
    expect(palavras('S.U.S. sintético')).toEqual(['S', 'U', 'S', 'SINTETICO']);
  });
  it('o nome que começa pelo termo vem antes', () => {
    const r = buscarPorPalavra(
      [{ nome: 'SINTÉTICA PARTICULAR' }, { nome: 'PARTICULAR SINTÉTICA' }],
      'particular',
      (x) => x.nome,
    );
    expect(r[0]?.nome).toBe('PARTICULAR SINTÉTICA');
  });
});
