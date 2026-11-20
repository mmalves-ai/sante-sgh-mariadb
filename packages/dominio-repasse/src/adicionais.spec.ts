// Regra 6 do M33: adicionais de feriado e fim de semana, com o modo do parâmetro; não se somam.
import { describe, expect, it } from 'vitest';
import { adicionalDoDia, aplicarAdicional, ehFimDeSemana, lerFeriados } from './adicionais.js';

const r = { percentualFeriado: 20, percentualFimDeSemana: 10 };

describe('adicionais', () => {
  it('fim de semana: sábado e domingo (2026-10-10 é sábado)', () => {
    expect(ehFimDeSemana('2026-10-10')).toBe(true);
    expect(ehFimDeSemana('2026-10-11')).toBe(true);
    expect(ehFimDeSemana('2026-10-12')).toBe(false);
  });

  it('lê os feriados do parâmetro, ignorando o que não é data', () => {
    expect([...lerFeriados(' 2026-10-12, x ,2026-11-02')]).toEqual(['2026-10-12', '2026-11-02']);
    expect(lerFeriados('').size).toBe(0);
  });

  it('feriado vence fim de semana; sem percentual, sem adicional', () => {
    const f = lerFeriados('2026-10-10,2026-10-12');
    expect(adicionalDoDia(r, '2026-10-10', f)).toEqual({ tipo: 'feriado', percentual: 20 });
    expect(adicionalDoDia(r, '2026-10-11', f)).toEqual({ tipo: 'fim-de-semana', percentual: 10 });
    expect(adicionalDoDia(r, '2026-10-13', f)).toBeNull();
    expect(adicionalDoDia({ percentualFeriado: 0, percentualFimDeSemana: 10 }, '2026-10-12', f)).toBeNull();
    expect(adicionalDoDia({ percentualFeriado: 0, percentualFimDeSemana: 0 }, '2026-10-11', f)).toBeNull();
  });

  it('sobre o valor: 100,00 + 10% = 110,00; em pontos: 200,00 × (50% + 10%) = 120,00', () => {
    const c = { baseCentavos: 20000, percentual: 50, valorCentavos: 10000 };
    const a = { tipo: 'fim-de-semana', percentual: 10 } as const;
    expect(aplicarAdicional(c, a, 'sobre-valor')).toBe(11000);
    expect(aplicarAdicional(c, a, 'pontos')).toBe(12000);
    expect(aplicarAdicional(c, null, 'pontos')).toBe(10000);
  });

  it('valor fixo só aceita sobre o valor: 80,00 + 10% = 88,00 mesmo no modo pontos', () => {
    const c = { baseCentavos: 20000, percentual: 0, valorCentavos: 8000 };
    expect(aplicarAdicional(c, { tipo: 'feriado', percentual: 10 }, 'pontos')).toBe(8800);
  });
});
