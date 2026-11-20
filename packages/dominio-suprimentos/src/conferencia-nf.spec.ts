// Regra 12 (ficha do M28): conferência NF × pedido com tolerâncias; fora da tolerância só com aprovação; estado P/I/C.
import { describe, expect, it } from 'vitest';
import {
  conferirCabecalhoNota,
  conferirNota,
  estadoPrevistoDoPedido,
  podeConsolidarNota,
  quantidadeEstoque,
  totalDaNota,
} from '@sgh/contratos/regras-suprimentos';

const t = { quantidadePct: 5, precoPct: 2, prazoDias: 3 };
const pedido = [{ item: 1, quantidade: 100, comprada: 40, valorUnitario: 10, entrega: '2026-10-10' }];

describe('conferência da nota (regra 12)', () => {
  it('sem pedido: dentro', () => {
    expect(
      conferirNota([{ item: 1, quantidade: 5, valorUnitario: 1, fator: 1 }], null, t, '2026-10-11').dentro,
    ).toBe(true);
  });
  it('dentro da tolerância de quantidade, preço e prazo', () => {
    const r = conferirNota(
      [{ item: 1, quantidade: 63, valorUnitario: 10.2, fator: 1 }],
      pedido,
      t,
      '2026-10-13',
    );
    expect(r.dentro).toBe(true);
  });
  it('fora: quantidade, preço, prazo e item fora do pedido', () => {
    const r = conferirNota(
      [
        { item: 1, quantidade: 64, valorUnitario: 10.21, fator: 1 },
        { item: 2, quantidade: 1, valorUnitario: 1, fator: 1 },
      ],
      pedido,
      t,
      '2026-10-14',
    );
    expect(r.dentro).toBe(false);
    expect(r.itens[0]?.divergencias).toEqual(['quantidade', 'preco', 'prazo']);
    expect(r.itens[1]?.divergencias).toEqual(['item-fora-do-pedido']);
  });
  it('fora da tolerância só consolida com aprovação e motivo', () => {
    expect(podeConsolidarNota({ dentro: true }, null)).toBeNull();
    expect(podeConsolidarNota({ dentro: false }, null)?.codigo).toBe('fora-da-tolerancia');
    expect(podeConsolidarNota({ dentro: false }, { aprovador: 'C', motivo: 'curto' })?.codigo).toBe(
      'fora-da-tolerancia',
    );
    expect(
      podeConsolidarNota({ dentro: false }, { aprovador: 'C', motivo: 'reajuste do fornecedor' }),
    ).toBeNull();
  });
  it('previsão do item do pedido (o gatilho grava): completo ou incompleto', () => {
    expect(estadoPrevistoDoPedido(pedido[0]!, 60)).toEqual({ comprada: 100, estado: 'C' });
    expect(estadoPrevistoDoPedido(pedido[0]!, 10)).toEqual({ comprada: 50, estado: 'I' });
  });
  it('fator de unidade, total com parcelas e cabeçalho', () => {
    expect(quantidadeEstoque({ quantidade: 2, fator: 12 })).toBe(24);
    expect(quantidadeEstoque({ quantidade: 2, fator: 0 })).toBe(2);
    expect(
      totalDaNota(
        [
          { item: 1, quantidade: 2, valorUnitario: 1.5, fator: 1 },
          { item: 2, quantidade: 1, valorUnitario: 3, fator: 1 },
        ],
        1,
      ),
    ).toEqual({
      total: 5,
      parcelas: [3, 3],
    });
    expect(
      conferirCabecalhoNota({ fornecedor: 1, numero: 10, serie: '1', emissao: '2026-10-20' }, '2026-10-22'),
    ).toEqual([]);
    expect(
      conferirCabecalhoNota({ fornecedor: 0, numero: 0, serie: '', emissao: '' }, '2026-10-22').map(
        (r) => r.codigo,
      ),
    ).toEqual(['sem-fornecedor', 'sem-numero', 'sem-emissao']);
    expect(
      conferirCabecalhoNota({ fornecedor: 1, numero: 1, serie: '', emissao: '2026-10-23' }, '2026-10-22')[0]
        ?.codigo,
    ).toBe('emissao-futura');
  });
});
