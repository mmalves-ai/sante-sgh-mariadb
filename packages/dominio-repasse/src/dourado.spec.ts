// Regra 2 do M33: comparador do teste dourado (o teste na cópia é tools/assinatura/dourado/repasse.spec.ts, do
// construtor); aqui, a classificação por causa e a meta, com dados sintéticos.
import { describe, expect, it } from 'vitest';
import { calcularItem, type MemoriaCalculo, type OpcoesCalculo } from './calculo.js';
import { causaDivergencia, compararDourado, type LinhaGravada } from './dourado.js';
import { item, regra } from './fixtures.spec-util.js';

const o: OpcoesCalculo = {
  basePadrao: 'cobrado',
  modoAdicional: 'sobre-valor',
  feriados: new Set(['2026-10-12']),
};
const g = (p: Partial<LinhaGravada> = {}): LinhaGravada => ({
  item: 1,
  regra: 1,
  percentual: 50,
  valorCentavos: 10000,
  ...p,
});
const m = (p: Partial<Parameters<typeof item>[0]> = {}, r = regra({ id: 1 })): MemoriaCalculo =>
  calcularItem(item(p), [r], o);

describe('causaDivergencia', () => {
  it('mesmo valor é igual, mesmo com regra diferente', () => {
    expect(causaDivergencia(g(), m())).toBeNull();
    expect(causaDivergencia(g({ regra: 2 }), m())).toBeNull();
  });

  it('classifica cada causa', () => {
    expect(causaDivergencia(g(), undefined)).toBe('sem-regra-no-novo');
    expect(causaDivergencia(g(), m({}, regra({ id: 1, convenio: 9 })))).toBe('sem-regra-no-novo');
    expect(causaDivergencia(g(), m({ executante: null }))).toBe('item-sem-base');
    expect(causaDivergencia(g({ regra: null, valorCentavos: 1 }), m())).toBe('sem-regra-no-legado');
    expect(causaDivergencia(g({ regra: 2, valorCentavos: 1 }), m())).toBe('regra-diferente');
    expect(causaDivergencia(g(), m({ data: '2026-10-12' }, regra({ id: 1, percentualFeriado: 10 })))).toBe(
      'adicional',
    );
    expect(causaDivergencia(g(), m({}, regra({ id: 1, percentual: 0, valorFixo: 90 })))).toBe('valor-fixo');
    expect(causaDivergencia(g({ percentual: 40 }), m({}, regra({ id: 1, percentual: 45 })))).toBe(
      'percentual-diferente',
    );
    expect(causaDivergencia(g({ valorCentavos: 10001 }), m())).toBe('arredondamento');
    expect(causaDivergencia(g({ valorCentavos: 12000 }), m())).toBe('base-diferente');
  });
});

describe('compararDourado', () => {
  it('3 de 4 iguais = 75%: abaixo da meta de 97%, com as somas e os exemplos por causa', () => {
    const gs = [g({ item: 1 }), g({ item: 2 }), g({ item: 3 }), g({ item: 4, valorCentavos: 12000 })];
    const ms = [m({ id: 1 }), m({ id: 2 }), m({ id: 3 }), m({ id: 4 })];
    const r = compararDourado(gs, ms, 97);
    expect(r).toMatchObject({
      total: 4,
      iguais: 3,
      acertoPct: 75,
      atingeMeta: false,
      gravadoCentavos: 42000,
      recalculadoCentavos: 40000,
    });
    expect(r.porCausa).toEqual({ 'base-diferente': 1 });
    expect(r.exemplos).toEqual({ 'base-diferente': [4] });
    expect(compararDourado(gs.slice(0, 3), ms, 97).atingeMeta).toBe(true);
  });

  it('sem linhas: 0% e não atinge; item pendente não soma no recalculado; até 20 exemplos', () => {
    expect(compararDourado([], [], 97)).toMatchObject({ total: 0, acertoPct: 0, atingeMeta: false });
    const gs = Array.from({ length: 25 }, (_, i) => g({ item: i + 1 }));
    const ms = gs.map((x) => m({ id: x.item, executante: null }));
    const r = compararDourado(gs, ms, 97);
    expect(r.recalculadoCentavos).toBe(0);
    expect(r.porCausa['item-sem-base']).toBe(25);
    expect(r.exemplos['item-sem-base']).toHaveLength(20);
  });
});
