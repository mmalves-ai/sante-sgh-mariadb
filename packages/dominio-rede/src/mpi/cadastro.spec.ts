// Normalização do cadastro para o pareamento (M57, regras 2 e 3): CPF placeholder e inválido viram ausente, CNS só
// válido, sentinela do nascimento, sexo, elegibilidade (inativo e absorvido não pareiam). Dados sintéticos.
import { describe, expect, it } from 'vitest';
import { chavesFoneticas, cnsParaParear, comparavel, cpfParaParear } from './cadastro.js';
import { CNS_A, CPF_A, cadastro } from './massa.spec-util.js';

describe('CPF para parear', () => {
  it('placeholder, zero, sequência, dígito errado e ausente nunca pareiam', () => {
    expect(cpfParaParear('00000000000')).toBeNull();
    expect(cpfParaParear(0)).toBeNull();
    expect(cpfParaParear('11111111111')).toBeNull();
    expect(cpfParaParear(`${CPF_A.slice(0, 10)}${(Number(CPF_A[10]) + 1) % 10}`)).toBeNull();
    expect(cpfParaParear(null)).toBeNull();
    expect(cpfParaParear(undefined)).toBeNull();
    expect(cpfParaParear('')).toBeNull();
    expect(cpfParaParear(1e12)).toBeNull();
  });

  it('o número do banco (DOUBLE) volta com os zeros à esquerda', () => {
    const comZero = '0' + CPF_A.slice(1);
    const r = cpfParaParear(Number(comZero));
    expect(r === null || r.length === 11).toBe(true);
    expect(cpfParaParear(Number(CPF_A))).toBe(CPF_A);
    expect(
      cpfParaParear(`${CPF_A.slice(0, 3)}.${CPF_A.slice(3, 6)}.${CPF_A.slice(6, 9)}-${CPF_A.slice(9)}`),
    ).toBe(CPF_A);
  });
});

describe('CNS para parear', () => {
  it('só o que passa no algoritmo', () => {
    expect(cnsParaParear(CNS_A)).toBe(CNS_A);
    expect(cnsParaParear('0')).toBeNull();
    expect(cnsParaParear('700000000000006')).toBeNull();
    expect(cnsParaParear(null)).toBeNull();
  });
});

describe('comparável', () => {
  it('normaliza nome e mãe, gera as chaves fonéticas sem conectivos', () => {
    const c = comparavel(cadastro({ nome: 'Ána  de Teste Fictícia', mae: null }));
    expect(c.nome).toBe('ANA DE TESTE FICTICIA');
    expect(c.nomeFonetico).toEqual(chavesFoneticas('ANA TESTE FICTICIA'));
    expect(c.mae).toBeNull();
    expect(c.maeFonetica).toEqual([]);
  });

  it('nascimento sentinela ou malformado vira ausente; sexo fora de F/M vira ausente', () => {
    expect(comparavel(cadastro({ nascimento: '1899-12-30' })).nascimento).toBeNull();
    expect(comparavel(cadastro({ nascimento: '1900-01-01' })).nascimento).toBeNull();
    expect(comparavel(cadastro({ nascimento: '17/05/1980' })).nascimento).toBeNull();
    expect(comparavel(cadastro({ nascimento: null })).nascimento).toBeNull();
    expect(comparavel(cadastro({ sexo: 'I' })).sexo).toBeNull();
    expect(comparavel(cadastro({ sexo: ' m ' })).sexo).toBe('M');
    expect(comparavel(cadastro({ sexo: null })).sexo).toBeNull();
  });

  it('inativo e absorvido por unificação não são elegíveis; sem marca de unificação é', () => {
    expect(comparavel(cadastro({ ativo: false })).elegivel).toBe(false);
    expect(comparavel(cadastro({ idUnificado: 55 })).elegivel).toBe(false);
    expect(comparavel(cadastro({ idUnificado: null })).elegivel).toBe(true);
    expect(comparavel(cadastro()).elegivel).toBe(true);
  });

  it('nome vazio vira ausente', () => {
    const c = comparavel(cadastro({ nome: '   ' }));
    expect(c.nome).toBeNull();
    expect(c.nomeFonetico).toEqual([]);
  });
});
