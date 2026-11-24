// 02-AGE linha 49: os encaixes do mesmo horário no painel, o prioritário antes.
import { describe, expect, it } from 'vitest';
import { ordenarPainelComEncaixes } from './ordem-painel.js';

const m = (id: number, hora: string, encaixe: boolean, pesoPrioridade: number | null = null) => ({
  id,
  data: '2030-03-12',
  hora,
  encaixe,
  pesoPrioridade,
});

describe('ordenarPainelComEncaixes', () => {
  it('no mesmo horário: a marcação da grade, depois os encaixes pelo peso do grupo legal e pela entrada', () => {
    const r = ordenarPainelComEncaixes([
      m(1, '08:00', false),
      m(2, '08:00', true),
      m(3, '08:00', true, 2),
      m(4, '08:00', true, 1),
      m(5, '08:15', true),
      m(6, '08:15', false),
      m(7, '08:30', false, 1),
    ]);
    expect(r.map((x) => x.id)).toEqual([1, 4, 3, 2, 6, 5, 7]);
  });

  it('agendas diferentes no mesmo horário não se misturam', () => {
    const r = ordenarPainelComEncaixes([
      { ...m(1, '08:00', false), agenda: 1 },
      { ...m(2, '08:00', true), agenda: 1 },
      { ...m(3, '08:00', false), agenda: 2 },
      { ...m(4, '08:00', true, 1), agenda: 2 },
    ]);
    expect(r.map((x) => x.id)).toEqual([1, 2, 3, 4]);
  });

  it('sem encaixe nada muda', () => {
    const l = [m(1, '08:00', false, 2), m(2, '08:15', false, 1)];
    expect(ordenarPainelComEncaixes(l).map((x) => x.id)).toEqual([1, 2]);
  });
});
