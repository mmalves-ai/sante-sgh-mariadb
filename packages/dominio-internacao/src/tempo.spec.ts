import { describe, expect, it } from 'vitest';
import {
  dataDoDia,
  diaDaData,
  diaDoCenso,
  fechamento,
  idadeEm,
  instante,
  mesDoAnoAnterior,
  mesesEntre,
  minutosDaHora,
  ultimoDiaDoMes,
} from './tempo.js';

describe('tempo do movimento', () => {
  it('hora "HHMM" do legado; inválida ou vazia vale meia-noite', () => {
    expect(minutosDaHora('0730')).toBe(450);
    expect(minutosDaHora('07:30')).toBe(450);
    expect(minutosDaHora('930')).toBe(570);
    expect(minutosDaHora('2460')).toBe(0);
    expect(minutosDaHora(null)).toBe(0);
    expect(minutosDaHora('ab')).toBe(0);
  });

  it('instante, dia e mês', () => {
    const t = instante(new Date('2026-03-10T00:00:00Z'), '1800');
    expect(new Date(t).toISOString()).toBe('2026-03-10T18:00:00.000Z');
    expect(dataDoDia(diaDaData('2026-02-28'))).toBe('2026-02-28');
    expect(dataDoDia(ultimoDiaDoMes('2024-02'))).toBe('2024-02-29');
    expect(mesesEntre('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(mesDoAnoAnterior('2026-03')).toBe('2025-03');
  });

  it('dia do censo: (fechamento(D−1), fechamento(D)]', () => {
    const d = diaDaData('2026-03-10');
    expect(diaDoCenso(fechamento(d, 18), 18)).toBe(d);
    expect(diaDoCenso(fechamento(d, 18) + 60_000, 18)).toBe(d + 1);
    expect(diaDoCenso(fechamento(d - 1, 24) + 1, 24)).toBe(d);
  });

  it('idade em anos completos; nascimento sentinela ou impossível: sem idade', () => {
    const hoje = new Date('2026-10-21T00:00:00Z');
    expect(idadeEm(new Date('1980-10-21T00:00:00Z'), hoje)).toBe(46);
    expect(idadeEm(new Date('1980-10-22T00:00:00Z'), hoje)).toBe(45);
    expect(idadeEm(new Date('1980-11-01T00:00:00Z'), hoje)).toBe(45);
    expect(idadeEm(new Date('1899-12-30T00:00:00Z'), hoje)).toBeNull();
    expect(idadeEm(null, hoje)).toBeNull();
    expect(idadeEm(new Date('2030-01-01T00:00:00Z'), hoje)).toBeNull();
  });
});

describe('relógio de parede do estabelecimento', () => {
  it('ida e volta em São Paulo (UTC−3, sem horário de verão desde 2019)', async () => {
    const { relogioDeParede, instanteReal } = await import('./tempo.js');
    const real = Date.UTC(2026, 9, 21, 13, 0, 0);
    const parede = relogioDeParede(real);
    expect(new Date(parede).toISOString()).toBe('2026-10-21T10:00:00.000Z');
    expect(instanteReal(parede)).toBe(real);
    expect(new Date(relogioDeParede(real, 'UTC')).toISOString()).toBe('2026-10-21T13:00:00.000Z');
  });
});
