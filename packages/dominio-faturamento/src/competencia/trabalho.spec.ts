import { describe, expect, it } from 'vitest';
import { competenciaPadrao, conferirCompetenciaTrabalho } from './trabalho.js';

const base = { modulo: 'fonte_pagadora', competencia: '2026-10', hoje: '2026-11-25' };

describe('competência de trabalho do faturista', () => {
  it('aceita o mês corrente, o anterior e um período dentro do mês', () => {
    expect(conferirCompetenciaTrabalho(base)).toBeNull();
    expect(conferirCompetenciaTrabalho({ ...base, competencia: '2026-11' })).toBeNull();
    expect(
      conferirCompetenciaTrabalho({ ...base, periodoInicio: '2026-10-01', periodoFim: '2026-10-15' }),
    ).toBeNull();
    expect(conferirCompetenciaTrabalho({ ...base, periodoInicio: '', periodoFim: null })).toBeNull();
  });

  it('recusa módulo desconhecido e competência mal formada', () => {
    expect(conferirCompetenciaTrabalho({ ...base, modulo: 'farmacia' })?.codigo).toBe('modulo-invalido');
    expect(conferirCompetenciaTrabalho({ ...base, competencia: '2026-13' })?.codigo).toBe(
      'competencia-invalida',
    );
    expect(conferirCompetenciaTrabalho({ ...base, competencia: '10/2026' })?.campos).toEqual(['competencia']);
  });

  it('recusa competência futura e anterior a 5 anos', () => {
    expect(conferirCompetenciaTrabalho({ ...base, competencia: '2026-12' })?.codigo).toBe(
      'competencia-futura',
    );
    expect(conferirCompetenciaTrabalho({ ...base, competencia: '2021-11' })).toBeNull();
    expect(conferirCompetenciaTrabalho({ ...base, competencia: '2021-10' })?.codigo).toBe(
      'competencia-antiga',
    );
  });

  it('recusa período fora do mês, data inexistente e período invertido', () => {
    expect(conferirCompetenciaTrabalho({ ...base, periodoInicio: '2026-11-01' })?.codigo).toBe(
      'periodo-fora-da-competencia',
    );
    expect(conferirCompetenciaTrabalho({ ...base, periodoFim: '2026-10-32' })?.campos).toEqual([
      'periodoFim',
    ]);
    expect(
      conferirCompetenciaTrabalho({ ...base, periodoInicio: '2026-10-20', periodoFim: '2026-10-10' })?.codigo,
    ).toBe('periodo-invertido');
  });

  it('o padrão dos filtros é a de trabalho; sem ela, o mês corrente', () => {
    expect(competenciaPadrao('2026-09', '2026-11-25')).toBe('2026-09');
    expect(competenciaPadrao(null, '2026-11-25')).toBe('2026-11');
    expect(competenciaPadrao('lixo', '2026-11-25')).toBe('2026-11');
  });
});
