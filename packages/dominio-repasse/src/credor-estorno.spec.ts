// Regra 8 do M33 (credor do título e documento) e o estorno por glosa ("Estorno não apaga").
import { describe, expect, it } from 'vitest';
import { destinoDoRepasse, lancamentosLivres } from './credor.js';
import { estornoPorGlosa, type PedidoEstorno } from './estorno.js';

describe('destinoDoRepasse', () => {
  it('médico com vínculo: título M e RPA; sem vínculo: recusa', () => {
    expect(destinoDoRepasse('M', 10)).toEqual({ ok: true, credor: 'M', documento: 'rpa' });
    expect(destinoDoRepasse('M', null).ok).toBe(false);
    expect(destinoDoRepasse('M', 0).ok).toBe(false);
  });

  it('empresa médica e cooperativa: título E com demonstrativo; os demais tipos são recusados', () => {
    expect(destinoDoRepasse('E', null)).toEqual({ ok: true, credor: 'E', documento: 'demonstrativo' });
    expect(destinoDoRepasse('cooperativa', null)).toEqual({
      ok: true,
      credor: 'E',
      documento: 'demonstrativo',
    });
    for (const t of ['F', 'P', 'V', 'I'] as const) expect(destinoDoRepasse(t, 10).ok).toBe(false);
  });

  it('lançamento já em RPA não entra em outro', () => {
    expect(lancamentosLivres([1, 2], new Set([3]))).toEqual({ ok: true });
    expect(lancamentosLivres([1, 2, 3], new Set([2, 3]))).toEqual({ ok: false, emRpa: [2, 3] });
  });
});

describe('estornoPorGlosa', () => {
  const p: PedidoEstorno = {
    competenciaOriginal: '2026-12',
    repassadoCentavos: 3700,
    baseCentavos: 20000,
    glosaMantidaCentavos: 5000,
    jaEstornadoCentavos: 0,
  };

  it('glosa de 50,00 em 200,00 estorna 25% de 37,00 = −9,25 no período seguinte', () => {
    expect(estornoPorGlosa(p, true)).toEqual({ ok: true, valorCentavos: -925, competencia: '2027-01' });
  });

  it('nunca passa do repassado: glosa maior que a base estorna tudo; o já estornado desconta', () => {
    expect(estornoPorGlosa({ ...p, glosaMantidaCentavos: 99999 }, true)).toMatchObject({
      valorCentavos: -3700,
    });
    expect(
      estornoPorGlosa({ ...p, glosaMantidaCentavos: 20000, jaEstornadoCentavos: 925 }, true),
    ).toMatchObject({
      valorCentavos: -2775,
    });
    expect(estornoPorGlosa({ ...p, jaEstornadoCentavos: 3700 }, true)).toEqual({
      ok: false,
      motivo: 'ja-estornado',
    });
  });

  it('desligado pelo parâmetro ou sem glosa: nada', () => {
    expect(estornoPorGlosa(p, false)).toEqual({ ok: false, motivo: 'desligado' });
    expect(estornoPorGlosa({ ...p, glosaMantidaCentavos: 0 }, true)).toEqual({
      ok: false,
      motivo: 'sem-glosa',
    });
  });
});
