import { describe, expect, it } from 'vitest';
import { item, regra } from './fixtures.spec-util.js';
import {
  calcularItem,
  regraRepasseParticularIntegral,
  repasseIntegralVale,
  repasseParticularIntegral,
} from './index.js';

describe('repasse "consulta particular integral ao médico" (ADR 0009)', () => {
  it('vira regra de repasse 100% sobre o valor cobrado', () => {
    const r = regraRepasseParticularIntegral({ fontePagadoraId: 1, grupoFaturamentoId: 70 });
    expect(r.percentual).toBe(100);
    expect(repasseParticularIntegral(300)).toBe(300);
    expect(
      repasseIntegralVale(r, {
        fontePagadoraId: 1,
        profissionalId: 5,
        itemFaturavelId: 9,
        grupoFaturamentoId: 70,
      }),
    ).toBe(true);
    expect(
      repasseIntegralVale(r, {
        fontePagadoraId: 2,
        profissionalId: 5,
        itemFaturavelId: 9,
        grupoFaturamentoId: 70,
      }),
    ).toBe(false);
  });
  it('exige um alvo só e valor válido', () => {
    expect(() => regraRepasseParticularIntegral({ fontePagadoraId: 1 })).toThrow();
    expect(() =>
      regraRepasseParticularIntegral({ fontePagadoraId: 1, itemFaturavelId: 1, grupoFaturamentoId: 2 }),
    ).toThrow();
    expect(() => repasseParticularIntegral(-1)).toThrow();
    const r = regraRepasseParticularIntegral({ fontePagadoraId: 1, profissionalId: 5, itemFaturavelId: 9 });
    expect(
      repasseIntegralVale(r, {
        fontePagadoraId: 1,
        profissionalId: 6,
        itemFaturavelId: 9,
        grupoFaturamentoId: null,
      }),
    ).toBe(false);
  });
});

describe('cálculo do repasse com a regra integral (ADR 0009, repasseIntegralVale no motor)', () => {
  const o = {
    basePadrao: 'recebido' as const,
    modoAdicional: 'sobre-valor' as const,
    feriados: new Set<string>(),
  };
  const comum = regra({ id: 1, percentual: 50 });

  it('consulta particular marcada: 100% do valor cobrado, antes da regra comum', () => {
    const integral = regraRepasseParticularIntegral({ fontePagadoraId: 301, itemFaturavelId: 10101012 });
    const m = calcularItem(item({ cobrado: 250, pago: 0 }), [comum], { ...o, integrais: [integral] });
    expect(m.valorCentavos).toBe(25_000);
    expect(m.percentual).toBe(100);
    expect(m.origemBase).toBe('cobrado');
    expect(m.regra).toBeNull();
    expect(m.pendencia).toBeNull();
  });

  it('pelo grupo do procedimento e só para o médico da regra', () => {
    const integral = regraRepasseParticularIntegral({
      fontePagadoraId: 301,
      profissionalId: 77,
      grupoFaturamentoId: 70,
    });
    const grupos = new Map([[10101012, 70]]);
    const doMedico = calcularItem(item({ cobrado: 180 }), [comum], {
      ...o,
      integrais: [integral],
      grupoDoProcedimento: grupos,
    });
    expect(doMedico.valorCentavos).toBe(18_000);
    expect(doMedico.dimensoes).toContain('profissional');
    const outro = calcularItem(item({ cobrado: 180, executante: 78, conciliado: true, pago: 180 }), [comum], {
      ...o,
      integrais: [integral],
      grupoDoProcedimento: grupos,
    });
    expect(outro.regra).toBe(1);
    expect(outro.percentual).toBe(50);
  });

  it('outra fonte segue a regra comum', () => {
    const integral = regraRepasseParticularIntegral({ fontePagadoraId: 999, itemFaturavelId: 10101012 });
    const m = calcularItem(item({ cobrado: 200, conciliado: true, pago: 200 }), [comum], {
      ...o,
      integrais: [integral],
    });
    expect(m.regra).toBe(1);
    expect(m.percentual).toBe(50);
  });
});
