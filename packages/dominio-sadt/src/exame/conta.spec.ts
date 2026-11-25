import { describe, expect, it } from 'vitest';
import { cobrancaDoExame, type EntradaCobrancaExame, estornoDoExameNaConta } from './conta.js';
import { RecusaPedido } from './pedido.js';

const preco = { unitario: 40, honorario: 10, custoOperacional: 25, filme: 5 };
const base: EntradaCobrancaExame = {
  quantidade: 1,
  percentual: 100,
  itemCobravel: 7,
  contaAberta: true,
  preco,
  doOrcamento: false,
};

describe('cobrança do exame pedido na conta', () => {
  it('lança a quantidade pelo preço vigente, com as partes do preço', () => {
    expect(cobrancaDoExame({ ...base, quantidade: 3 })).toEqual({
      lanca: true,
      quantidade: 3,
      percentual: 100,
      unitario: 40,
      honorario: 30,
      custoOperacional: 75,
      filme: 15,
      total: 120,
    });
  });

  it('aplica o percentual de cobrança do pedido com arredondamento em centavos', () => {
    const c = cobrancaDoExame({ ...base, percentual: 33.3333, preco: { ...preco, unitario: 10.01 } });
    expect(c).toMatchObject({ lanca: true, total: 3.34 });
  });

  it('o pedido nunca espera a cobrança: a falta vira pendência, na ordem do que resolver primeiro', () => {
    const pend = (e: Partial<EntradaCobrancaExame>) => {
      const c = cobrancaDoExame({ ...base, ...e });
      return c.lanca ? null : c.pendencia;
    };
    expect(pend({ doOrcamento: true, itemCobravel: null })).toBe('do-orcamento');
    expect(pend({ itemCobravel: null, contaAberta: false })).toBe('sem-item-cobravel');
    expect(pend({ contaAberta: false, preco: null })).toBe('sem-conta');
    expect(pend({ preco: null })).toBe('sem-preco');
  });
});

describe('estorno do exame cancelado', () => {
  const lancamento = { situacaoItem: 'lancado', situacaoConta: 'aberta' };

  it('estorna quando o motivo tira da conta e mantém quando não tira', () => {
    expect(estornoDoExameNaConta({ removeDaConta: true, lancamento })).toBe('estornar');
    expect(estornoDoExameNaConta({ removeDaConta: false, lancamento })).toBe('manter');
  });

  it('nada a fazer sem lançamento ou com o item já estornado', () => {
    expect(estornoDoExameNaConta({ removeDaConta: true, lancamento: null })).toBe('nada');
    expect(
      estornoDoExameNaConta({
        removeDaConta: true,
        lancamento: { ...lancamento, situacaoItem: 'estornado' },
      }),
    ).toBe('nada');
  });

  it('recusa o estorno em conta fechada e em item glosado; sem estorno o cancelamento segue', () => {
    const fechada = { ...lancamento, situacaoConta: 'fechada' };
    expect(() => estornoDoExameNaConta({ removeDaConta: true, lancamento: fechada })).toThrow(RecusaPedido);
    expect(estornoDoExameNaConta({ removeDaConta: false, lancamento: fechada })).toBe('manter');
    try {
      estornoDoExameNaConta({ removeDaConta: true, lancamento: { ...lancamento, situacaoItem: 'glosado' } });
      expect.unreachable();
    } catch (e) {
      expect((e as RecusaPedido).codigo).toBe('item-nao-estornavel');
    }
  });
});
