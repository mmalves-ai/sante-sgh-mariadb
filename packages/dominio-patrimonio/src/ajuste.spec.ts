// W0-08, parte 7 (M1; CPC 27 itens 51 e 61, CPC 23 item 32, CPC 01): revisão de estimativa e impairment prospectivos,
// reavaliação como evento e o estorno do ajuste. Testes de cálculo com bens sintéticos, com as parcelas à vista.
import type { RegistrarAjusteBem } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  type BemParaAjuste,
  impedimentoDoEstornoAjuste,
  planejarAjuste,
  type SituacaoParaAjuste,
  valorContabil,
  vidaRestante,
} from './ajuste.js';
import { type BemParaDepreciar, cotaDoMes } from './depreciacao.js';
import { mesSeguinte } from './origem.js';

const P = { aplicarCoeficiente: true, considerarResidual: true };

/** 12.000,00 em 120 meses desde 2026-01: 100,00 por mês. */
const bemDep = (extra: Partial<BemParaDepreciar> = {}): BemParaDepreciar => ({
  id: 1,
  plaqueta: 'PC000001',
  descricao: 'Monitor',
  grupo: 'equipamentoMedico',
  centro: 10,
  valorCent: 12_000_00,
  residualCent: 0,
  vidaUtilMeses: 120,
  coeficiente: null,
  inicioDepreciacao: '2026-01',
  depreciavel: true,
  situacao: 'ativo',
  baixadoEm: null,
  acumuladaCent: 0,
  temCotaNaCompetencia: false,
  ...extra,
});

/** Calcula as cotas em sequência de `de` até `ate`, acumulando; devolve as cotas por competência. */
function cotas(
  b: BemParaDepreciar,
  de: string,
  ate: string,
): { cotas: Map<string, number>; acumulada: number } {
  const r = new Map<string, number>();
  let acc = b.acumuladaCent;
  for (let c = de; c <= ate; c = mesSeguinte(c)) {
    const x = cotaDoMes({ ...b, acumuladaCent: acc }, c, P);
    const v = 'cota' in x ? x.cota.valorCent : 0;
    r.set(c, v);
    acc += v;
  }
  return { cotas: r, acumulada: acc };
}

const paraAjuste = (b: BemParaDepreciar): BemParaAjuste => ({
  valorCent: b.valorCent,
  residualCent: b.residualCent,
  vidaUtilMeses: b.vidaUtilMeses,
  coeficiente: b.coeficiente,
  inicioDepreciacao: b.inicioDepreciacao,
  depreciavel: b.depreciavel,
  situacao: b.situacao,
  acumuladaCent: b.acumuladaCent,
  marco: b.marco ?? null,
});

const sit = (b: BemParaAjuste, extra: Partial<SituacaoParaAjuste> = {}): SituacaoParaAjuste => ({
  bem: b,
  ultimaCalculada: '2026-12',
  hoje: '2027-01-15',
  contasConfiguradas: true,
  lotesExportados: [],
  ...extra,
});

const base = { bem: 1, versao: 3, motivo: 'Laudo técnico de 2027' };

