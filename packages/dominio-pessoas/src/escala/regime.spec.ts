// Regimes (M52.2): descanso abaixo de 11 h só com acordo; plantão cabe no limite; o regime que vale no dia.
import { describe, expect, it } from 'vitest';
import { conferirRegime, regimeNoDia } from './regime.js';

describe('regime', () => {
  it('descanso abaixo de 11 h pede o acordo; plantão maior que o limite semanal é recusado', () => {
    const r = { minutosPlantao: 720, descansoMinimoMin: 600, limiteSemanalHoras: 44, acordo: null };
    expect(conferirRegime(r)).toMatchObject({ ok: false, codigo: 'descanso-sem-acordo' });
    expect(conferirRegime({ ...r, acordo: 'Acordo coletivo sintético 1' }).ok).toBe(true);
    expect(conferirRegime({ ...r, descansoMinimoMin: 2160 }).ok).toBe(true);
    expect(conferirRegime({ ...r, descansoMinimoMin: 660, limiteSemanalHoras: 10 })).toMatchObject({
      ok: false,
      codigo: 'plantao-acima-do-limite',
    });
  });

  it('o regime do dia é a vigência de maior "desde" até o dia', () => {
    const v = [
      { regime: 1, desde: '2026-10-01' },
      { regime: 2, desde: '2026-11-15' },
    ];
    expect(regimeNoDia(v, '2026-09-30')).toBeNull();
    expect(regimeNoDia(v, '2026-11-14')?.regime).toBe(1);
    expect(regimeNoDia(v, '2026-11-15')?.regime).toBe(2);
    expect(regimeNoDia([...v].reverse(), '2026-12-01')?.regime).toBe(2);
  });
});
