// Regras 2 e 3 do M56: cartão de desconto não é plano; plano exige o registro do produto na ANS.
import { describe, expect, it } from 'vitest';
import {
  fatiaValeParaNatureza,
  normalizarRegistroAns,
  problemasDoProduto,
  registroOperadoraAnsValido,
  registroProdutoAnsValido,
} from './produto.js';

describe('registro na ANS', () => {
  it('operadora com 6 dígitos e produto com 9, com ou sem pontuação', () => {
    expect(registroOperadoraAnsValido('123456')).toBe(true);
    expect(registroOperadoraAnsValido('12.345-6')).toBe(true);
    expect(registroOperadoraAnsValido('12345')).toBe(false);
    expect(registroProdutoAnsValido('123.456/78-9')).toBe(true);
    expect(registroProdutoAnsValido('123456789')).toBe(true);
    expect(registroProdutoAnsValido('12345678')).toBe(false);
    expect(registroProdutoAnsValido('12345678a')).toBe(false);
    expect(normalizarRegistroAns('123.456/78-9')).toBe('123456789');
  });
});

describe('natureza do produto (regra 2)', () => {
  it('plano sem registro ou com registro inválido é recusado', () => {
    expect(problemasDoProduto({ natureza: 'plano', registroAns: null })).toEqual(['plano-sem-registro-ans']);
    expect(problemasDoProduto({ natureza: 'plano', registroAns: '  ' })).toEqual(['plano-sem-registro-ans']);
    expect(problemasDoProduto({ natureza: 'plano', registroAns: '123' })).toEqual(['registro-ans-invalido']);
    expect(problemasDoProduto({ natureza: 'plano', registroAns: '123.456/78-9' })).toEqual([]);
  });

  it('cartão de desconto não tem registro na ANS', () => {
    expect(problemasDoProduto({ natureza: 'cartaoDesconto', registroAns: null })).toEqual([]);
    expect(problemasDoProduto({ natureza: 'cartaoDesconto', registroAns: '123456789' })).toEqual([
      'cartao-desconto-com-registro-ans',
    ]);
  });

  it('o cartão de desconto só usa cadastro, cobrança, mensagens e atendimento', () => {
    expect(fatiaValeParaNatureza('cobranca', 'cartaoDesconto')).toBe(true);
    expect(fatiaValeParaNatureza('beneficiarios', 'cartaoDesconto')).toBe(true);
    for (const f of ['rede', 'autorizacao', 'contas', 'ans', 'portalPrestador', 'interface'] as const)
      expect(fatiaValeParaNatureza(f, 'cartaoDesconto'), f).toBe(false);
    expect(fatiaValeParaNatureza('ans', 'plano')).toBe(true);
  });
});
