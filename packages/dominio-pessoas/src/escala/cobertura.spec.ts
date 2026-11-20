// Cobertura mínima por turno e o furo de escala (regra 9, com o mínimo informado pela coordenação; COFEN na F3).
import { describe, expect, it } from 'vitest';
import { furosDaEscala, janelaDoTurno } from './cobertura.js';
import type { PlantaoProposto } from './plantao.js';
import { minutoLocal } from './tempo.js';

const pl = (inicio: string, fim: string, tipo: PlantaoProposto['tipo'] = 'presencial'): PlantaoProposto => ({
  tipo,
  inicio,
  fim,
  chegadaMin: tipo === 'sobreaviso' ? 30 : null,
});

describe('cobertura mínima', () => {
  it('a noite vai das 19 h às 7 h do dia seguinte', () => {
    const j = janelaDoTurno('2026-11-30', 'noite');
    expect(j.inicio).toBe(minutoLocal('2026-11-30T19:00'));
    expect(j.fim).toBe(minutoLocal('2026-12-01T07:00'));
  });

  it('12 h diurno cobre manhã e tarde; o noturno cobre a noite; sobreaviso não cobre', () => {
    const plantoes = [];
    for (let d = 1; d <= 30; d++) {
      const dia = `2026-11-${String(d).padStart(2, '0')}`;
      const amanha = d === 30 ? '2026-12-01' : `2026-11-${String(d + 1).padStart(2, '0')}`;
      plantoes.push(pl(`${dia}T07:00`, `${dia}T19:00`));
      if (d !== 15) plantoes.push(pl(`${dia}T19:00`, `${amanha}T07:00`));
      else plantoes.push(pl(`${dia}T19:00`, `${amanha}T07:00`, 'sobreaviso'));
    }
    const furos = furosDaEscala('2026-11', { manha: 1, tarde: 1, noite: 1 }, plantoes);
    expect(furos).toEqual([{ dia: '2026-11-15', turno: 'noite', minimo: 1, escalados: 0 }]);
  });

  it('turno com mínimo zero não é conferido; o plantão parcial não cobre o turno', () => {
    const furos = furosDaEscala('2026-02', { manha: 2, tarde: 0, noite: 0 }, [
      pl('2026-02-01T07:00', '2026-02-01T13:00'),
      pl('2026-02-01T08:00', '2026-02-01T13:00'),
    ]);
    expect(furos[0]).toEqual({ dia: '2026-02-01', turno: 'manha', minimo: 2, escalados: 1 });
    expect(furos).toHaveLength(28);
  });
});
