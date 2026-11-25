// F8, 07-FIN linha 69 (correção da revisão C1-034): o devedor do lado a receber casa pelo cliente financeiro e também
// pela fonte pagadora (convênio ou operadora) com o mesmo CNPJ do fornecedor; o paciente nunca entra.
import { describe, expect, it } from 'vitest';
import { documentoDoDevedor, type ParcelaEncontro, planejarEncontroContas } from './encontro-contas.js';

const CNPJ = '92070000000107';
const parcela = (
  natureza: 'pagar' | 'receber',
  id: number,
  saldo: number,
  documento: string,
): ParcelaEncontro => ({
  natureza,
  parcela: id,
  situacao: 'aberta',
  saldo,
  vencimento: '2026-11-01',
  documento,
  emOutroEncontro: false,
});

describe('documentoDoDevedor', () => {
  it('cliente financeiro: CNPJ ou, sem ele, CPF, só dígitos', () => {
    expect(documentoDoDevedor({ tipo: 'cliente', cnpj: '92.070.000/0001-07', cpf: null })).toBe(CNPJ);
    expect(documentoDoDevedor({ tipo: 'cliente', cnpj: null, cpf: '123.456.789-09' })).toBe('12345678909');
  });
  it('fonte pagadora: o CNPJ da pessoa jurídica dela', () => {
    expect(documentoDoDevedor({ tipo: 'fonte_pagadora', cnpj: CNPJ, cpf: null })).toBe(CNPJ);
    expect(documentoDoDevedor({ tipo: 'fonte_pagadora', cnpj: null, cpf: null })).toBe('');
  });
  it('paciente nunca casa', () => {
    expect(documentoDoDevedor({ tipo: 'paciente', cnpj: CNPJ, cpf: '12345678909' })).toBe('');
  });
});

describe('encontro com convênio que também é fornecedor', () => {
  it('a parcela do convênio com o mesmo CNPJ entra e se compensa', () => {
    const doc = documentoDoDevedor({ tipo: 'fonte_pagadora', cnpj: CNPJ, cpf: null });
    const r = planejarEncontroContas({
      documentoParceiro: CNPJ,
      parcelas: [parcela('pagar', 1, 300, CNPJ), parcela('receber', 2, 200, doc)],
    });
    expect(r).toMatchObject({ compensado: 200, saldoLiquido: -100 });
  });
  it('a parcela do paciente ou do convênio de outro CNPJ é recusada', () => {
    for (const doc of [
      documentoDoDevedor({ tipo: 'paciente', cnpj: CNPJ, cpf: null }),
      documentoDoDevedor({ tipo: 'fonte_pagadora', cnpj: '11222333000181', cpf: null }),
    ])
      expect(
        planejarEncontroContas({
          documentoParceiro: CNPJ,
          parcelas: [parcela('pagar', 1, 300, CNPJ), parcela('receber', 2, 200, doc)],
        }),
      ).toMatchObject({ codigo: 'parceiro-diferente' });
  });
});
