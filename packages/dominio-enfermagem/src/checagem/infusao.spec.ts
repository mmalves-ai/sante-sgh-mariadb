// Regra 11 do M25: infusão contínua (início, pausa, troca, velocidade só se permitido, fim) e o volume infundido.
import { describe, expect, it } from 'vitest';
import {
  conferirEventoInfusao,
  estadoDaInfusao,
  type EventoInfusaoRegistrado,
  volumeEstimado,
} from './infusao.js';

const ev = (
  evento: EventoInfusaoRegistrado['evento'],
  horaReal: string,
  velocidadeMlH: number | null = null,
) => ({
  evento,
  horaReal,
  velocidadeMlH,
  volumeInfundidoMl: null,
});

describe('regra 11: infusão contínua', () => {
  it('o estado segue os eventos na ordem da hora real', () => {
    expect(estadoDaInfusao([])).toBe('naoIniciada');
    expect(estadoDaInfusao([ev('inicio', '2026-10-22T08:00', 100)])).toBe('emCurso');
    expect(estadoDaInfusao([ev('pausa', '2026-10-22T09:00'), ev('inicio', '2026-10-22T08:00', 100)])).toBe(
      'pausada',
    );
    expect(
      estadoDaInfusao([
        ev('inicio', '2026-10-22T08:00', 100),
        ev('pausa', '2026-10-22T09:00'),
        ev('retomada', '2026-10-22T09:30'),
      ]),
    ).toBe('emCurso');
    expect(estadoDaInfusao([ev('inicio', '2026-10-22T08:00', 100), ev('fim', '2026-10-22T12:00')])).toBe(
      'encerrada',
    );
  });
  it('a ordem dos eventos e a velocidade só onde a unidade e o item permitem', () => {
    const c = {
      anteriores: [] as EventoInfusaoRegistrado[],
      velocidadeMlH: 100,
      velocidadeAjustavel: true,
      horaReal: '2026-10-22T08:00',
    };
    expect(conferirEventoInfusao({ ...c, evento: 'inicio' })).toBeNull();
    expect(conferirEventoInfusao({ ...c, evento: 'inicio', velocidadeMlH: null })).toMatch(
      /velocidade do início/,
    );
    expect(conferirEventoInfusao({ ...c, evento: 'pausa' })).toMatch(/início da infusão primeiro/);
    const em = { ...c, anteriores: [ev('inicio', '2026-10-22T08:00', 100)], horaReal: '2026-10-22T09:00' };
    expect(conferirEventoInfusao({ ...em, evento: 'velocidade', velocidadeMlH: 80 })).toBeNull();
    expect(conferirEventoInfusao({ ...em, evento: 'velocidade', velocidadeAjustavel: false })).toMatch(
      /não pode ser mudada/,
    );
    expect(conferirEventoInfusao({ ...em, evento: 'velocidade', velocidadeMlH: null })).toMatch(
      /nova velocidade/,
    );
    expect(conferirEventoInfusao({ ...em, evento: 'retomada' })).toMatch(/em curso/);
    expect(conferirEventoInfusao({ ...em, evento: 'trocaBolsa' })).toBeNull();
    expect(conferirEventoInfusao({ ...em, evento: 'pausa', horaReal: '2026-10-22T07:00' })).toMatch(
      /anterior/,
    );
    const pausada = {
      ...em,
      anteriores: [...em.anteriores, ev('pausa', '2026-10-22T09:00')],
      horaReal: '2026-10-22T09:30',
    };
    expect(conferirEventoInfusao({ ...pausada, evento: 'pausa' })).toMatch(/pausada/);
    expect(conferirEventoInfusao({ ...pausada, evento: 'retomada' })).toBeNull();
    const fim = {
      ...em,
      anteriores: [...em.anteriores, ev('fim', '2026-10-22T10:00')],
      horaReal: '2026-10-22T11:00',
    };
    expect(conferirEventoInfusao({ ...fim, evento: 'inicio' })).toMatch(/encerrada/);
  });
  it('o volume infundido pela velocidade, sem contar a pausa', () => {
    const eventos = [
      ev('inicio', '2026-10-22T08:00', 100),
      ev('pausa', '2026-10-22T09:00'),
      ev('retomada', '2026-10-22T09:30'),
      ev('velocidade', '2026-10-22T10:30', 50),
    ];
    // 60 min × 100 + 60 min × 100 + 30 min × 50 = 100 + 100 + 25.
    expect(volumeEstimado(eventos, '2026-10-22T11:00')).toBe(225);
    expect(volumeEstimado([...eventos, ev('fim', '2026-10-22T11:00')], '2026-10-22T15:00')).toBe(225);
    expect(volumeEstimado([], '2026-10-22T15:00')).toBe(0);
  });
});
