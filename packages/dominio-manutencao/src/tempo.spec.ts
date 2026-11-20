import { describe, expect, it } from 'vitest';
import {
  arred2,
  dataDoDia,
  diaDe,
  diasEntre,
  horas2,
  instanteDe,
  minutoDe,
  somarDias,
  somarMeses,
} from './tempo.js';

describe('tempo', () => {
  it('converte datas e instantes locais sem depender do fuso', () => {
    expect(minutoDe('2026-10-20T08:30') - minutoDe('2026-10-20')).toBe(510);
    expect(instanteDe(minutoDe('2026-10-20T08:30'))).toBe('2026-10-20T08:30');
    expect(dataDoDia(diaDe('2026-02-28') + 1)).toBe('2026-03-01');
    expect(diasEntre('2026-10-20', '2026-10-24')).toBe(4);
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('recusa formato e data impossível', () => {
    expect(() => diaDe('2026-02-30')).toThrow();
    expect(() => diaDe('20/10/2026')).toThrow();
    expect(() => minutoDe('2026-10-20T24:00')).toThrow();
    expect(() => minutoDe('2026-10-20 08:00')).toThrow();
    expect(() => somarMeses('x', 1)).toThrow();
  });

  it('soma meses no último dia do mês curto', () => {
    expect(somarMeses('2026-01-31', 1)).toBe('2026-02-28');
    expect(somarMeses('2028-01-31', 1)).toBe('2028-02-29');
    expect(somarMeses('2026-11-15', 3)).toBe('2027-02-15');
    expect(somarMeses('2026-03-31', -1)).toBe('2026-02-28');
  });

  it('arredonda horas com 2 casas', () => {
    expect(horas2(100)).toBe(1.67);
    expect(arred2(99.995)).toBe(100);
  });
});
