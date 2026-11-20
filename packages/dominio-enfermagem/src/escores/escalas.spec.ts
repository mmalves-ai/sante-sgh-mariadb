// Glasgow, RASS, CAM-ICU e dor (ficha do M45, etapa 2): total pelos itens, faixa pela regra e o gatilho de cada escala.
import { describe, expect, it } from 'vitest';
import { calcularEscala, totalDosItens } from './escalas.js';
import { REGRAS_PADRAO } from './regras.js';

describe('Glasgow', () => {
  it('3 a 15: grave avisa o médico; moderado pede reavaliação; leve sem conduta', () => {
    const g = (ocular: number, verbal: number, motora: number) =>
      calcularEscala('glasgow', { ocular, verbal, motora });
    expect(g(4, 5, 6)).toMatchObject({ ok: true, total: 15, gatilho: 'nenhum' });
    expect(g(3, 4, 5)).toMatchObject({ ok: true, total: 12, gatilho: 'reavaliar' });
    const grave = g(1, 2, 4);
    expect(grave).toMatchObject({ ok: true, total: 7, gatilho: 'avisar-medico' });
    expect(grave.ok && grave.conduta).toMatch(/avisar o médico/);
    expect(g(0, 1, 1)).toMatchObject({ ok: false, codigo: 'valor-nunca-visto' });
  });
});

describe('RASS', () => {
  it('+4 a -5: agitado e sedação profunda são de risco', () => {
    expect(calcularEscala('rass', { rass: 0 })).toMatchObject({ ok: true, total: 0, gatilho: 'nenhum' });
    expect(calcularEscala('rass', { rass: -2 })).toMatchObject({ ok: true, total: -2, gatilho: 'nenhum' });
    expect(calcularEscala('rass', { rass: 3 })).toMatchObject({ ok: true, gatilho: 'avisar-medico' });
    const p = calcularEscala('rass', { rass: -5 });
    expect(p.ok && p.faixa.codigo).toBe('sedacaoProfunda');
    expect(calcularEscala('rass', { rass: 5 })).toMatchObject({ ok: false });
  });
});

describe('CAM-ICU', () => {
  const base = { inicioAgudo: 1, desatencao: 1, consciencia: 0, pensamento: 0 };
  it('delirium = 1 e 2 e (3 ou 4)', () => {
    expect(calcularEscala('camicu', base)).toMatchObject({ ok: true, total: 0, gatilho: 'nenhum' });
    expect(calcularEscala('camicu', { ...base, consciencia: 1 })).toMatchObject({
      ok: true,
      total: 1,
      gatilho: 'avisar-medico',
    });
    expect(calcularEscala('camicu', { ...base, pensamento: 1 })).toMatchObject({ ok: true, total: 1 });
    expect(
      calcularEscala('camicu', { ...base, inicioAgudo: 0, consciencia: 1, pensamento: 1 }),
    ).toMatchObject({ total: 0 });
    expect(calcularEscala('camicu', { ...base, desatencao: 0, consciencia: 1 })).toMatchObject({ total: 0 });
  });
  it('com RASS -4 ou -5 não se avalia', () => {
    expect(calcularEscala('camicu', base, { rassAtual: -4 })).toMatchObject({
      ok: false,
      codigo: 'avaliacao-impossivel',
    });
    expect(calcularEscala('camicu', base, { rassAtual: -3 })).toMatchObject({ ok: true });
    expect(calcularEscala('camicu', base, { rassAtual: null })).toMatchObject({ ok: true });
  });
});

describe('dor', () => {
  it('numérica 0 a 10: moderada e intensa pedem a reavaliação depois da analgesia', () => {
    expect(calcularEscala('dor', { intensidade: 0 })).toMatchObject({ ok: true, gatilho: 'nenhum' });
    expect(calcularEscala('dor', { intensidade: 3 })).toMatchObject({ ok: true, gatilho: 'nenhum' });
    const r = calcularEscala('dor', { intensidade: 8 });
    expect(r).toMatchObject({ ok: true, total: 8, gatilho: 'reavaliar' });
    expect(r.ok && r.conduta).toMatch(/analgesia/);
    expect(calcularEscala('dor', { intensidade: 11 })).toMatchObject({ ok: false });
  });
  it('comportamental (BPS 3 a 12) no paciente sedado: mais de 5 é dor significativa', () => {
    const r = calcularEscala(
      'dor',
      { expressao: 2, membros: 2, ventilacao: 2 },
      { modoDor: 'comportamental' },
    );
    expect(r).toMatchObject({ ok: true, total: 6, gatilho: 'reavaliar' });
    expect(r.ok && r.faixa.codigo).toBe('significativa');
    expect(
      calcularEscala('dor', { expressao: 1, membros: 1, ventilacao: 1 }, { modoDor: 'comportamental' }),
    ).toMatchObject({ ok: true, total: 3, gatilho: 'nenhum' });
  });
  it('total fora das faixas da regra é recusado', () => {
    const regra = {
      ...REGRAS_PADRAO.dor,
      faixas: [{ codigo: 'x', rotulo: 'X', minimo: 0, maximo: 5, risco: false }],
    };
    expect(calcularEscala('dor', { intensidade: 9 }, { regra })).toMatchObject({
      ok: false,
      codigo: 'valor-nunca-visto',
    });
  });
});

describe('total dos itens (regra 3)', () => {
  it('soma só as opções da escala, na ordem dos itens', () => {
    const r = totalDosItens('glasgow', { motora: 6, verbal: 5, ocular: 4 });
    expect(r).toEqual({ ok: true, total: 15, itens: { ocular: 4, verbal: 5, motora: 6 } });
  });
});
