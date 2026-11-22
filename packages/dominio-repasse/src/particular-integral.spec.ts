import { describe, expect, it } from 'vitest';
import { regraRepasseParticularIntegral, repasseIntegralVale, repasseParticularIntegral } from './index.js';

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
