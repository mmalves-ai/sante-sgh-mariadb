// 02-AGE linha 48: a ordem da lista de espera usa o grupo de prioridade legal da senha e da marcação.
import { describe, expect, it } from 'vitest';
import {
  chaveFilaEspera,
  conferirOfertaEspera,
  grupoLegalVigenteNaEspera,
  ordenarFilaEspera,
  posicoesNaFilaEspera,
  prioridadeGravadaNaEspera,
  prioridadeVigenteNaEspera,
} from './fila-espera.js';

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

describe('fila por vaga, grupo vigente e oferta (02-AGE 48, correção)', () => {
  const g = (id: number, peso: number, idadeMinima: number | null = null, ativo = true) => ({
    id,
    descricao: `g${id}`,
    ativo,
    peso,
    idadeMinima,
  });
  const grupos = [g(1, 1, 80), g(2, 2, 60), g(3, 3), g(4, 4, null, false)];
  const ped = (
    id: number,
    agenda: number | null,
    especialidade: number | null,
    peso: number | null,
    desde: string,
    prioridade = 'normal',
  ) => ({ id, prioridade, pesoPrioridadeLegal: peso, desde, situacao: 'aguardando', agenda, especialidade });

  it('a posição conta dentro da fila da agenda, ou da especialidade no pedido sem agenda', () => {
    const pos = posicoesNaFilaEspera([
      ped(1, null, 10, null, '2030-01-01'),
      ped(2, null, 20, null, '2030-01-02'),
      ped(3, null, 10, 3, '2030-01-03'),
      ped(4, 7, 10, null, '2030-01-04'),
    ]);
    expect([...pos.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [1, 2],
      [2, 1],
      [3, 1],
      [4, 1],
    ]);
    expect(chaveFilaEspera({ agenda: 7, especialidade: 10 })).toBe('agenda:7');
    expect(chaveFilaEspera({ agenda: null, especialidade: 10 })).toBe('especialidade:10');
  });

  it('o grupo vigente sobe quem faz 60 esperando, tira a vigência vencida e o grupo desativado', () => {
    const base = { informada: null, doPaciente: [], nascimento: '1970-03-12' };
    expect(grupoLegalVigenteNaEspera(grupos, { ...base, data: '2030-03-11' })).toBeNull();
    expect(grupoLegalVigenteNaEspera(grupos, { ...base, data: '2030-03-12' })).toBe(2);
    const gest = {
      informada: null,
      nascimento: null,
      doPaciente: [{ grupo: 3, vigenciaInicio: '2030-01-01', vigenciaFim: '2030-03-11' }],
    };
    expect(grupoLegalVigenteNaEspera(grupos, { ...gest, data: '2030-03-11' })).toBe(3);
    expect(grupoLegalVigenteNaEspera(grupos, { ...gest, data: '2030-03-12' })).toBeNull();
    expect(
      grupoLegalVigenteNaEspera(grupos, {
        informada: 4,
        doPaciente: [],
        nascimento: null,
        data: '2030-03-12',
      }),
    ).toBeNull();
    expect(
      grupoLegalVigenteNaEspera(grupos, {
        informada: 3,
        doPaciente: [],
        nascimento: null,
        data: '2030-03-12',
      }),
    ).toBe(3);
  });

  it('a coluna de prioridade acompanha o grupo vigente', () => {
    expect(prioridadeVigenteNaEspera('urgente', 3, null)).toBe('urgente');
    expect(prioridadeVigenteNaEspera('preferencial', 3, null)).toBe('normal');
    expect(prioridadeVigenteNaEspera('normal', null, 2)).toBe('preferencial');
    expect(prioridadeVigenteNaEspera('preferencial', null, null)).toBe('preferencial');
  });

  it('a oferta recusa vaga incompatível e exige motivo para passar alguém à frente na mesma fila', () => {
    const fila = [
      ped(1, null, 10, 1, '2030-01-02'),
      ped(2, null, 10, null, '2030-01-01'),
      ped(3, null, 20, null, '2029-01-01'),
      ped(4, 7, 10, null, '2030-01-01'),
    ];
    const vaga = { agenda: 9, especialidadesDaAgenda: [10] };
    expect(conferirOfertaEspera(fila, fila[0]!, vaga, null)).toEqual({ ok: true, aFrente: 0 });
    expect(conferirOfertaEspera(fila, fila[1]!, vaga, null)).toMatchObject({
      ok: false,
      codigo: 'oferta-fora-da-ordem',
      aFrente: 1,
    });
    expect(conferirOfertaEspera(fila, fila[1]!, vaga, 'paciente só pode nesse horário')).toEqual({
      ok: true,
      aFrente: 1,
    });
    expect(conferirOfertaEspera(fila, fila[2]!, vaga, 'x')).toMatchObject({
      ok: false,
      codigo: 'vaga-incompativel',
    });
    expect(conferirOfertaEspera(fila, fila[3]!, vaga, 'x')).toMatchObject({
      ok: false,
      codigo: 'vaga-incompativel',
    });
    expect(conferirOfertaEspera(fila, fila[3]!, { agenda: 7, especialidadesDaAgenda: [] }, null)).toEqual({
      ok: true,
      aFrente: 0,
    });
  });
});
