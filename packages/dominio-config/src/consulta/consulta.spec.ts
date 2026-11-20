// Regras puras da consulta somente leitura (M14): filtros por coluna indexada, tabela grande, máscara, cursor,
// código do registro e CSV.
import { describe, expect, it } from 'vitest';
import {
  codificarCursor,
  codigoDoRegistro,
  decodificarCursor,
  ErroFiltroConsulta,
  filtroAtendeTabelaGrande,
  gerarCsvConsulta,
  lerFiltros,
  MASCARA,
  mascarar,
  valoresDoCodigo,
} from './consulta.js';

const colunas = [
  { campo: 'id', rotulo: 'Código', tipo: 'inteiro' as const, filtro: 'igual' as const },
  { campo: 'sit', rotulo: 'Situação', tipo: 'texto' as const, filtro: 'igual' as const },
  { campo: 'data', rotulo: 'Data', tipo: 'dataHora' as const, filtro: 'periodo' as const },
  { campo: 'nome', rotulo: 'Nome', tipo: 'texto' as const },
];

describe('lerFiltros', () => {
  it('igual (inteiro e texto exato, sem mudar a caixa) e período', () => {
    expect(
      lerFiltros({ 'f.id': '12', 'f.sit': 'p', 'de.data': '2026-01-01', 'ate.data': '2026-01-31' }, colunas),
    ).toEqual([
      { campo: 'id', modo: 'igual', igual: 12 },
      { campo: 'sit', modo: 'igual', igual: 'p' },
      { campo: 'data', modo: 'periodo', de: '2026-01-01', ate: '2026-01-31' },
    ]);
    expect(lerFiltros({ 'ate.data': '2026-02-01' }, colunas)).toEqual([
      { campo: 'data', modo: 'periodo', ate: '2026-02-01' },
    ]);
    expect(lerFiltros({ apos: 'x', porPagina: '10', 'f.id': '' }, colunas)).toEqual([]);
  });
  it('recusa coluna sem índice, tipo errado, data inválida e período invertido', () => {
    expect(() => lerFiltros({ 'f.nome': 'X' }, colunas)).toThrow(ErroFiltroConsulta);
    expect(() => lerFiltros({ 'f.zzz': 'X' }, colunas)).toThrow(/indexada/);
    expect(() => lerFiltros({ 'f.id': 'abc' }, colunas)).toThrow(/inteiro/);
    expect(() => lerFiltros({ 'f.data': '2026-01-01' }, colunas)).toThrow(/período/);
    expect(() => lerFiltros({ 'de.id': '2026-01-01' }, colunas)).toThrow(/exato/);
    expect(() => lerFiltros({ 'de.data': '2026-02-30' }, colunas)).toThrow(/AAAA-MM-DD/);
    expect(() => lerFiltros({ 'de.data': '2026-03-01', 'ate.data': '2026-02-01' }, colunas)).toThrow(
      /início/,
    );
    try {
      lerFiltros({ 'f.nome': 'X' }, colunas);
    } catch (e) {
      expect((e as ErroFiltroConsulta).campos).toEqual(['nome']);
    }
  });
  it('tabela grande exige filtro', () => {
    expect(filtroAtendeTabelaGrande([])).toBe(false);
    expect(filtroAtendeTabelaGrande([{ campo: 'id', modo: 'igual', igual: 1 }])).toBe(true);
    expect(filtroAtendeTabelaGrande([{ campo: 'data', modo: 'periodo', de: '2026-01-01' }])).toBe(true);
    expect(filtroAtendeTabelaGrande([{ campo: 'data', modo: 'periodo' }])).toBe(false);
  });
});

describe('máscara, cursor e código', () => {
  it('máscara só no valor preenchido', () => {
    expect(mascarar('Fulano')).toBe(MASCARA);
    expect(mascarar(123)).toBe(MASCARA);
    expect(mascarar(null)).toBeNull();
    expect(mascarar('')).toBe('');
  });
  it('cursor ida e volta; inválido recusado', () => {
    const c = codificarCursor([1, 'A', null]);
    expect(decodificarCursor(c, 3)).toEqual([1, 'A', null]);
    expect(() => decodificarCursor('não-json', 1)).toThrow(/Página/);
    expect(() => decodificarCursor(codificarCursor([1]), 2)).toThrow(/Página/);
    expect(() => decodificarCursor(JSON.stringify([{}]), 1)).toThrow(/Página/);
  });
  it('código do registro com "|" e "%" escapados', () => {
    const c = codigoDoRegistro([1, 'A|B', '50%']);
    expect(c).toBe('1|A%7CB|50%25');
    expect(valoresDoCodigo(c, 3)).toEqual(['1', 'A|B', '50%']);
    expect(() => valoresDoCodigo('1|2', 3)).toThrow(/Código/);
  });
});

describe('gerarCsvConsulta', () => {
  it('cabeçalho, separador ";", aspas e fórmula neutralizada', () => {
    const csv = gerarCsvConsulta(
      [
        { campo: 'a', rotulo: 'A' },
        { campo: 'b', rotulo: 'B;x' },
      ],
      [
        { a: '=1+1', b: 'x"y' },
        { a: null, b: 2 },
      ],
    );
    expect(csv).toBe(`A;"B;x"\r\n'=1+1;"x""y"\r\n;2\r\n`);
  });
});
