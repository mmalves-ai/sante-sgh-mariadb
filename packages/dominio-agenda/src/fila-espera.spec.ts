// 02-AGE linha 48: a ordem da lista de espera usa o grupo de prioridade legal da senha e da marcação.
import { describe, expect, it } from 'vitest';
import { ordenarFilaEspera, prioridadeGravadaNaEspera } from './fila-espera.js';

const item = (
  id: number,
  prioridade: string,
  pesoPrioridadeLegal: number | null,
  desde: string,
  situacao = 'aguardando',
) => ({ id, prioridade, pesoPrioridadeLegal, desde, situacao });

describe('prioridadeGravadaNaEspera', () => {
  it('urgência clínica vence; com grupo legal fica preferencial; sem nada, normal', () => {
    expect(prioridadeGravadaNaEspera('urgente', 3)).toBe('urgente');
    expect(prioridadeGravadaNaEspera('urgente', null)).toBe('urgente');
    expect(prioridadeGravadaNaEspera('normal', 3)).toBe('preferencial');
    expect(prioridadeGravadaNaEspera('normal', null)).toBe('normal');
  });
});

describe('ordenarFilaEspera', () => {
  it('urgência clínica, depois o peso do grupo legal, depois a antiguidade', () => {
    const fila = ordenarFilaEspera([
      item(1, 'normal', null, '2030-01-01T08:00'),
      item(2, 'preferencial', 2, '2030-01-02T08:00'),
      item(3, 'preferencial', 1, '2030-01-03T08:00'),
      item(4, 'urgente', null, '2030-01-04T08:00'),
      item(5, 'urgente', 1, '2030-01-05T08:00'),
      item(6, 'preferencial', 2, '2030-01-01T09:00'),
    ]);
    expect(fila.map((x) => x.id)).toEqual([5, 4, 3, 6, 2, 1]);
  });

  it('pedido antigo só "preferencial", sem grupo: depois dos grupos legais, antes de quem não tem prioridade', () => {
    const fila = ordenarFilaEspera([
      item(1, 'normal', null, '2030-01-01T08:00'),
      item(2, 'preferencial', null, '2030-01-02T08:00'),
      item(3, 'preferencial', 9, '2030-01-03T08:00'),
    ]);
    expect(fila.map((x) => x.id)).toEqual([3, 2, 1]);
  });

  it('só quem aguarda entra na fila; no empate de tudo, o número do pedido', () => {
    const fila = ordenarFilaEspera([
      item(9, 'normal', null, '2030-01-01T08:00'),
      item(7, 'normal', null, '2030-01-01T08:00'),
      item(8, 'urgente', null, '2030-01-01T07:00', 'ofertado'),
    ]);
    expect(fila.map((x) => x.id)).toEqual([7, 9]);
  });
});
