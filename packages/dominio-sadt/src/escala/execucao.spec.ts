// 05-SADT linha 19: conferência da escala de execução, choque de horário do executante, quem executa o exame numa hora
// e a ordem da fila do setor pela prioridade do paciente. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  conferirEscala,
  conflitosDoExecutante,
  diaDaSemana,
  type EscalaExecucao,
  executantesDoExame,
  ordenarFilaDoSetor,
} from './execucao.js';

const base: EscalaExecucao = {
  id: 1,
  setor: 10,
  profissional: 7,
  recurso: null,
  descricao: 'Ultrassom manhã',
  vigenciaInicio: '2026-11-01',
  vigenciaFim: null,
  plantoes: [{ diaSemana: 2, data: null, inicio: '07:00', fim: '12:00', capacidade: 12 }],
  exames: [{ exame: 505, limitePorTurno: 10, grupoPrioridade: 1, vagasReservadas: 2 }],
};

describe('conferirEscala', () => {
  it('escala completa: nenhum problema', () => {
    expect(conferirEscala(base)).toEqual([]);
  });
  it('devolve todos os problemas de uma vez, cada um no seu campo', () => {
    const p = conferirEscala({
      ...base,
      profissional: null,
      descricao: 'x',
      vigenciaFim: '2026-10-01',
      plantoes: [
        { diaSemana: 2, data: '2026-11-03', inicio: '12:00', fim: '07:00', capacidade: 0 },
        { diaSemana: 9, data: null, inicio: '07:00', fim: '08:00', capacidade: 1 },
      ],
      exames: [
        { exame: 1, limitePorTurno: 2, grupoPrioridade: null, vagasReservadas: 3 },
        { exame: 1, limitePorTurno: 0, grupoPrioridade: null, vagasReservadas: 0 },
      ],
    }).map((x) => x.campo);
    expect(p).toEqual(
      expect.arrayContaining([
        'executante',
        'descricao',
        'vigenciaFim',
        'plantoes.0',
        'plantoes.1',
        'exames.0',
        'exames.1',
      ]),
    );
  });
  it('plantões da mesma escala que se sobrepõem são recusados; o avulso fora da vigência também', () => {
    const p = conferirEscala({
      ...base,
      vigenciaFim: '2026-11-30',
      plantoes: [
        { diaSemana: 2, data: null, inicio: '07:00', fim: '12:00', capacidade: 5 },
        { diaSemana: null, data: '2026-11-02', inicio: '11:00', fim: '13:00', capacidade: 5 },
        { diaSemana: null, data: '2026-12-07', inicio: '07:00', fim: '08:00', capacidade: 5 },
      ],
    });
    expect(diaDaSemana('2026-11-02')).toBe(2);
    expect(p.map((x) => x.mensagem)).toEqual(
      expect.arrayContaining([
        'O plantão se sobrepõe ao plantão 1 da mesma escala.',
        'A data do plantão fica fora da vigência da escala.',
      ]),
    );
  });
});

describe('conflitosDoExecutante', () => {
  it('o mesmo profissional em outro setor no mesmo horário conflita; horário encostado, inativa ou fora da vigência não', () => {
    const outra = (m: Partial<EscalaExecucao>): EscalaExecucao => ({ ...base, id: 2, setor: 11, ...m });
    expect(conflitosDoExecutante(base, [outra({})])).toEqual([
      { escala: 2, descricao: 'Ultrassom manhã', plantao: 0 },
    ]);
    const encostada = outra({
      plantoes: [{ diaSemana: 2, data: null, inicio: '12:00', fim: '18:00', capacidade: 1 }],
    });
    expect(conflitosDoExecutante(base, [encostada])).toEqual([]);
    expect(conflitosDoExecutante(base, [outra({ ativa: false })])).toEqual([]);
    expect(conflitosDoExecutante(base, [outra({ profissional: 8 })])).toEqual([]);
    expect(
      conflitosDoExecutante({ ...base, vigenciaFim: '2026-11-30' }, [
        outra({ vigenciaInicio: '2026-12-01' }),
      ]),
    ).toEqual([]);
    // A própria escala (edição) não conflita com ela mesma.
    expect(conflitosDoExecutante(base, [base])).toEqual([]);
  });
});

describe('executantesDoExame', () => {
  it('acha a escala vigente com plantão cobrindo a hora, só do setor e do exame', () => {
    expect(executantesDoExame([base], 10, 505, '2026-11-02', '08:30').map((e) => e.id)).toEqual([1]);
    expect(executantesDoExame([base], 10, 505, '2026-11-02', '12:00')).toEqual([]);
    expect(executantesDoExame([base], 10, 505, '2026-11-03', '08:30')).toEqual([]);
    expect(executantesDoExame([base], 11, 505, '2026-11-02', '08:30')).toEqual([]);
    expect(executantesDoExame([base], 10, 999, '2026-11-02', '08:30')).toEqual([]);
    expect(executantesDoExame([base], 10, 505, '2026-10-26', '08:30')).toEqual([]);
  });
});

describe('ordenarFilaDoSetor', () => {
  it('urgência, depois a prioridade legal (menor ordem antes), depois a chegada', () => {
    const f = ordenarFilaDoSetor([
      { id: 1, urgente: false, ordemPrioridade: null, chegada: '2026-11-24T07:00:00Z' },
      { id: 2, urgente: false, ordemPrioridade: 2, chegada: '2026-11-24T07:30:00Z' },
      { id: 3, urgente: true, ordemPrioridade: null, chegada: '2026-11-24T08:00:00Z' },
      { id: 4, urgente: false, ordemPrioridade: 1, chegada: '2026-11-24T07:45:00Z' },
      { id: 5, urgente: false, ordemPrioridade: 2, chegada: '2026-11-24T07:10:00Z' },
    ]);
    expect(f.map((x) => x.id)).toEqual([3, 4, 5, 2, 1]);
  });
});
