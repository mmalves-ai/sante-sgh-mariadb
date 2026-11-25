// 05-SADT linha 19: a prioridade legal do paciente na fila do setor e a grade da semana da escala. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import type { EscalaExecucao } from './execucao.js';
import {
  esperaNoDia,
  diasSemCobertura,
  gradeDaSemana,
  type GrupoPrioridade,
  idadeEm,
  inicioDaSemana,
  prioridadeDoPaciente,
} from './prioridade.js';

const GRUPOS: GrupoPrioridade[] = [
  { id: 1, peso: 1, idadeMinima: 80 },
  { id: 2, peso: 2, idadeMinima: 60 },
  { id: 3, peso: 2, idadeMinima: null }, // gestante
  { id: 4, peso: 3, idadeMinima: null }, // pessoa com deficiência
];

describe('idadeEm', () => {
  it('conta anos completos e só vira no aniversário', () => {
    expect(idadeEm('1946-11-24', '2026-11-23')).toBe(79);
    expect(idadeEm('1946-11-24', '2026-11-24')).toBe(80);
  });
  it('sem nascimento, inválido ou no futuro: nulo', () => {
    expect(idadeEm(null, '2026-11-24')).toBeNull();
    expect(idadeEm('24/11/1946', '2026-11-24')).toBeNull();
    expect(idadeEm('2027-01-01', '2026-11-24')).toBeNull();
  });
});

describe('prioridadeDoPaciente', () => {
  it('o grupo de idade vale sozinho, e o maior de 80 passa à frente do idoso', () => {
    expect(prioridadeDoPaciente(GRUPOS, 85, [])?.id).toBe(1);
    expect(prioridadeDoPaciente(GRUPOS, 61, [])?.id).toBe(2);
    expect(prioridadeDoPaciente(GRUPOS, 59, [])).toBeNull();
  });
  it('a condição registrada vale; entre duas, a de menor peso', () => {
    expect(prioridadeDoPaciente(GRUPOS, 30, [4])?.id).toBe(4);
    expect(prioridadeDoPaciente(GRUPOS, 30, [4, 3])?.id).toBe(3);
  });
  it('idosa com deficiência: vale o grupo que chama antes; empate de peso, o de menor id', () => {
    expect(prioridadeDoPaciente(GRUPOS, 62, [4])?.id).toBe(2);
    expect(prioridadeDoPaciente(GRUPOS, 62, [3])?.id).toBe(2);
  });
  it('sem idade conhecida, o grupo de idade registrado à mão vale; o não registrado não', () => {
    expect(prioridadeDoPaciente(GRUPOS, null, [])).toBeNull();
    expect(prioridadeDoPaciente(GRUPOS, null, [2])?.id).toBe(2);
  });
});

const escala: EscalaExecucao = {
  id: 1,
  setor: 10,
  profissional: 7,
  recurso: null,
  descricao: 'Ultrassom',
  vigenciaInicio: '2026-11-24',
  vigenciaFim: null,
  plantoes: [
    { diaSemana: 2, data: null, inicio: '19:00', fim: '07:00', capacidade: 8 },
    { diaSemana: 3, data: null, inicio: '13:00', fim: '18:00', capacidade: 8 },
    { diaSemana: 3, data: null, inicio: '07:00', fim: '12:00', capacidade: 8 },
    { diaSemana: null, data: '2026-11-28', inicio: '08:00', fim: '12:00', capacidade: 4 },
  ],
  exames: [{ exame: 505, limitePorTurno: null, grupoPrioridade: null, vagasReservadas: 0 }],
};

