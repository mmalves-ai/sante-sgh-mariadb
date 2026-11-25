// 05-SUP linha 27: o pedido de compra ligado ao contrato do fornecedor compra só dele. A vencedora escolhida na cotação
// é a proposta do fornecedor do contrato; sem contrato, qualquer proposta do item vale.
import { describe, expect, it } from 'vitest';
import { conferirVencedoraDoContrato } from '../index.js';

const propostas = [
  { id: 1, fornecedor: 0 },
  { id: 2, fornecedor: 10 },
  { id: 3, fornecedor: 11 },
  { id: 4, fornecedor: 10 },
];

describe('vencedora do pedido ligado ao contrato', () => {
  it('aceita a proposta do fornecedor do contrato', () => {
    expect(conferirVencedoraDoContrato(propostas, [2], 10)).toBeNull();
  });

  it('aceita o rateio entre propostas do mesmo fornecedor do contrato', () => {
    expect(conferirVencedoraDoContrato(propostas, [2, 4], 10)).toBeNull();
  });

  it('recusa a proposta de outro fornecedor, apontando o campo das vencedoras', () => {
    expect(conferirVencedoraDoContrato(propostas, [3], 10)).toEqual({
      codigo: 'fornecedor-diferente',
      mensagem: 'O pedido está ligado ao contrato: a vencedora é a proposta do fornecedor do contrato.',
      campos: ['vencedoras'],
    });
  });

  it('recusa o rateio que mistura o fornecedor do contrato com outro', () => {
    expect(conferirVencedoraDoContrato(propostas, [2, 3], 10)?.codigo).toBe('fornecedor-diferente');
  });

  it('sem contrato, qualquer proposta vale', () => {
    expect(conferirVencedoraDoContrato(propostas, [3], null)).toBeNull();
  });

  it('a proposta não escolhida de outro fornecedor não pesa', () => {
    expect(conferirVencedoraDoContrato(propostas, [4], 10)).toBeNull();
  });
});
