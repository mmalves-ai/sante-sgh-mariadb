import { describe, expect, it } from 'vitest';
import { alertasExperiencia, dataMarcoExperiencia } from './experiencia.js';

describe('alerta do período de experiência (CLT arts. 445 e 451)', () => {
  it('o marco conta a admissão como o 1º dia', () => {
    expect(dataMarcoExperiencia('2026-10-01', 45)).toBe('2026-11-14');
    expect(dataMarcoExperiencia('2026-10-01', 90)).toBe('2026-12-29');
  });

  it('alerta a 10 dias, no dia e depois do 45 sem avaliação; nada antes da antecedência', () => {
    expect(alertasExperiencia('2026-10-01', '2026-11-03')).toEqual([]);
    expect(alertasExperiencia('2026-10-01', '2026-11-04')).toEqual([
      { marco: 45, data: '2026-11-14', dias: 10, situacao: 'proximo' },
    ]);
    expect(alertasExperiencia('2026-10-01', '2026-11-14')[0]!.situacao).toBe('hoje');
    expect(alertasExperiencia('2026-10-01', '2026-11-20')[0]).toMatchObject({
      marco: 45,
      dias: -6,
      situacao: 'vencido',
    });
  });

  it('a avaliação do marco apaga o alerta; perto do 90 aparecem os dois se o 45 não foi avaliado', () => {
    expect(alertasExperiencia('2026-10-01', '2026-11-20', [45])).toEqual([]);
    expect(alertasExperiencia('2026-10-01', '2026-12-20').map((a) => a.marco)).toEqual([45, 90]);
    expect(alertasExperiencia('2026-10-01', '2026-12-20', [45]).map((a) => a.marco)).toEqual([90]);
  });

  it('depois do 90º dia o 45 deixa de alertar; o 90 sem avaliação segue vencido', () => {
    expect(alertasExperiencia('2026-10-01', '2027-01-05')).toEqual([
      { marco: 90, data: '2026-12-29', dias: -7, situacao: 'vencido' },
    ]);
    expect(alertasExperiencia('2026-10-01', '2027-01-05', [90])).toEqual([]);
  });

  it('antecedência configurável', () => {
    expect(alertasExperiencia('2026-10-01', '2026-10-30', [], 15)).toHaveLength(1);
    expect(alertasExperiencia('2026-10-01', '2026-10-30', [], 10)).toHaveLength(0);
  });
});