describe('W0-08 M1: impairment (CPC 01) prospectivo', () => {
  // 12 cotas de 100,00 em 2026: acumulada 1.200,00, valor contábil 10.800,00; recuperável do laudo 5.400,00.
  const antes = cotas(bemDep(), '2026-01', '2026-12');
  const b = bemDep({ acumuladaCent: antes.acumulada });

  it('a perda é o valor contábil menos o recuperável; a base nova é o recuperável', () => {
    expect(antes.acumulada).toBe(12 * 100_00);
    const e: RegistrarAjusteBem = { ...base, tipo: 'impairment', recuperavelCent: 5_400_00, laudo: 77 };
    const r = planejarAjuste(e, sit(paraAjuste(b)));
    if (!('ajuste' in r)) throw new Error(r.impedimento.detalhe);
    const a = r.ajuste;
    expect(a.valorContabilAntesCent).toBe(12_000_00 - 1_200_00); // 10.800,00
    expect(a.perdaCent).toBe(10_800_00 - 5_400_00); // 5.400,00
    expect(a.valorContabilDepoisCent).toBe(5_400_00);
    expect(a.competenciaMarco).toBe('2026-12');
    expect(a.vidaRestanteMeses).toBe(120 - 12); // 108
    expect(a.laudo).toBe(77);
    expect(a.marco).toEqual({
      competencia: '2026-12',
      acumuladaCent: 1_200_00,
      baseCent: 5_400_00,
      residualCent: 0,
      vidaRestanteMeses: 108,
    });
  });

  it('as cotas já calculadas não mudam e a futura cai para 5.400,00 ÷ 108 = 50,00; o total fecha no recuperável', () => {
    const r = planejarAjuste(
      { ...base, tipo: 'impairment', recuperavelCent: 5_400_00, laudo: 77 },
      sit(paraAjuste(b)),
    );
    if (!('ajuste' in r)) throw new Error('sem ajuste');
    const comMarco = bemDep({ acumuladaCent: antes.acumulada, marco: r.ajuste.marco });
    // As de 2026 são as mesmas (recalcular 2026 com o bem antes do ajuste dá o mesmo: o ajuste não as toca).
    expect([...cotas(bemDep(), '2026-01', '2026-12').cotas.values()]).toEqual(Array(12).fill(100_00));
    const depois = cotas(comMarco, '2027-01', '2035-12');
    expect(depois.cotas.get('2027-01')).toBe(50_00);
    // 108 meses × 50,00 = 5.400,00: a soma das cotas depois do marco é a base nova, e a acumulada total é
    // 1.200,00 (antes) + 5.400,00 (depois) = 6.600,00 = 12.000,00 − 5.400,00 de perda.
    const somaDepois = [...depois.cotas.values()].reduce((s, v) => s + v, 0);
    expect(somaDepois).toBe(5_400_00);
    expect(depois.acumulada).toBe(1_200_00 + 5_400_00);
    expect(depois.cotas.get('2035-12')).toBe(50_00); // 2027-01 + 107 meses = 2035-12, a última
    expect(cotaDoMes({ ...comMarco, acumuladaCent: depois.acumulada }, '2036-01', P)).toEqual({
      semCota: 'depreciado',
    });
  });

  it('recusa: sem conta configurada (aviso), sem perda, lote exportado, bem baixado', () => {
    const e: RegistrarAjusteBem = { ...base, tipo: 'impairment', recuperavelCent: 5_400_00, laudo: 77 };
    const cod = (s: SituacaoParaAjuste, x: RegistrarAjusteBem = e) => {
      const r = planejarAjuste(x, s);
      return 'impedimento' in r ? r.impedimento.codigo : null;
    };
    expect(cod(sit(paraAjuste(b), { contasConfiguradas: false }))).toBe('sem-conta');
    expect(cod(sit(paraAjuste(b)), { ...e, recuperavelCent: 10_800_00 })).toBe('sem-perda');
    expect(cod(sit(paraAjuste(b), { lotesExportados: [{ periodo: '2027-01' }] }))).toBe('lote-exportado');
    expect(cod(sit({ ...paraAjuste(b), situacao: 'baixado' }))).toBe('bem-baixado');
    expect(cod(sit({ ...paraAjuste(b), depreciavel: false }))).toBe('nao-depreciavel');
  });
});

describe('W0-08 M1: revisão de vida útil e residual (CPC 23 item 32; CPC 27 item 51) prospectiva', () => {
  const antes = cotas(bemDep(), '2026-01', '2026-12');
  const b = bemDep({ acumuladaCent: antes.acumulada });

  it('nova vida restante de 48 meses e residual de 1.200,00: cota (10.800,00 − 1.200,00) ÷ 48 = 200,00', () => {
    const r = planejarAjuste(
      { ...base, tipo: 'revisao-estimativa', vidaRestanteMeses: 48, residualCent: 1_200_00, laudo: null },
      sit(paraAjuste(b)),
    );
    if (!('ajuste' in r)) throw new Error('sem ajuste');
    expect(r.ajuste.perdaCent).toBe(0);
    expect(r.ajuste.valorContabilDepoisCent).toBe(10_800_00);
    const comMarco = bemDep({ acumuladaCent: antes.acumulada, marco: r.ajuste.marco });
    const depois = cotas(comMarco, '2027-01', '2031-12');
    expect(depois.cotas.get('2027-01')).toBe(200_00);
    const soma = [...depois.cotas.values()].reduce((s, v) => s + v, 0);
    expect(soma).toBe(10_800_00 - 1_200_00); // 9.600,00 = 48 × 200,00
    expect(depois.cotas.get('2030-12')).toBe(200_00); // a 48ª
    expect(depois.cotas.get('2031-01')).toBe(0); // depreciado até o residual
    expect(
      valorContabil({ valorCent: 12_000_00, acumuladaCent: depois.acumulada, marco: r.ajuste.marco }),
    ).toBe(1_200_00);
  });

  it('o residual acima do valor contábil é recusado', () => {
    const r = planejarAjuste(
      { ...base, tipo: 'revisao-estimativa', vidaRestanteMeses: 48, residualCent: 10_800_01, laudo: null },
      sit(paraAjuste(b)),
    );
    expect('impedimento' in r && r.impedimento.codigo).toBe('residual-maior');
  });

  it('dois ajustes: o impairment sobre uma revisão parte do marco da revisão (vida restante descontada)', () => {
    const rev = planejarAjuste(
      { ...base, tipo: 'revisao-estimativa', vidaRestanteMeses: 48, residualCent: 0, laudo: null },
      sit(paraAjuste(b)),
    );
    if (!('ajuste' in rev)) throw new Error('sem revisão');
    const marco = rev.ajuste.marco;
    const seis = cotas(bemDep({ acumuladaCent: antes.acumulada, marco }), '2027-01', '2027-06');
    expect([...seis.cotas.values()]).toEqual(Array(6).fill(225_00)); // 10.800,00 ÷ 48
    const b2 = paraAjuste(bemDep({ acumuladaCent: seis.acumulada, marco }));
    expect(valorContabil(b2)).toBe(10_800_00 - 6 * 225_00); // 9.450,00
    expect(vidaRestante(b2, '2027-06')).toBe(42);
    const imp = planejarAjuste(
      { ...base, tipo: 'impairment', recuperavelCent: 4_200_00, laudo: 9 },
      sit(b2, { ultimaCalculada: '2027-06', hoje: '2027-07-02' }),
    );
    if (!('ajuste' in imp)) throw new Error('sem impairment');
    expect(imp.ajuste.perdaCent).toBe(9_450_00 - 4_200_00);
    expect(imp.ajuste.vidaRestanteMeses).toBe(42);
    const x = cotaDoMes(bemDep({ acumuladaCent: seis.acumulada, marco: imp.ajuste.marco }), '2027-07', P);
    expect('cota' in x && x.cota.valorCent).toBe(100_00); // 4.200,00 ÷ 42
  });
});

