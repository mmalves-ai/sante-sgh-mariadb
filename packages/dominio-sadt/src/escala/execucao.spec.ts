// 05-SADT linha 19: conferência da escala de execução, choque de horário do executante, quem executa o exame numa hora
// e a ordem da fila do setor pela prioridade do paciente. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  conferirEscala,
  conflitosDoExecutante,
  diaDaSemana,
  duracaoDoPlantao,
  type EscalaExecucao,
  executantesDoExame,
  ordenarFilaDoSetor,
  plantoesSeCruzam,
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

describe('plantão que vira a noite (setor 24 horas)', () => {
  // Tomografia de urgência: noturno de segunda (2) das 19:00 às 07:00 de terça.
  const noturno: EscalaExecucao = {
    ...base,
    id: 3,
    descricao: 'Tomografia noturno',
    plantoes: [{ diaSemana: 2, data: null, inicio: '19:00', fim: '07:00', capacidade: 8 }],
  };
  it('o noturno é aceito; fim igual ao início é o plantão de 24 horas', () => {
    expect(conferirEscala(noturno)).toEqual([]);
    expect(
      conferirEscala({
        ...base,
        plantoes: [{ diaSemana: 1, data: null, inicio: '07:00', fim: '07:00', capacidade: 30 }],
      }),
    ).toEqual([]);
    expect(duracaoDoPlantao({ inicio: '19:00', fim: '07:00' })).toBe(720);
    expect(duracaoDoPlantao({ inicio: '07:00', fim: '07:00' })).toBe(1440);
  });
  it('quem executa às 03:00 de terça é o noturno de segunda; às 07:00 de terça já não; a véspera fora da vigência não vale', () => {
    // 2026-11-02 é segunda; 2026-11-03, terça.
    expect(executantesDoExame([noturno], 10, 505, '2026-11-03', '03:00').map((e) => e.id)).toEqual([3]);
    expect(executantesDoExame([noturno], 10, 505, '2026-11-02', '23:30').map((e) => e.id)).toEqual([3]);
    expect(executantesDoExame([noturno], 10, 505, '2026-11-03', '07:00')).toEqual([]);
    expect(executantesDoExame([noturno], 10, 505, '2026-11-02', '03:00')).toEqual([]);
    // A escala começa na terça: o noturno de segunda (que começou antes da vigência) não cobre a madrugada de terça.
    expect(
      executantesDoExame([{ ...noturno, vigenciaInicio: '2026-11-03' }], 10, 505, '2026-11-03', '03:00'),
    ).toEqual([]);
  });
  it('o noturno conflita com a manhã do dia seguinte que começa antes do fim dele, e o de sábado chega ao domingo', () => {
    const manhaTerca = { diaSemana: 3, data: null, inicio: '06:00', fim: '12:00', capacidade: 1 };
    expect(plantoesSeCruzam(noturno.plantoes[0]!, manhaTerca)).toBe(true);
    expect(plantoesSeCruzam(noturno.plantoes[0]!, { ...manhaTerca, inicio: '07:00' })).toBe(false);
    const sabado = { diaSemana: 7, data: null, inicio: '22:00', fim: '06:00', capacidade: 1 };
    expect(plantoesSeCruzam(sabado, { ...manhaTerca, diaSemana: 1, inicio: '05:00' })).toBe(true);
    // Data avulsa na madrugada de terça (2026-11-03) cruza o noturno semanal de segunda.
    expect(
      plantoesSeCruzam(noturno.plantoes[0]!, {
        diaSemana: null,
        data: '2026-11-03',
        inicio: '02:00',
        fim: '04:00',
        capacidade: 1,
      }),
    ).toBe(true);
    // A mesma escala recusa o noturno que invade a manhã seguinte.
    expect(
      conferirEscala({ ...noturno, plantoes: [noturno.plantoes[0]!, manhaTerca] }).map((x) => x.mensagem),
    ).toContain('O plantão se sobrepõe ao plantão 1 da mesma escala.');
  });
  it('a data avulsa da outra escala só conflita com o semanal da nova dentro da vigência da nova', () => {
    const avulsa: EscalaExecucao = {
      ...base,
      id: 4,
      setor: 11,
      descricao: 'Mutirão de segunda',
      vigenciaInicio: '2026-10-01',
      vigenciaFim: null,
      plantoes: [{ diaSemana: null, data: '2026-10-26', inicio: '08:00', fim: '10:00', capacidade: 5 }],
    };
    // A nova (base) começa em 2026-11-01: a segunda 2026-10-26 da outra escala fica fora dela, sem conflito falso.
    expect(conflitosDoExecutante(base, [avulsa])).toEqual([]);
    const dentroDaVigencia = {
      ...avulsa,
      plantoes: [{ diaSemana: null, data: '2026-11-09', inicio: '08:00', fim: '10:00', capacidade: 5 }],
    };
    expect(conflitosDoExecutante(base, [dentroDaVigencia])).toEqual([
      { escala: 4, descricao: 'Mutirão de segunda', plantao: 0 },
    ]);
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
