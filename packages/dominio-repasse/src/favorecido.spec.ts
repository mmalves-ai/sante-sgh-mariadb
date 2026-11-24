import { describe, expect, it } from 'vitest';
import {
  diaAnterior,
  type FavorecidoNovo,
  planejarFavorecido,
  validarFavorecido,
  validarPrestadorTerceiro,
} from './favorecido.js';

const base: FavorecidoNovo = {
  profissional: 10,
  fontePagadora: null,
  tipo: 'proprio_profissional',
  pessoaJuridica: null,
  cooperativa: null,
  terceiroProfissional: null,
  contaBancaria: null,
  percentual: 100,
  inicio: '2026-11-01',
  fim: null,
};

describe('favorecido do repasse', () => {
  it('aceita o próprio profissional e recusa alvo de outro tipo', () => {
    expect(validarFavorecido(base)).toEqual([]);
    expect(validarFavorecido({ ...base, cooperativa: 3 }).map((p) => p.campo)).toEqual(['cooperativa']);
  });

  it('exige o alvo do tipo e recusa o terceiro igual ao titular', () => {
    expect(validarFavorecido({ ...base, tipo: 'pessoa_juridica' }).map((p) => p.campo)).toEqual([
      'pessoaJuridica',
    ]);
    expect(
      validarFavorecido({ ...base, tipo: 'terceiro_profissional', terceiroProfissional: 10 }).map(
        (p) => p.campo,
      ),
    ).toEqual(['terceiroProfissional']);
  });

  it('recusa parte fora de (0, 100] e vigência invertida', () => {
    const c = validarFavorecido({ ...base, percentual: 0, fim: '2026-10-01' }).map((p) => p.campo);
    expect(c).toEqual(['percentual', 'fim']);
    expect(validarFavorecido({ ...base, percentual: 100.5 }).map((p) => p.campo)).toEqual(['percentual']);
  });

  it('o favorecido novo do mesmo tipo e fonte encerra o anterior no dia de antes', () => {
    const r = planejarFavorecido(base, [
      {
        id: 1,
        fontePagadora: null,
        tipo: 'proprio_profissional',
        percentual: 100,
        inicio: '2026-01-01',
        fim: null,
      },
    ]);
    expect(r).toEqual({ encerrar: [{ id: 1, fim: '2026-10-31' }], problemas: [] });
    expect(diaAnterior('2026-03-01')).toBe('2026-02-28');
  });

  it('o anterior que começa no mesmo dia é conflito', () => {
    const r = planejarFavorecido(base, [
      {
        id: 1,
        fontePagadora: null,
        tipo: 'proprio_profissional',
        percentual: 100,
        inicio: '2026-11-01',
        fim: null,
      },
    ]);
    expect(r.problemas.map((p) => p.campo)).toEqual(['inicio']);
    expect(r.encerrar).toEqual([]);
  });

  it('a soma das partes num dia não passa de 100%', () => {
    const existentes = [
      {
        id: 1,
        fontePagadora: null,
        tipo: 'proprio_profissional' as const,
        percentual: 70,
        inicio: '2026-01-01',
        fim: null,
      },
    ];
    const pj = { ...base, tipo: 'pessoa_juridica' as const, pessoaJuridica: 5, percentual: 40 };
    expect(planejarFavorecido(pj, existentes).problemas.map((p) => p.campo)).toEqual(['percentual']);
    expect(planejarFavorecido({ ...pj, percentual: 30 }, existentes)).toEqual({
      encerrar: [],
      problemas: [],
    });
    // o que já terminou não soma
    const fechado = [{ ...existentes[0]!, fim: '2026-10-31' }];
    expect(planejarFavorecido(pj, fechado).problemas).toEqual([]);
    // fonte diferente da regra específica não soma; a geral soma em todas
    const daFonte = [{ ...existentes[0]!, fontePagadora: 8 }];
    expect(planejarFavorecido({ ...pj, fontePagadora: 9 }, daFonte).problemas).toEqual([]);
    expect(planejarFavorecido(pj, daFonte).problemas.map((p) => p.campo)).toEqual(['percentual']);
  });
});

describe('prestador terceiro', () => {
  const pj = {
    codigo: 'LAB1',
    nome: 'Laboratório Teste',
    tipoPessoa: 'juridica' as const,
    cpf: null,
    cnpj: '11222333000181',
    cnes: '1234567',
    percentualRepasse: 60,
    baseRepasse: 'cobrado' as const,
    email: null,
  };

  it('aceita a pessoa jurídica com CNPJ válido', () => {
    expect(validarPrestadorTerceiro(pj)).toEqual([]);
  });

  it('recusa documento do tipo errado, dígito inválido, CNES e percentual fora', () => {
    const c = validarPrestadorTerceiro({
      ...pj,
      cnpj: '11222333000180',
      cpf: '52998224725',
      cnes: '12',
      percentualRepasse: 120,
      email: 'x',
    }).map((p) => p.campo);
    expect(c).toEqual(['cnpj', 'cpf', 'cnes', 'percentualRepasse', 'email']);
  });

  it('pessoa física exige CPF válido', () => {
    expect(validarPrestadorTerceiro({ ...pj, tipoPessoa: 'fisica', cnpj: null, cpf: '52998224725' })).toEqual(
      [],
    );
    expect(
      validarPrestadorTerceiro({ ...pj, tipoPessoa: 'fisica', cnpj: null, cpf: '52998224700' }).map(
        (p) => p.campo,
      ),
    ).toEqual(['cpf']);
  });
});