describe('W0-08 M1: reavaliação é evento, sem lançamento nem marco', () => {
  it('o valor contábil e a depreciação seguem; só fica registrado o valor justo e o laudo', () => {
    const b = bemDep({ acumuladaCent: 1_200_00 });
    const r = planejarAjuste(
      { ...base, tipo: 'reavaliacao', valorJustoCent: 20_000_00, laudo: 5 },
      sit(paraAjuste(b), { contasConfiguradas: false, lotesExportados: [{ periodo: '2027-01' }] }),
    );
    if (!('ajuste' in r)) throw new Error('sem reavaliação');
    expect(r.ajuste.marco).toBeNull();
    expect(r.ajuste.perdaCent).toBe(0);
    expect(r.ajuste.valorJustoCent).toBe(20_000_00);
    expect(r.ajuste.valorContabilDepoisCent).toBe(r.ajuste.valorContabilAntesCent);
  });
});

describe('W0-08 M1: estorno do ajuste (mesmo caminho do estorno da depreciação)', () => {
  const aj = {
    id: 10,
    tipo: 'impairment' as const,
    competenciaMarco: '2026-12',
    data: '2027-01-15',
    estornado: false,
  };
  const s = { ajuste: aj, ultimoComMarco: { id: 10 }, cotasPosteriores: [], lotesExportados: [] };

  it('o último ajuste sem cota depois dele estorna; o marco volta ao anterior e a cota volta à original', () => {
    expect(impedimentoDoEstornoAjuste(s)).toBeNull();
    // Sem o marco (estornado), o bem volta à conta original: 100,00 em 2027-01.
    const x = cotaDoMes(bemDep({ acumuladaCent: 1_200_00, marco: null }), '2027-01', P);
    expect('cota' in x && x.cota.valorCent).toBe(100_00);
  });

  it('recusas: não é o último, há cota calculada depois (estorne a depreciação antes), lote exportado, já estornado', () => {
    expect(impedimentoDoEstornoAjuste({ ...s, ultimoComMarco: { id: 11 } })?.codigo).toBe('nao-e-o-ultimo');
    expect(impedimentoDoEstornoAjuste({ ...s, cotasPosteriores: ['2027-01'] })?.codigo).toBe(
      'cota-posterior',
    );
    expect(impedimentoDoEstornoAjuste({ ...s, lotesExportados: [{ periodo: '2027-01' }] })?.codigo).toBe(
      'lote-exportado',
    );
    expect(impedimentoDoEstornoAjuste({ ...s, ajuste: { ...aj, estornado: true } })?.codigo).toBe(
      'ja-estornado',
    );
    expect(
      impedimentoDoEstornoAjuste({
        ...s,
        ajuste: { ...aj, tipo: 'reavaliacao' },
        ultimoComMarco: { id: 11 },
      }),
    ).toBeNull();
  });
});
