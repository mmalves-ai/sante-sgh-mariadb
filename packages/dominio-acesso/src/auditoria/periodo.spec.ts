import { describe, expect, it } from 'vitest';
import { conferirPeriodo, DIAS_AO_VIVO, fimExclusivo, mensagemPeriodo } from './periodo.js';

describe('período da trilha (regra 12)', () => {
  const hoje = '2026-10-21';
  it('obrigatório, válido, até 31 dias, não invertido nem no futuro', () => {
    expect(conferirPeriodo(null, '2026-10-01', hoje)).toEqual({ ok: false, falha: 'obrigatorio' });
    expect(conferirPeriodo('2026-10-01', undefined, hoje)).toEqual({ ok: false, falha: 'obrigatorio' });
    expect(conferirPeriodo('2026-02-30', '2026-03-01', hoje)).toEqual({ ok: false, falha: 'formato' });
    expect(conferirPeriodo('01/10/2026', '2026-10-02', hoje)).toEqual({ ok: false, falha: 'formato' });
    expect(conferirPeriodo('2026-10-10', '2026-10-01', hoje)).toEqual({ ok: false, falha: 'invertido' });
    expect(conferirPeriodo('2026-10-22', '2026-10-23', hoje)).toEqual({ ok: false, falha: 'futuro' });
    expect(conferirPeriodo('2026-09-01', '2026-10-02', hoje)).toEqual({ ok: false, falha: 'longo' });
    expect(conferirPeriodo('2026-09-21', '2026-10-21', hoje)).toEqual({
      ok: true,
      periodo: { inicio: '2026-09-21', fim: '2026-10-21', dias: DIAS_AO_VIVO },
    });
    expect(conferirPeriodo('2026-10-21', '2026-10-21', 'x')).toEqual({ ok: false, falha: 'formato' });
  });
  it('fim exclusivo é o dia seguinte (inclusive na virada de mês e ano)', () => {
    expect(fimExclusivo('2026-10-31')).toBe('2026-11-01');
    expect(fimExclusivo('2026-12-31')).toBe('2027-01-01');
    expect(() => fimExclusivo('x')).toThrow();
  });
  it('mensagens de produto', () => {
    for (const f of ['obrigatorio', 'formato', 'invertido', 'futuro', 'longo'] as const)
      expect(mensagemPeriodo(f)).not.toMatch(/spdata|legado/i);
    expect(mensagemPeriodo('longo')).toMatch(/31 dias/);
  });
});
