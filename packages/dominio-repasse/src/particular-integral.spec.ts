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
    const r = regraRepasseParticularIntegral({
      fontePagadoraId: 1,
      tipoFonte: 'particular',
      grupoFaturamentoId: 70,
    });
    expect(r.percentual).toBe(100);
    expect(repasseParticularIntegral(300)).toBe(300);
    expect(
      repasseIntegralVale(r, {
        fontePagadoraId: 1,
        fonteParticular: true,
        profissionalId: 5,
        itemFaturavelId: 9,
        grupoFaturamentoId: 70,
      }),
    ).toBe(true);
    expect(
      repasseIntegralVale(r, {
        fontePagadoraId: 2,
        fonteParticular: true,
        profissionalId: 5,
        itemFaturavelId: 9,
        grupoFaturamentoId: 70,
      }),
    ).toBe(false);
  });
  it('exige um alvo só e valor válido', () => {
    expect(() => regraRepasseParticularIntegral({ fontePagadoraId: 1, tipoFonte: 'particular' })).toThrow();
    expect(() =>
      regraRepasseParticularIntegral({
        fontePagadoraId: 1,
        tipoFonte: 'particular',
        itemFaturavelId: 1,
        grupoFaturamentoId: 2,
      }),
    ).toThrow();
    expect(() => repasseParticularIntegral(-1)).toThrow();
    expect(() =>
      regraRepasseParticularIntegral({ fontePagadoraId: 1, tipoFonte: 'operadora', itemFaturavelId: 9 }),
    ).toThrow(/particular/);
    expect(
      repasseIntegralVale(
        regraRepasseParticularIntegral({ fontePagadoraId: 1, tipoFonte: 'particular', itemFaturavelId: 9 }),
        {
          fontePagadoraId: 1,
          fonteParticular: false,
          profissionalId: 5,
          itemFaturavelId: 9,
          grupoFaturamentoId: null,
        },
      ),
    ).toBe(false);
    const r = regraRepasseParticularIntegral({
      fontePagadoraId: 1,
      tipoFonte: 'particular',
      profissionalId: 5,
      itemFaturavelId: 9,
    });
    expect(
      repasseIntegralVale(r, {
        fontePagadoraId: 1,
        fonteParticular: true,
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
    fontesParticulares: new Set([301, 999]),
  };
  const comum = regra({ id: 1, percentual: 50 });

  it('consulta particular marcada: 100% do valor cobrado, antes da regra comum', () => {
    const integral = regraRepasseParticularIntegral({
      fontePagadoraId: 301,
      tipoFonte: 'particular',
      itemFaturavelId: 10101012,
    });
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
      tipoFonte: 'particular',
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
    const integral = regraRepasseParticularIntegral({
      fontePagadoraId: 999,
      tipoFonte: 'particular',
      itemFaturavelId: 10101012,
    });
    const m = calcularItem(item({ cobrado: 200, conciliado: true, pago: 200 }), [comum], {
      ...o,
      integrais: [integral],
    });
    expect(m.regra).toBe(1);
    expect(m.percentual).toBe(50);
  });

  it('num convênio a regra integral não vale: segue a regra comum', () => {
    const integral = regraRepasseParticularIntegral({
      fontePagadoraId: 301,
      tipoFonte: 'particular',
      itemFaturavelId: 10101012,
    });
    // A fonte 301 do item não é particular: nada de 100%.
    const m = calcularItem(item({ cobrado: 200, conciliado: true, pago: 200 }), [comum], {
      ...o,
      fontesParticulares: new Set<number>(),
      integrais: [integral],
    });
    expect(m.regra).toBe(1);
    expect(m.percentual).toBe(50);
    // Uma regra montada à mão com fonte de convênio também não vale.
    const forjada = { ...integral, fonteParticular: false };
    const n = calcularItem(item({ cobrado: 200, conciliado: true, pago: 200 }), [comum], {
      ...o,
      integrais: [forjada],
    });
    expect(n.percentual).toBe(50);
  });
});
