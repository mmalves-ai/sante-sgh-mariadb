// C1-126 (09-AREA linha 79): a doação recebida entra sem pedido, com doador, termo e custo de referência (valor justo do
// termo ou último preço de compra, NBC TG 07); a parte doada do saldo soma na entrada e nunca passa do saldo na saída.
import { describe, expect, it } from 'vitest';
import {
  avisosValorJusto,
  conferirEntradaDoacao,
  custoDaDoacao,
  custoUnitarioDoacao,
  type DoacaoParaConferir,
  type ItemDoacaoParaConferir,
  quantidadeDoadaApos,
} from '../index.js';

const item: ItemDoacaoParaConferir = {
  item: 7,
  quantidade: 10,
  criterio: 'valor_justo',
  valorJusto: 2.5,
  ultimoPreco: 2,
};
const doacao: DoacaoParaConferir = {
  doador: { tipo: 'empresa', id: 3 },
  termo: 'TD-2026/15',
  recebidaEm: '2026-11-25',
  hoje: '2026-11-25',
  itens: [item],
};
const cod = (x: Partial<DoacaoParaConferir>) =>
  conferirEntradaDoacao({ ...doacao, ...x }).map((r) => r.codigo);

describe('entrada por doação (C1-126)', () => {
  it('a doação completa passa', () => {
    expect(conferirEntradaDoacao(doacao)).toEqual([]);
    expect(cod({ doador: { tipo: 'pessoa', id: 9 } })).toEqual([]);
  });

  it('doador, termo e data são exigidos; a data não pode ser futura', () => {
    expect(cod({ doador: null })).toEqual(['sem-doador']);
    expect(cod({ doador: { tipo: 'empresa', id: 0 } })).toEqual(['sem-doador']);
    expect(cod({ termo: '  ' })).toEqual(['termo-invalido']);
    expect(cod({ termo: 'termo com espaço' })).toEqual(['termo-invalido']);
    expect(cod({ termo: 'X'.repeat(21) })).toEqual(['termo-invalido']);
    expect(cod({ recebidaEm: '25/11/2026' })).toEqual(['data-invalida']);
    expect(cod({ recebidaEm: '2026-11-26' })).toEqual(['data-futura']);
  });

  it('itens: ao menos um, sem repetir, quantidade positiva com até 4 casas', () => {
    expect(cod({ itens: [] })).toEqual(['sem-itens']);
    expect(cod({ itens: [item, { ...item }] })).toEqual(['item-repetido']);
    expect(cod({ itens: [{ ...item, quantidade: 0 }] })).toEqual(['quantidade-invalida']);
    expect(cod({ itens: [{ ...item, quantidade: 1.00001 }] })).toEqual(['quantidade-invalida']);
    expect(cod({ itens: [{ ...item, quantidade: 1.5 }] })).toEqual([]);
    const muitos = Array.from({ length: 201 }, (_, k) => ({ ...item, item: k + 1 }));
    expect(cod({ itens: muitos })).toEqual(['itens-demais']);
  });

  it('o custo vem do valor justo do termo ou do último preço; sem nenhum dos dois, recusa', () => {
    expect(cod({ itens: [{ ...item, valorJusto: null }] })).toEqual(['sem-valor-justo']);
    expect(cod({ itens: [{ ...item, valorJusto: 0 }] })).toEqual(['sem-valor-justo']);
    expect(cod({ itens: [{ ...item, criterio: 'ultimo_preco', ultimoPreco: null }] })).toEqual([
      'sem-ultimo-preco',
    ]);
    expect(cod({ itens: [{ ...item, criterio: 'ultimo_preco', valorJusto: null }] })).toEqual([]);
    expect(custoUnitarioDoacao(item)).toBe(2.5);
    expect(custoUnitarioDoacao({ ...item, criterio: 'ultimo_preco' })).toBe(2);
    expect(custoUnitarioDoacao({ ...item, criterio: 'ultimo_preco', ultimoPreco: null })).toBeNull();
  });

  it('o total do termo é a soma das parcelas de cada item, em reais', () => {
    const c = custoDaDoacao([
      item,
      { item: 8, quantidade: 3, criterio: 'ultimo_preco', valorJusto: null, ultimoPreco: 1.333333 },
    ]);
    expect(c.itens).toEqual([
      { item: 7, custoUnitario: 2.5, valorTotal: 25 },
      { item: 8, custoUnitario: 1.333333, valorTotal: 4 },
    ]);
    expect(c.total).toBe(29);
  });

  it('avisa (sem recusar) o valor justo que difere mais de 50% do último preço', () => {
    expect(avisosValorJusto([item])).toEqual([]);
    expect(avisosValorJusto([{ ...item, valorJusto: 3.01 }])).toEqual([7]);
    expect(avisosValorJusto([{ ...item, valorJusto: 0.99 }])).toEqual([7]);
    expect(avisosValorJusto([{ ...item, valorJusto: 9, ultimoPreco: null }])).toEqual([]);
    expect(avisosValorJusto([{ ...item, criterio: 'ultimo_preco', valorJusto: 9 }])).toEqual([]);
  });

  it('a parte doada do saldo soma na entrada doada e nunca passa do saldo que fica', () => {
    expect(quantidadeDoadaApos(0, 10, { natureza: 'entrada', quantidade: 10, doacao: true })).toBe(10);
    expect(quantidadeDoadaApos(4, 20, { natureza: 'entrada', quantidade: 6, doacao: false })).toBe(4);
    expect(quantidadeDoadaApos(10, 15, { natureza: 'saida', quantidade: 5, doacao: false })).toBe(10);
    expect(quantidadeDoadaApos(10, 6, { natureza: 'saida', quantidade: 14, doacao: false })).toBe(6);
    expect(quantidadeDoadaApos(2, 0, { natureza: 'saida', quantidade: 2, doacao: false })).toBe(0);
  });
});
