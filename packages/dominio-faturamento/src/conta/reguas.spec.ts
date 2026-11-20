// Regra 11 (ficha do M30): duas réguas de data; a competência é o padrão.
import { describe, expect, it } from 'vitest';
import {
  competencia,
  diasDesde,
  lerCompetencia,
  noFiltro,
  REGUA_PADRAO,
  ROTULO_REGUA,
  textoCompetencia,
} from '../index.js';

describe('réguas de data (regra 11)', () => {
  it('competência ANOPRO*100+MESPRO, padrão das telas', () => {
    expect(REGUA_PADRAO).toBe('competencia');
    expect(competencia(2026, 3)).toBe(202603);
    expect(() => competencia(2026, 13)).toThrow(RangeError);
    expect(ROTULO_REGUA['data-item']).toBe('Data do item');
    expect(textoCompetencia(2026, 3)).toBe('03/2026');
  });
  it('lê a competência digitada', () => {
    expect(lerCompetencia('2026-10')).toEqual({ ano: 2026, mes: 10 });
    expect(lerCompetencia('2026-13')).toBeNull();
    expect(lerCompetencia('10/2026')).toBeNull();
    expect(lerCompetencia(undefined)).toBeNull();
  });
  it('o mesmo item cai em meses diferentes conforme a régua', () => {
    const conta = { ano: 2026, mes: 2 };
    const item = { data: '2026-01-31' };
    expect(noFiltro('competencia', conta, item, { ano: 2026, mes: 2 })).toBe(true);
    expect(noFiltro('data-item', conta, item, { ano: 2026, mes: 2 })).toBe(false);
    expect(noFiltro('data-item', conta, item, { ano: 2026, mes: 1 })).toBe(true);
  });
  it('idade desde a alta (a sentinela não conta)', () => {
    expect(diasDesde('2026-10-01', '2026-10-11')).toBe(10);
    expect(diasDesde('1899-12-30', '2026-10-11')).toBeNull();
    expect(diasDesde(null, '2026-10-11')).toBeNull();
    expect(diasDesde('2026-10-12', '2026-10-11')).toBe(0);
  });
});
