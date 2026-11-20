// Regra 3 (parte da etapa 1): período encerrado não recebe; a correção vai ao período aberto seguinte.
import { describe, expect, it } from 'vitest';
import {
  competenciaSeguinte,
  dataContabil,
  periodoAberto,
  primeiroPeriodoAberto,
  type PeriodoContabil,
} from './periodo.js';

const P: PeriodoContabil[] = [
  { empresa: 1, competencia: '2026-12', situacao: 'encerrado' },
  { empresa: 1, competencia: '2027-01', situacao: 'encerrado' },
  { empresa: 1, competencia: '2027-02', situacao: 'aberto' },
];

describe('período contábil', () => {
  it('aberto, encerrado e sem registro', () => {
    expect(periodoAberto(P, 1, '2027-01')).toBe(false);
    expect(periodoAberto(P, 1, '2027-02')).toBe(true);
    expect(periodoAberto(P, 1, '2027-05')).toBe(true);
    expect(periodoAberto(P, 2, '2027-01')).toBe(true);
  });

  it('competência seguinte e o primeiro aberto', () => {
    expect(competenciaSeguinte('2026-12')).toBe('2027-01');
    expect(competenciaSeguinte('2027-01')).toBe('2027-02');
    expect(() => competenciaSeguinte('2027-1')).toThrow(RangeError);
    expect(primeiroPeriodoAberto(P, 1, '2026-12')).toBe('2027-02');
    const tudoFechado = Array.from({ length: 1201 }, (_, i) => ({
      empresa: 1,
      competencia: `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
      situacao: 'encerrado' as const,
    }));
    expect(() => primeiroPeriodoAberto(tudoFechado, 1, '2000-01')).toThrow(RangeError);
  });

  it('data contábil: a do fato, ou o primeiro dia do período aberto seguinte', () => {
    expect(dataContabil(P, 1, '2027-02-10')).toBe('2027-02-10');
    expect(dataContabil(P, 1, '2027-01-20')).toBe('2027-02-01');
  });
});