describe('gradeDaSemana', () => {
  it('a semana vai de domingo a sábado', () => {
    expect(inicioDaSemana('2026-11-24')).toBe('2026-11-22');
    expect(gradeDaSemana(escala, '2026-11-24').map((d) => d.data)).toEqual([
      '2026-11-22',
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
      '2026-11-28',
    ]);
  });
  it('o semanal só entra dentro da vigência; o noturno fica no dia em que começa; a data avulsa, na data', () => {
    const g = gradeDaSemana(escala, '2026-11-24');
    // Segunda 23/11 é antes do início da vigência: o noturno de segunda não aparece nesta semana.
    expect(g[1]!.plantoes).toEqual([]);
    // Terça: os dois plantões na ordem da hora, com o índice que a conferência usa (plantoes.2 antes de plantoes.1).
    expect(g[2]!.plantoes.map((p) => p.indice)).toEqual([2, 1]);
    expect(g[6]!.plantoes.map((p) => p.indice)).toEqual([3]);
    // Na semana seguinte o noturno de segunda aparece e a data avulsa some.
    const s = gradeDaSemana(escala, '2026-12-01');
    expect(s[1]!.plantoes.map((p) => p.indice)).toEqual([0]);
    expect(s[6]!.plantoes).toEqual([]);
  });
  it('escala inativa ou encerrada não cobre dia nenhum', () => {
    expect(gradeDaSemana({ ...escala, ativa: false }, '2026-12-01').every((d) => !d.plantoes.length)).toBe(
      true,
    );
    expect(
      gradeDaSemana({ ...escala, vigenciaFim: '2026-11-25' }, '2026-12-01').every((d) => !d.plantoes.length),
    ).toBe(true);
  });
});

describe('diasSemCobertura', () => {
  it('aponta os dias da semana sem plantão de nenhuma escala do setor', () => {
    expect(diasSemCobertura([escala], '2026-12-01')).toEqual([1, 4, 5, 6, 7]);
    const quarta: EscalaExecucao = {
      ...escala,
      id: 2,
      plantoes: [{ diaSemana: 4, data: null, inicio: '07:00', fim: '13:00', capacidade: 6 }],
    };
    expect(diasSemCobertura([escala, quarta], '2026-12-01')).toEqual([1, 5, 6, 7]);
    expect(diasSemCobertura([], '2026-12-01')).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('esperaNoDia', () => {
  const pedido = (
    pedidoEm: string,
    previstoPara: string | null = null,
    agendadoPara: string | null = null,
  ) => ({
    pedidoEm,
    previstoPara,
    agendadoPara,
  });
  it('o pedido sem horário espera no dia do pedido e no seguinte; o mais antigo vira pendência', () => {
    expect(esperaNoDia(pedido('2026-11-25'), '2026-11-25')).toBe('hoje');
    expect(esperaNoDia(pedido('2026-11-24'), '2026-11-25')).toBe('hoje');
    expect(esperaNoDia(pedido('2026-11-23'), '2026-11-25')).toBe('antigo');
    expect(esperaNoDia(pedido('2026-08-10'), '2026-11-25')).toBe('antigo');
    // A virada do mês e a janela pedida pelo setor.
    expect(esperaNoDia(pedido('2026-11-30'), '2026-12-01')).toBe('hoje');
    expect(esperaNoDia(pedido('2026-11-23'), '2026-11-25', 2)).toBe('hoje');
    expect(esperaNoDia(pedido('2026-11-24'), '2026-11-25', 0)).toBe('antigo');
  });
  it('o pedido com data prevista espera a partir dela, não a partir do pedido', () => {
    expect(esperaNoDia(pedido('2026-11-10', '2026-11-25'), '2026-11-25')).toBe('hoje');
    expect(esperaNoDia(pedido('2026-11-10', '2026-11-28'), '2026-11-25')).toBe('futuro');
    expect(esperaNoDia(pedido('2026-11-10', '2026-11-20'), '2026-11-25')).toBe('antigo');
  });
  it('o exame com horário marcado espera só no dia do horário', () => {
    expect(esperaNoDia(pedido('2026-11-10', null, '2026-11-25'), '2026-11-25')).toBe('hoje');
    expect(esperaNoDia(pedido('2026-11-25', null, '2026-11-26'), '2026-11-25')).toBe('futuro');
    // Marcado para ontem e não executado: não entra na fila de hoje pela véspera, fica como pendência.
    expect(esperaNoDia(pedido('2026-11-10', '2026-11-25', '2026-11-24'), '2026-11-25')).toBe('antigo');
  });
});
