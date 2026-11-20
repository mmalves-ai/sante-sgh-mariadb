import { describe, expect, it } from 'vitest';
import { ordenarFila, prioritariasSeguidas, type SenhaNaFila } from './fila.js';

const s = (id: number, prioridade: string, minuto: number): SenhaNaFila => ({
  id,
  numero: id,
  prioridade,
  emitidaEm: `2026-10-21T08:${String(minuto).padStart(2, '0')}:00`,
});
const fila = [
  s(1, '2', 0),
  s(2, '2', 1),
  s(3, '1', 2),
  s(4, '2', 3),
  s(5, '0', 4),
  s(6, '1', 5),
  s(7, '2', 6),
];
const ids = (xs: readonly SenhaNaFila[]) => xs.map((x) => x.id);

describe('ordem da fila (a normal não para)', () => {
  it('prioritárias primeiro: 0, depois 1, depois as normais pela chegada', () => {
    expect(ids(ordenarFila(fila, { ordem: 'prioridade', intercalar: 2 }))).toEqual([5, 3, 6, 1, 2, 4, 7]);
  });

  it('só pela chegada', () => {
    expect(ids(ordenarFila([...fila].reverse(), { ordem: 'chegada', intercalar: 2 }))).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it('intercalada: N prioritárias para cada normal', () => {
    expect(ids(ordenarFila(fila, { ordem: 'intercalada', intercalar: 2 }))).toEqual([5, 3, 1, 6, 2, 4, 7]);
    expect(ids(ordenarFila(fila, { ordem: 'intercalada', intercalar: 1 }))).toEqual([5, 1, 3, 2, 6, 4, 7]);
  });

  it('intercalada continua de onde o guichê parou', () => {
    expect(ids(ordenarFila(fila, { ordem: 'intercalada', intercalar: 2 }, 2))).toEqual([1, 5, 3, 2, 6, 4, 7]);
  });

  it('sem normais ou sem prioritárias', () => {
    expect(ids(ordenarFila([s(1, '1', 0), s(2, '0', 1)], { ordem: 'intercalada', intercalar: 1 }))).toEqual([
      2, 1,
    ]);
    expect(
      ids(ordenarFila([s(1, '2', 1), s(2, '2', 0)], { ordem: 'intercalada', intercalar: 3 }, 9)),
    ).toEqual([2, 1]);
    expect(ordenarFila([])).toEqual([]);
  });

  it('prioritárias seguidas desde a última normal', () => {
    expect(
      prioritariasSeguidas([
        { prioridade: '1' },
        { prioridade: '0' },
        { prioridade: '2' },
        { prioridade: '1' },
      ]),
    ).toBe(2);
    expect(prioritariasSeguidas([{ prioridade: '2' }])).toBe(0);
    expect(prioritariasSeguidas([])).toBe(0);
  });
});
