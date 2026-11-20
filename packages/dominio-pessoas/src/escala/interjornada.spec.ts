// Regra 5 do M52: interjornada de 11 h, salvo 12x36 previsto em acordo registrado (10 h 59 min recusado).
import { describe, expect, it } from 'vitest';
import { conferirInterjornada, descansoMinimo } from './interjornada.js';
import type { PlantaoProposto } from './plantao.js';

const dia = (inicio: string, fim: string, tipo: PlantaoProposto['tipo'] = 'presencial'): PlantaoProposto => ({
  tipo,
  inicio,
  fim,
  chegadaMin: tipo === 'sobreaviso' ? 30 : null,
});
const anterior = dia('2026-11-02T07:00', '2026-11-02T19:00');

describe('interjornada (regra 5)', () => {
  it('10 h 59 min entre as jornadas é recusado; 11 h passa', () => {
    const r = conferirInterjornada(dia('2026-11-03T05:59', '2026-11-03T11:59'), [anterior], null);
    expect(r).toMatchObject({ ok: false, codigo: 'interjornada' });
    expect(r.ok ? '' : r.mensagem).toContain('10 h 59 min');
    expect(conferirInterjornada(dia('2026-11-03T06:00', '2026-11-03T12:00'), [anterior], null).ok).toBe(true);
  });

  it('confere também o plantão que vem DEPOIS do novo', () => {
    const r = conferirInterjornada(dia('2026-11-01T19:00', '2026-11-02T00:00'), [anterior], null);
    expect(r).toMatchObject({ ok: false, codigo: 'interjornada' });
  });

  it('o sobreaviso não é jornada: nem o novo nem o outro contam', () => {
    expect(
      conferirInterjornada(dia('2026-11-02T20:00', '2026-11-03T07:00', 'sobreaviso'), [anterior], null).ok,
    ).toBe(true);
    expect(
      conferirInterjornada(
        dia('2026-11-03T01:00', '2026-11-03T07:00'),
        [dia('2026-11-02T19:00', '2026-11-03T00:00', 'sobreaviso')],
        null,
      ).ok,
    ).toBe(true);
  });

  it('o descanso abaixo de 11 h só vale com o acordo registrado (12x36)', () => {
    expect(descansoMinimo(null)).toBe(660);
    expect(descansoMinimo({ descansoMinimoMin: 600, acordo: null })).toBe(660);
    expect(descansoMinimo({ descansoMinimoMin: 600, acordo: '  ' })).toBe(660);
    expect(descansoMinimo({ descansoMinimoMin: 2160, acordo: null })).toBe(2160);
    const acordo = { descansoMinimoMin: 600, acordo: 'Convenção coletiva 2026, registro sintético 1' };
    expect(descansoMinimo(acordo)).toBe(600);
    expect(conferirInterjornada(dia('2026-11-03T05:00', '2026-11-03T11:00'), [anterior], acordo).ok).toBe(
      true,
    );
    const r = conferirInterjornada(dia('2026-11-03T04:59', '2026-11-03T11:00'), [anterior], acordo);
    expect(r.ok ? '' : r.mensagem).toContain('mínimo deste contrato é 10 h');
  });

  it('o regime 12x36 sem exceção exige as 36 h de folga', () => {
    const r1236 = { descansoMinimoMin: 36 * 60, acordo: null };
    expect(conferirInterjornada(dia('2026-11-04T07:00', '2026-11-04T19:00'), [anterior], r1236).ok).toBe(
      true,
    );
    expect(conferirInterjornada(dia('2026-11-03T19:00', '2026-11-04T07:00'), [anterior], r1236).ok).toBe(
      false,
    );
  });
});
