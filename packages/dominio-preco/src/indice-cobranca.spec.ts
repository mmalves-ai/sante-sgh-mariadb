import { describe, expect, it } from 'vitest';
import {
  passosDaOrigem,
  resolverIndices,
  totalDoHonorario,
  validarRegistroIndice,
} from './indice-cobranca.js';

const m = (o: Record<number, number>) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));

describe('precedência do índice (procedimento > setor > acordo)', () => {
  it('cada chave resolve sozinha e a origem fica dita', () => {
    const r = resolverIndices({
      acordo: m({ 1: 0.5, 4: 21.7, 5: 12 }),
      setor: m({ 1: 0.6 }),
      item: m({ 5: 15 }),
    });
    expect([...r.valores.entries()].sort()).toEqual([
      [1, 0.6],
      [4, 21.7],
      [5, 15],
    ]);
    expect(r.origem.get(1)).toBe('setor');
    expect(r.origem.get(4)).toBe('acordo');
    expect(passosDaOrigem(r)).toEqual([
      'Índice CH do setor executante: 0.6.',
      'Índice UCO do procedimento: 15.',
    ]);
  });

  it('o do procedimento vence o do setor na mesma chave; sem diferenciado, só o acordo', () => {
    expect(
      resolverIndices({ acordo: m({ 1: 0.5 }), setor: m({ 1: 0.6 }), item: m({ 1: 0.7 }) }).valores.get(1),
    ).toBe(0.7);
    const so = resolverIndices({ acordo: m({ 1: 0.5 }) });
    expect(so.origem.get(1)).toBe('acordo');
    expect(passosDaOrigem(so)).toEqual([]);
  });
});

describe('total do item pelo modelo', () => {
  const vig = { ch: 100, co: 7.5, filme: 1.25, anes: 0, outros: 0.5 };

  it('modelo CH: índice × (CH + custo operacional) + filme, vezes a quantidade; nunca a soma da vigência', () => {
    const t = totalDoHonorario({
      item: { ch: 100, cope: 10, filmeM2: 0.5 },
      vigente: vig,
      indices: resolverIndices({ acordo: m({ 1: 0.55, 4: 21.7 }) }),
      porte: null,
      quantidade: 2,
    });
    expect(t).toMatchObject({ modelo: 'CH', origem: 'indice', falta: [] });
    expect(t.total).toBe(Math.round((0.55 * 110 + 21.7 * 0.5) * 2 * 100) / 100);
  });

  it('modelo PORTE com porte anestésico do acordo (comum e em horário especial)', () => {
    const base = {
      item: { ch: 0, porte: '3A', cope: 2, filmeM2: 0, porteAnestesico: '1' },
      vigente: null,
      indices: resolverIndices({ acordo: m({ 5: 12 }) }),
      porte: 210,
      porteAnestesico: { valor: 150.5, valorHorarioEspecial: 195.65 },
    };
    expect(totalDoHonorario(base)).toMatchObject({ modelo: 'PORTE', origem: 'indice', total: 384.5 });
    const he = totalDoHonorario({ ...base, horarioEspecial: true });
    expect(he.total).toBe(429.65);
    expect(he.passos.join(' ')).toMatch(/horário especial/);
  });

  it('falta o índice ou o porte anestésico: total nulo e a falta dita (nunca a vigência em silêncio)', () => {
    const semCh = totalDoHonorario({
      item: { ch: 100 },
      vigente: vig,
      indices: resolverIndices({ acordo: m({}) }),
      porte: null,
    });
    expect(semCh).toMatchObject({ total: null, origem: null, falta: ['valor do CH do convênio na data'] });
    const semPa = totalDoHonorario({
      item: { ch: 0, porte: '3A', porteAnestesico: '2' },
      vigente: null,
      indices: resolverIndices({ acordo: m({}) }),
      porte: 210,
      porteAnestesico: null,
    });
    expect(semPa.total).toBeNull();
    expect(semPa.falta).toEqual(['valor do porte anestésico 2 do acordo na data']);
  });

  it('modelo VALOR: soma dos componentes da vigência × quantidade; sem vigência, nulo', () => {
    const v = totalDoHonorario({
      item: { ch: 0 },
      vigente: vig,
      indices: resolverIndices({ acordo: m({}) }),
      porte: null,
      quantidade: 3,
    });
    expect(v).toMatchObject({ modelo: 'VALOR', origem: 'vigencia', total: 327.75 });
    expect(
      totalDoHonorario({
        item: { ch: 0 },
        vigente: null,
        indices: resolverIndices({ acordo: m({}) }),
        porte: null,
      }),
    ).toMatchObject({ total: null, origem: null });
  });
});

describe('registro do valor do índice ou do porte por vigência', () => {
  const ok = {
    tipo: 'indice' as const,
    vigenciaInicio: '2026-07-01',
    valor: 0.123456,
    vigenciasExistentes: ['2026-03-01'],
  };

  it('aceita a vigência nova', () => {
    expect(validarRegistroIndice(ok)).toEqual({});
    expect(
      validarRegistroIndice({ ...ok, tipo: 'porte-anestesico', valor: 150.5, valorHorarioEspecial: 195.65 }),
    ).toEqual({});
  });

  it('recusa a mesma data de início (a mudança é sempre vigência nova), data inválida e valor negativo', () => {
    expect(validarRegistroIndice({ ...ok, vigenciaInicio: '2026-03-01' })).toHaveProperty('vigenciaInicio');
    expect(validarRegistroIndice({ ...ok, vigenciaInicio: '01/07/2026' })).toHaveProperty('vigenciaInicio');
    expect(validarRegistroIndice({ ...ok, valor: -1 })).toHaveProperty('valor');
    expect(validarRegistroIndice({ ...ok, tipo: 'x' as never })).toHaveProperty('tipo');
  });

  it('casas decimais pelo tipo e horário especial só do porte anestésico, nunca abaixo do comum', () => {
    expect(validarRegistroIndice({ ...ok, valor: 0.1234567 })).toHaveProperty('valor');
    expect(validarRegistroIndice({ ...ok, tipo: 'porte', valor: 10.123 })).toHaveProperty('valor');
    expect(validarRegistroIndice({ ...ok, valorHorarioEspecial: 1 })).toHaveProperty('valorHorarioEspecial');
    expect(
      validarRegistroIndice({ ...ok, tipo: 'porte-anestesico', valor: 100, valorHorarioEspecial: 90 }),
    ).toHaveProperty('valorHorarioEspecial');
    expect(
      validarRegistroIndice({ ...ok, tipo: 'porte-anestesico', valor: 100, valorHorarioEspecial: -1 }),
    ).toHaveProperty('valorHorarioEspecial');
  });
});
