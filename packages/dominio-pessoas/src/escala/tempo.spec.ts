// Tempo da escala (M52.2): relógio local de Brasília em minutos, a semana de segunda a domingo e os dias da competência.
import { describe, expect, it } from 'vitest';
import {
  diaDeMinuto,
  diasDaCompetencia,
  duracaoMin,
  instanteDeMinuto,
  minutoLocal,
  minutosPorSemana,
  segundaDaSemana,
  sobrepoem,
} from './tempo.js';

describe('tempo da escala', () => {
  it('converte ida e volta e mede o plantão que atravessa a meia-noite', () => {
    const m = minutoLocal('2026-11-02T19:00');
    expect(instanteDeMinuto(m)).toBe('2026-11-02T19:00');
    expect(diaDeMinuto(m + 6 * 60)).toBe('2026-11-03');
    expect(duracaoMin({ inicio: '2026-11-30T19:00', fim: '2026-12-01T07:00' })).toBe(12 * 60);
    expect(() => minutoLocal('2026-11-02 19:00')).toThrow('Instante inválido');
  });

  it('sobreposição: encostar não é sobrepor', () => {
    const a = { inicio: '2026-11-02T07:00', fim: '2026-11-02T19:00' };
    expect(sobrepoem(a, { inicio: '2026-11-02T19:00', fim: '2026-11-03T07:00' })).toBe(false);
    expect(sobrepoem(a, { inicio: '2026-11-02T18:59', fim: '2026-11-03T07:00' })).toBe(true);
  });

  it('semana de segunda a domingo e os dias do mês', () => {
    expect(segundaDaSemana('2026-11-02')).toBe('2026-11-02'); // segunda
    expect(segundaDaSemana('2026-11-08')).toBe('2026-11-02'); // domingo
    expect(segundaDaSemana('2026-11-01')).toBe('2026-10-26');
    expect(diasDaCompetencia('2026-02')).toHaveLength(28);
    expect(diasDaCompetencia('2028-02').at(-1)).toBe('2028-02-29');
    expect(() => diasDaCompetencia('2026-13')).toThrow('Competência inválida');
  });

  it('o plantão de domingo à noite divide as horas entre as duas semanas', () => {
    const m = minutosPorSemana([{ inicio: '2026-11-08T19:00', fim: '2026-11-09T07:00' }]);
    expect(m.get('2026-11-02')).toBe(5 * 60);
    expect(m.get('2026-11-09')).toBe(7 * 60);
  });
});
