import { describe, expect, it } from 'vitest';
import {
  conferirConsumoPadrao,
  consumoDaRealizacao,
  escolherConsumoPadrao,
  produtosDoConsumo,
} from './consumo-padrao.js';

const item = (insumo: number | null, kit: number | null, quantidade = 1, ajustavel = true) => ({
  insumo,
  kit,
  quantidade,
  ajustavel,
});

describe('consumo padrão do exame: cadastro', () => {
  it('aceita produto e kit, um de cada', () => {
    expect(conferirConsumoPadrao([item(1, null), item(null, 9, 2)])).toEqual([]);
  });
  it('recusa vazio, os dois alvos, nenhum alvo, quantidade zero e repetido', () => {
    expect(conferirConsumoPadrao([])[0]?.campo).toBe('itens');
    const r = conferirConsumoPadrao([item(1, 2), item(null, null), item(3, null, 0), item(3, null)]);
    expect(r.map((x) => x.campo)).toEqual(['itens.0', 'itens.1', 'itens.2.quantidade', 'itens.3']);
  });
});

describe('consumo padrão do exame: escolha', () => {
  const c = [
    { id: 1, setor: null, ativo: true },
    { id: 2, setor: 7, ativo: true },
    { id: 3, setor: 8, ativo: false },
  ];
  it('o do setor vale antes do geral', () => expect(escolherConsumoPadrao(c, 7)?.id).toBe(2));
  it('setor sem consumo próprio (ou inativo) usa o geral', () => {
    expect(escolherConsumoPadrao(c, 8)?.id).toBe(1);
    expect(escolherConsumoPadrao(c, null)?.id).toBe(1);
  });
  it('nenhum ativo: null', () => expect(escolherConsumoPadrao([c[2]!], 8)).toBeNull());
});

describe('consumo padrão do exame: kit aberto', () => {
  it('multiplica o kit e soma o mesmo produto', () => {
    const p = produtosDoConsumo(
      [item(10, null, 1, false), item(null, 5, 2, true)],
      [
        { kit: 5, insumo: 10, quantidade: 0.5 },
        { kit: 5, insumo: 11, quantidade: 3 },
      ],
    );
    expect(p).toEqual([
      { insumo: 10, quantidade: 2, ajustavel: true },
      { insumo: 11, quantidade: 6, ajustavel: true },
    ]);
  });
});

describe('consumo padrão do exame: realização', () => {
  const produtos = [
    { insumo: 1, quantidade: 2, ajustavel: true, cobravelNoCadastro: true },
    { insumo: 2, quantidade: 1, ajustavel: false, cobravelNoCadastro: true },
    { insumo: 3, quantidade: 4, ajustavel: true, cobravelNoCadastro: false },
  ];
  const base = { produtos, lancamentoContaAutomatico: true, comAtendimento: true };
  it('sem ajuste: baixa tudo; só o cobrável do cadastro vai à conta', () => {
    const r = consumoDaRealizacao({ ...base, ajustes: [] });
    expect(r).toEqual({
      ok: true,
      baixas: [
        { insumo: 1, quantidade: 2, cobravel: true },
        { insumo: 2, quantidade: 1, cobravel: true },
        { insumo: 3, quantidade: 4, cobravel: false },
      ],
    });
  });
  it('ajuste no ajustável, zero tira o item, e o executante tira da cobrança', () => {
    const r = consumoDaRealizacao({
      ...base,
      ajustes: [
        { insumo: 1, quantidade: 3, cobrar: false },
        { insumo: 3, quantidade: 0 },
      ],
    });
    expect(r).toEqual({
      ok: true,
      baixas: [
        { insumo: 1, quantidade: 3, cobravel: false },
        { insumo: 2, quantidade: 1, cobravel: true },
      ],
    });
  });
  it('pacote (sem lançamento na conta) e exame sem atendimento: o estoque baixa, nada na conta', () => {
    for (const x of [
      { lancamentoContaAutomatico: false, comAtendimento: true },
      { lancamentoContaAutomatico: true, comAtendimento: false },
    ]) {
      const r = consumoDaRealizacao({ ...base, ...x, ajustes: [] });
      expect(r.ok && r.baixas.every((b) => !b.cobravel)).toBe(true);
    }
  });
  it('recusa o ajuste do não ajustável, o produto de fora, o repetido e o "nada a baixar"', () => {
    const r = consumoDaRealizacao({
      ...base,
      ajustes: [
        { insumo: 2, quantidade: 5 },
        { insumo: 99, quantidade: 1 },
        { insumo: 1, quantidade: 1 },
        { insumo: 1, quantidade: 2 },
      ],
    });
    expect(r.ok ? [] : r.recusas.map((x) => x.campo)).toEqual([
      'ajustes.0.quantidade',
      'ajustes.1',
      'ajustes.3',
    ]);
    const nada = consumoDaRealizacao({
      ...base,
      produtos: [produtos[0]!],
      ajustes: [{ insumo: 1, quantidade: 0 }],
    });
    expect(nada.ok).toBe(false);
  });
});
