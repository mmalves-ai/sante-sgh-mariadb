import { describe, expect, it } from 'vitest';
import {
  diaAnterior,
  dividirRepasse,
  donoDaConta,
  type FavorecidoNovo,
  partesDaFonte,
  planejarFavorecido,
  retencoesDoFavorecido,
  validarEncerramento,
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
    // fonte diferente da regra específica não soma; a da fonte substitui os gerais nela (o geral não soma com ela)
    const daFonte = [{ ...existentes[0]!, fontePagadora: 8 }];
    expect(planejarFavorecido({ ...pj, fontePagadora: 9 }, daFonte).problemas).toEqual([]);
    expect(planejarFavorecido(pj, daFonte).problemas).toEqual([]);
    expect(planejarFavorecido({ ...pj, fontePagadora: 8 }, daFonte).problemas.map((p) => p.campo)).toEqual([
      'percentual',
    ]);
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

describe('favorecido por fonte pagadora, divisão do lançamento e encerramento (correção F3.7-11)', () => {
  const v = (
    id: number,
    fontePagadora: number | null,
    tipo: FavorecidoNovo['tipo'],
    percentual: number,
    fim: string | null = null,
  ) => ({ id, fontePagadora, tipo, percentual, inicio: '2026-01-01', fim, contaBancaria: null });

  it('soma por fonte efetiva: 60% na fonte A e 60% na B não impedem um geral de 10%', () => {
    const ex = [v(1, 7, 'pessoa_juridica', 60), v(2, 8, 'cooperativa', 60)];
    expect(planejarFavorecido({ ...base, percentual: 10 }, ex).problemas).toEqual([]);
    expect(
      planejarFavorecido({ ...base, fontePagadora: 7, percentual: 50 }, ex).problemas.map((p) => p.campo),
    ).toEqual(['percentual']);
    expect(planejarFavorecido({ ...base, fontePagadora: 9, percentual: 100 }, ex).problemas).toEqual([]);
  });

  it('a fonte com favorecido próprio substitui os gerais; as demais usam os gerais', () => {
    const ex = [v(1, null, 'proprio_profissional', 100), v(2, 7, 'pessoa_juridica', 100)];
    expect(partesDaFonte(ex, 7, '2026-11-10').map((p) => p.id)).toEqual([2]);
    expect(partesDaFonte(ex, 8, '2026-11-10').map((p) => p.id)).toEqual([1]);
    expect(partesDaFonte(ex, null, '2026-11-10').map((p) => p.id)).toEqual([1]);
  });

  it('divide 60/40 com o centavo que sobra na maior parte', () => {
    const d = dividirRepasse(
      100001,
      [v(1, null, 'pessoa_juridica', 60), v(2, null, 'cooperativa', 40)],
      null,
      '2026-11-10',
    );
    expect(d).toEqual({
      ok: true,
      partes: [
        { favorecido: 1, tipo: 'pessoa_juridica', percentual: 60, centavos: 60001 },
        { favorecido: 2, tipo: 'cooperativa', percentual: 40, centavos: 40000 },
      ],
    });
  });

  it('o resto até 100% vai ao próprio profissional; sem ele, recusa', () => {
    const d = dividirRepasse(
      10000,
      [v(1, null, 'proprio_profissional', 30), v(2, null, 'pessoa_juridica', 40)],
      null,
      '2026-11-10',
    );
    expect(d.ok && d.partes.map((p) => [p.favorecido, p.centavos])).toEqual([
      [1, 6000],
      [2, 4000],
    ]);
    const r = dividirRepasse(10000, [v(2, null, 'pessoa_juridica', 40)], null, '2026-11-10');
    expect(r.ok ? '' : r.codigo).toBe('favorecidos-incompletos');
    const s = dividirRepasse(10000, [v(2, null, 'pessoa_juridica', 100, '2026-01-31')], null, '2026-11-10');
    expect(s.ok ? '' : s.codigo).toBe('sem-favorecido');
  });

  it('encerrar só antecipa o fim', () => {
    expect(validarEncerramento({ inicio: '2026-01-01', fim: null }, '2026-12-31')).toEqual([]);
    expect(validarEncerramento({ inicio: '2026-01-01', fim: '2026-06-30' }, '2026-05-31')).toEqual([]);
    expect(validarEncerramento({ inicio: '2026-01-01', fim: '2026-06-30' }, '2026-07-31').length).toBe(1);
    expect(validarEncerramento({ inicio: '2026-01-01', fim: null }, '2025-12-31').length).toBe(1);
  });

  it('retenções: pessoa física pelo RPA; empresa pelo enquadramento do fornecedor', () => {
    const enq = [
      {
        tributo: 3,
        regime: 'simples_nacional',
        retem: false,
        aliquotaIss: 2,
        inicio: '2026-01-01',
        fim: null,
      },
    ];
    expect(retencoesDoFavorecido('proprio_profissional', null, [], '2026-11-10').situacao).toBe(
      'pessoa_fisica',
    );
    expect(retencoesDoFavorecido('pessoa_juridica', null, [], '2026-11-10').situacao).toBe('sem_fornecedor');
    expect(retencoesDoFavorecido('cooperativa', 5, [], '2026-11-10').situacao).toBe('sem_enquadramento');
    expect(retencoesDoFavorecido('prestador_terceiro', 5, enq, '2026-11-10')).toEqual({
      situacao: 'enquadrado',
      vigentes: enq,
    });
    expect(donoDaConta('pessoa_juridica')).toBe('fornecedor_da_empresa');
  });
});
