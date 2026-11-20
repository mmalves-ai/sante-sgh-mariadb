// Regra 7 do M24 (dose): faixa por dose, máxima do dia e intervalo mínimo, com os limites exatos.
import { describe, expect, it } from 'vitest';
import { item, produto } from './fabrica.spec-util.js';
import { alertasDose } from './dose.js';

const p = produto({ produto: 1, doseMinima: 10, doseMaxima: 100, doseMaximaDia: 250, periodoMinimoHoras: 6 });

describe('dose', () => {
  it('no limite exato não alerta; acima e abaixo alertam', () => {
    expect(alertasDose(item('i', [{ produto: p, dose: 100 }], { dosesNoPeriodo: 2 }))).toEqual([]);
    expect(alertasDose(item('i', [{ produto: p, dose: 10 }], { dosesNoPeriodo: 2 }))).toEqual([]);
    expect(
      alertasDose(item('i', [{ produto: p, dose: 100.5 }], { dosesNoPeriodo: 2 })).map((x) => x.titulo),
    ).toEqual(['Dose acima da máxima']);
    expect(
      alertasDose(item('i', [{ produto: p, dose: 9.9 }], { dosesNoPeriodo: 2 })).map((x) => x.tipo),
    ).toEqual(['dose-minima']);
  });
  it('máxima do dia pelo número de doses e intervalo abaixo do mínimo', () => {
    const r = alertasDose(item('i', [{ produto: p, dose: 90 }], { dosesNoPeriodo: 3, intervaloHoras: 4 }));
    expect(r.map((x) => x.titulo)).toEqual([
      'Dose do dia acima da máxima',
      'Intervalo menor que o mínimo entre doses',
    ]);
  });
  it('faixa por unidade de prescrição (GEUNIPRESC): a da unidade do item vale antes da faixa única', () => {
    const q = produto({
      produto: 3,
      doseMaxima: 1,
      faixasDose: new Map([
        ['MG', { minima: 5, maxima: 50 }],
        ['G', { minima: null, maxima: 0.05 }],
      ]),
    });
    expect(alertasDose(item('i', [{ produto: q, dose: 40, unidade: 'mg' }]))).toEqual([]);
    expect(alertasDose(item('i', [{ produto: q, dose: 60, unidade: 'MG' }]))[0]?.detalhe).toContain('50');
    expect(alertasDose(item('i', [{ produto: q, dose: 4, unidade: 'MG' }]))[0]?.tipo).toBe('dose-minima');
    expect(alertasDose(item('i', [{ produto: q, dose: 0.1, unidade: 'G' }]))[0]?.tipo).toBe('dose-maxima');
    // Unidade sem faixa: a faixa única do produto.
    expect(alertasDose(item('i', [{ produto: q, dose: 2, unidade: 'ML' }]))[0]?.tipo).toBe('dose-maxima');
  });
  it('sem faixa no cadastro ou sem dose, nenhum alerta', () => {
    expect(alertasDose(item('i', [{ produto: produto({ produto: 2 }), dose: 1e6 }]))).toEqual([]);
    expect(alertasDose(item('i', [{ produto: p, dose: null }]))).toEqual([]);
  });
});
