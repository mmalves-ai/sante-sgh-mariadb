// Regra 6 do M52: limite de horas do contrato por POTPCONTTEMP (0 = não é tempo parcial; 1 = 25 h; 2 = 30 h; 3 = 26 h).
import { describe, expect, it } from 'vitest';
import { conferirLimiteSemanal, horasPorSemana, limiteSemanalEfetivo } from './limite-contrato.js';
import type { PlantaoProposto } from './plantao.js';

const pl = (inicio: string, fim: string, tipo: PlantaoProposto['tipo'] = 'presencial'): PlantaoProposto => ({
  tipo,
  inicio,
  fim,
  chegadaMin: tipo === 'sobreaviso' ? 30 : null,
});
const regime = (
  contratoParcial: number,
  limiteParcialDominio: number | null = null,
  limiteSemanalHoras = 44,
) => ({
  contratoParcial,
  limiteParcialDominio,
  limiteSemanalHoras,
});

describe('limite do contrato (regra 6)', () => {
  it('o limite efetivo: tempo parcial pelo domínio (ou a legenda), senão o do regime, senão o do tipo', () => {
    expect(limiteSemanalEfetivo(regime(0), 'clt')).toBe(44);
    expect(limiteSemanalEfetivo(regime(1), 'clt')).toBe(25);
    expect(limiteSemanalEfetivo(regime(2), 'clt')).toBe(30);
    expect(limiteSemanalEfetivo(regime(3), 'clt')).toBe(26);
    expect(limiteSemanalEfetivo(regime(1, 24), 'clt')).toBe(24);
    expect(limiteSemanalEfetivo(regime(1, 0), 'clt')).toBe(25);
    expect(limiteSemanalEfetivo(regime(7, null, 40), 'clt')).toBe(40); // código desconhecido: vale o do regime
    expect(limiteSemanalEfetivo(null, 'clt')).toBe(44);
    expect(limiteSemanalEfetivo(null, 'estagiario')).toBe(30);
  });

  it('tempo parcial de 25 h: o terceiro plantão de 12 h na semana é recusado', () => {
    const outros = [pl('2026-11-02T07:00', '2026-11-02T19:00'), pl('2026-11-04T07:00', '2026-11-04T19:00')];
    const r = conferirLimiteSemanal(pl('2026-11-06T07:00', '2026-11-06T19:00'), outros, 25);
    expect(r).toMatchObject({ ok: false, codigo: 'limite-do-contrato' });
    expect(r.ok ? '' : r.mensagem).toContain('02/11');
    expect(r.ok ? '' : r.mensagem).toContain('36 h');
    // Na semana seguinte, cabe.
    expect(conferirLimiteSemanal(pl('2026-11-09T07:00', '2026-11-09T19:00'), outros, 25).ok).toBe(true);
    // 1 h a menos cabe nas 25 h.
    expect(conferirLimiteSemanal(pl('2026-11-06T07:00', '2026-11-06T08:00'), outros, 25).ok).toBe(true);
  });

  it('sobreaviso não conta; o plantão de domingo à noite divide as horas', () => {
    const outros = [
      pl('2026-11-02T07:00', '2026-11-02T19:00'),
      pl('2026-11-04T07:00', '2026-11-04T19:00', 'sobreaviso'),
    ];
    expect(conferirLimiteSemanal(pl('2026-11-05T07:00', '2026-11-05T19:00'), outros, 25).ok).toBe(true);
    expect(
      conferirLimiteSemanal(pl('2026-11-04T07:00', '2026-11-04T19:00', 'sobreaviso'), outros, 1).ok,
    ).toBe(true);
    const r = conferirLimiteSemanal(
      pl('2026-11-08T19:00', '2026-11-09T07:00'),
      [pl('2026-11-09T19:00', '2026-11-10T07:00')],
      18,
    );
    expect(r).toMatchObject({ ok: false }); // semana de 09/11: 7 h + 12 h = 19 h > 18 h
    expect(r.ok ? '' : r.mensagem).toContain('09/11');
    expect(r.ok ? '' : r.mensagem).toContain('19 h');
  });

  it('mensagem com fração de hora e as horas por semana da grade', () => {
    const r = conferirLimiteSemanal(pl('2026-11-02T07:00', '2026-11-02T08:30'), [], 1);
    expect(r.ok ? '' : r.mensagem).toContain('1,5 h');
    const h = horasPorSemana([
      pl('2026-11-02T07:00', '2026-11-02T19:20'),
      pl('2026-11-03T07:00', '2026-11-03T19:00', 'sobreaviso'),
    ]);
    expect(h.get('2026-11-02')).toBe(12.3);
  });
});
