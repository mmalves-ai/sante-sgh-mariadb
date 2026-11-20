// Linha do tempo do turno (M25, seção 7; regras 3 e 10): turno de 12 horas, estados, resumo e mudanças da vigia.
import { describe, expect, it } from 'vitest';
import {
  estadosNoTurno,
  mudancasDeSituacao,
  porHora,
  suspensoes,
  turnoDoDia,
  turnoDoInstante,
} from './linha-do-tempo.js';

describe('turno de 12 horas', () => {
  it('o turno do instante (diurno às 7h; noturno às 19h, atravessando a meia-noite)', () => {
    expect(turnoDoInstante('2026-10-22T10:00')).toEqual({
      nome: 'diurno',
      inicio: '2026-10-22T07:00',
      fim: '2026-10-22T19:00',
    });
    expect(turnoDoInstante('2026-10-22T19:00')).toEqual({
      nome: 'noturno',
      inicio: '2026-10-22T19:00',
      fim: '2026-10-23T07:00',
    });
    expect(turnoDoInstante('2026-10-23T03:00')).toEqual({
      nome: 'noturno',
      inicio: '2026-10-22T19:00',
      fim: '2026-10-23T07:00',
    });
    expect(turnoDoInstante('2026-10-22T06:30', '0600')).toMatchObject({
      nome: 'diurno',
      inicio: '2026-10-22T06:00',
    });
    expect(turnoDoDia('2026-10-22', 'noturno')).toEqual({
      nome: 'noturno',
      inicio: '2026-10-22T19:00',
      fim: '2026-10-23T07:00',
    });
    expect(turnoDoDia('2026-10-22', 'diurno', '0600')).toMatchObject({
      inicio: '2026-10-22T06:00',
      fim: '2026-10-22T18:00',
    });
  });
});

describe('estados no turno e o resumo', () => {
  it('atrasada em vermelho, omitida do turno anterior, tempo crítico com a tolerância menor', () => {
    const turno = turnoDoInstante('2026-10-22T12:00');
    const r = estadosNoTurno(
      [
        { id: 3, previsto: '2026-10-22T11:30', situacao: 'P', altaVigilancia: true },
        { id: 1, previsto: '2026-10-22T08:00', situacao: 'P', altaVigilancia: false },
        { id: 2, previsto: '2026-10-22T11:30', situacao: 'P', altaVigilancia: false },
        { id: 4, previsto: '2026-10-22T06:00', situacao: 'P', altaVigilancia: false },
        { id: 5, previsto: '2026-10-22T10:00', situacao: 'A', altaVigilancia: false },
        { id: 6, previsto: '2026-10-22T14:00', situacao: 'S', altaVigilancia: false },
        { id: 7, previsto: '2026-10-22T11:00', situacao: 'P', altaVigilancia: false, antimicrobiano: true },
      ],
      { agora: '2026-10-22T12:00', turno, tolerancia: 60, toleranciaTempoCritico: 30 },
    );
    expect(r.itens.map((x) => [x.id, x.estado])).toEqual([
      [4, 'omitida'],
      [1, 'atrasada'],
      [5, 'administrada'],
      [7, 'atrasada'],
      [2, 'pendente'],
      [3, 'pendente'],
      [6, 'suspensa'],
    ]);
    expect(r.itens.find((x) => x.id === 1)?.atrasoMinutos).toBe(240);
    expect(r.itens.find((x) => x.id === 2)?.atrasoMinutos).toBeNull();
    expect(r.resumo).toMatchObject({
      omitida: 1,
      atrasada: 2,
      pendente: 2,
      administrada: 1,
      suspensa: 1,
      naoAdministrada: 0,
    });
    expect([...porHora(r.itens).keys()]).toEqual([
      '2026-10-22T06:00',
      '2026-10-22T08:00',
      '2026-10-22T10:00',
      '2026-10-22T11:00',
      '2026-10-22T14:00',
    ]);
  });
});

describe('regra 10: mudanças de situação para a vigia', () => {
  it('só as que mudaram, e a contagem das suspensões', () => {
    const antes = new Map([
      [1, 'P'],
      [2, 'P'],
      [3, 'P'],
    ]);
    const depois = new Map([
      [1, 'S'],
      [2, 'P'],
      [3, 'A'],
      [4, 'P'],
    ]);
    const m = mudancasDeSituacao(antes, depois);
    expect(m).toEqual([
      { horario: 1, de: 'P', para: 'S' },
      { horario: 3, de: 'P', para: 'A' },
    ]);
    expect(suspensoes(m)).toBe(1);
  });
});
