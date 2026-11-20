import type { BaseMensal, GrandezaBase } from '@sgh/contratos';
import { GRANDEZAS_BASE, GRUPOS_MOTIVO_ALTA } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  arredondar,
  metaDoTexto,
  planilhaDaSerie,
  serieDe,
  situacaoDaMeta,
  ultimoFechado,
  valorDe,
} from './calculo.js';
import { fichaDe } from './fichas.js';

export function base(periodo: string, g: Partial<Record<GrandezaBase, number>>, parcial = false): BaseMensal {
  return {
    periodo,
    parcial,
    grandezas: {
      ...(Object.fromEntries(GRANDEZAS_BASE.map((x) => [x, 0])) as Record<GrandezaBase, number>),
      ...g,
    },
    altasPorGrupo: Object.fromEntries(GRUPOS_MOTIVO_ALTA.map((x) => [x, 0])) as BaseMensal['altasPorGrupo'],
  };
}

describe('cálculo com numerador e denominador', () => {
  const ocup = fichaDe('taxaOcupacao')!;
  it('percentual com duas casas; sem denominador, sem valor', () => {
    expect(valorDe(ocup, base('2026-01', { pacientesDia: 1723, leitosDia: 3366 }))).toEqual({
      periodo: '2026-01',
      numerador: 1723,
      denominador: 3366,
      valor: 51.19,
      parcial: false,
    });
    expect(valorDe(ocup, base('2026-01', {})).valor).toBeNull();
  });

  it('contagem: o valor é o numerador', () => {
    expect(valorDe(fichaDe('admissoes')!, base('2026-01', { admissoes: 152 }))).toMatchObject({
      valor: 152,
      denominador: null,
    });
  });

  it('meta pela polaridade; meta em texto do parâmetro', () => {
    expect(metaDoTexto('85,5')).toBe(85.5);
    expect(metaDoTexto(' 90 ')).toBe(90);
    expect(metaDoTexto('sem meta')).toBeNull();
    expect(metaDoTexto(undefined)).toBeNull();
    expect(situacaoDaMeta(ocup, 85, 86)).toBe('na-meta');
    expect(situacaoDaMeta(ocup, 85, 80)).toBe('fora-da-meta');
    const mort = fichaDe('taxaMortalidadeGeral')!;
    expect(situacaoDaMeta(mort, 4, 3)).toBe('na-meta');
    expect(situacaoDaMeta(mort, 4, 5)).toBe('fora-da-meta');
    expect(situacaoDaMeta(fichaDe('admissoes')!, 4, 5)).toBe('sem-meta');
    expect(situacaoDaMeta(ocup, null, 5)).toBe('sem-meta');
    expect(situacaoDaMeta(ocup, 5, null)).toBe('sem-valor');
  });

  it('último mês fechado; planilha com numerador, denominador e parcial', () => {
    const s = serieDe(ocup, [
      base('2026-01', { pacientesDia: 1, leitosDia: 2 }),
      base('2026-02', { pacientesDia: 1, leitosDia: 4 }, true),
    ]);
    expect(ultimoFechado(s)?.periodo).toBe('2026-01');
    expect(ultimoFechado([s[1]!])?.periodo).toBe('2026-02');
    expect(ultimoFechado([])).toBeNull();
    const p = planilhaDaSerie(ocup, s);
    expect(p.split('\r\n')[1]).toBe('2026-01;1;2;50;não');
    expect(p.split('\r\n')[2]).toBe('2026-02;1;4;25;sim');
    expect(
      planilhaDaSerie(
        fichaDe('admissoes')!,
        serieDe(fichaDe('admissoes')!, [base('2026-01', { admissoes: 3 })]),
      ),
    ).toContain('2026-01;3;;3;não');
    expect(arredondar(0.1 + 0.2)).toBe(0.3);
  });
});
