// Regra 2 do M08: lista, filtro e ordenação no servidor, com teto.
import { describe, expect, it } from 'vitest';
import { montarLista, passouDoTeto } from './lista.js';

const it3 = [
  { codigo: '1', ativo: true, valores: { nome: 'Árvore', ordem: 3 }, versao: 'v' },
  { codigo: '2', ativo: false, valores: { nome: 'Bola', ordem: 1 }, versao: 'v' },
  { codigo: '3', ativo: true, valores: { nome: 'casa', ordem: null }, versao: 'v' },
];
const op = { camposOrdenaveis: ['nome', 'ordem'], camposBusca: ['nome'], truncada: false };

describe('lista no servidor (regra 2)', () => {
  it('sem inativos por padrão; com inativos quando pedido', () => {
    expect(montarLista(it3, {}, op).itens.map((i) => i.codigo)).toEqual(['1', '3']);
    expect(montarLista(it3, { inativos: 'sim' }, op).total).toBe(3);
  });
  it('busca sem acento e por código', () => {
    expect(montarLista(it3, { busca: 'arvore' }, op).itens.map((i) => i.codigo)).toEqual(['1']);
    expect(montarLista(it3, { busca: '3' }, op).itens.map((i) => i.codigo)).toEqual(['3']);
  });
  it('ordena por campo permitido (texto e número, nulos primeiro) e ignora campo não permitido', () => {
    expect(
      montarLista(it3, { ordem: 'nome', direcao: 'desc', inativos: 'sim' }, op).itens.map((i) => i.codigo),
    ).toEqual(['3', '2', '1']);
    expect(montarLista(it3, { ordem: 'ordem', inativos: 'sim' }, op).itens.map((i) => i.codigo)).toEqual([
      '3',
      '2',
      '1',
    ]);
    expect(
      montarLista(it3, { ordem: 'codigoInterno', inativos: 'sim' }, op).itens.map((i) => i.codigo),
    ).toEqual(['1', '2', '3']);
    expect(montarLista(it3, { direcao: 'desc' }, op).itens.map((i) => i.codigo)).toEqual(['3', '1']);
  });
  it('pagina com teto de 100 por página e página fora do intervalo', () => {
    const muitos = Array.from({ length: 30 }, (_, i) => ({
      codigo: String(i),
      ativo: true,
      valores: {},
      versao: 'v',
    }));
    const l = montarLista(muitos, { pagina: 2, porPagina: 10 }, { ...op, truncada: true });
    expect(l).toMatchObject({ total: 30, pagina: 2, porPagina: 10, truncada: true });
    expect(l.itens[0]?.codigo).toBe('10');
    expect(montarLista(muitos, { pagina: 99 }, op).pagina).toBe(2);
    expect(montarLista(muitos, {}, { ...op, porPaginaPadrao: 7 }).porPagina).toBe(7);
  });
  it('teto da leitura', () => {
    expect(passouDoTeto(500)).toBe(false);
    expect(passouDoTeto(501)).toBe(true);
  });
});
