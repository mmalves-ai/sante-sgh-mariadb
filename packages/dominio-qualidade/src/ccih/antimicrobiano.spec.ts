// Regra 6 do M48 (antimicrobiano): prazo da política, situação da liberação e alerta (sem suspender), revisões do 3º e
// do 7º dia, DDD e DOT por 1.000 pacientes-dia com as parcelas. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  conferirRevisao,
  consumoAntimicrobianos,
  dddDoItem,
  diasDeTerapia,
  prazoDaPolitica,
  revisaoDevida,
  situacaoDaLiberacao,
} from './antimicrobiano.js';

describe('liberação do restrito', () => {
  it('prazo da política entre 24 e 48 h; fora disso, 48', () => {
    expect(prazoDaPolitica(24)).toBe(24);
    expect(prazoDaPolitica(36)).toBe(36);
    expect(prazoDaPolitica(12)).toBe(48);
    expect(prazoDaPolitica(72)).toBe(48);
    expect(prazoDaPolitica(30.5)).toBe(48);
    expect(prazoDaPolitica(null)).toBe(48);
    expect(prazoDaPolitica(undefined)).toBe(48);
  });
  it('aguardando no prazo; vencida com alerta; decidido sai da fila', () => {
    const base = { prescritoEm: '2026-10-20T10:00:00', prazoHoras: 24 };
    expect(situacaoDaLiberacao({ ...base, agora: '2026-10-21T09:00:00', decisao: null })).toEqual({
      situacao: 'aguardando',
      venceEm: '2026-10-21T10:00:00',
      alerta: false,
    });
    expect(situacaoDaLiberacao({ ...base, agora: '2026-10-21T10:00:01', decisao: null })).toMatchObject({
      situacao: 'vencida',
      alerta: true,
    });
    expect(
      situacaoDaLiberacao({ ...base, agora: '2026-10-25T10:00', decisao: 'liberadoComAjuste' }).situacao,
    ).toBe('liberado');
    expect(situacaoDaLiberacao({ ...base, agora: '2026-10-25T10:00', decisao: 'naoLiberado' })).toMatchObject(
      {
        situacao: 'naoLiberado',
        alerta: false,
      },
    );
  });
});

describe('revisões do 3º e do 7º dia', () => {
  const base = { inicio: '2026-10-20', diasAutorizados: 10, feitas: { d3: false, d7: false } };
  it('nada antes do 3º dia; d3 no dia 3; atrasada depois', () => {
    expect(revisaoDevida({ ...base, agora: '2026-10-21T10:00' })).toBeNull();
    expect(revisaoDevida({ ...base, agora: '2026-10-22T10:00' })).toEqual({
      marco: 'd3',
      devidaEm: '2026-10-22',
      atrasada: false,
    });
    expect(revisaoDevida({ ...base, agora: '2026-10-24T10:00' })?.atrasada).toBe(true);
  });
  it('d7 depois do d3 feito; não devida se a liberação não chega ao 7º dia', () => {
    expect(
      revisaoDevida({ ...base, feitas: { d3: true, d7: false }, agora: '2026-10-26T10:00' }),
    ).toMatchObject({
      marco: 'd7',
      devidaEm: '2026-10-26',
    });
    expect(
      revisaoDevida({
        ...base,
        diasAutorizados: 5,
        feitas: { d3: true, d7: false },
        agora: '2026-10-28T10:00',
      }),
    ).toBeNull();
    expect(
      revisaoDevida({ ...base, diasAutorizados: null, feitas: { d3: true, d7: true }, agora: '2026-11-28' }),
    ).toBeNull();
  });
  it('conferência da revisão pedida', () => {
    const feitas = { d3: true, d7: false };
    expect(conferirRevisao({ marco: 'd3', inicio: '2026-10-20', agora: '2026-10-23', feitas })).toBe(
      'revisao-ja-feita',
    );
    expect(conferirRevisao({ marco: 'd7', inicio: '2026-10-20', agora: '2026-10-25', feitas })).toBe(
      'revisao-antes-do-dia',
    );
    expect(conferirRevisao({ marco: 'd7', inicio: '2026-10-20', agora: '2026-10-26', feitas })).toBeNull();
    expect(
      conferirRevisao({
        marco: 'd3',
        inicio: '2026-10-20',
        agora: '2026-10-22',
        feitas: { d3: false, d7: false },
      }),
    ).toBeNull();
  });
});

describe('DDD e DOT', () => {
  it('DDD do item: unidades × gramas ÷ DDD; sem configuração, nulo', () => {
    // Ceftriaxona 1 g por frasco, DDD 2 g: 30 frascos = 15 DDD.
    expect(dddDoItem(30, 1, 2)).toBe(15);
    expect(dddDoItem(10, 0.5, 3)).toBe(1.67);
    expect(dddDoItem(10, null, 2)).toBeNull();
    expect(dddDoItem(10, 1, null)).toBeNull();
    expect(dddDoItem(10, 1, 0)).toBeNull();
  });
  it('DOT: dias distintos por paciente, só na competência, um por antimicrobiano', () => {
    const dot = diasDeTerapia(
      [
        { paciente: 1, item: 10, de: '2026-09-29T08:00', ate: '2026-10-03T08:00' },
        // Prescrição seguinte do mesmo item sobreposta: os dias não contam duas vezes.
        { paciente: 1, item: 10, de: '2026-10-03T08:00', ate: '2026-10-04T08:00' },
        { paciente: 2, item: 10, de: '2026-10-10T08:00', ate: '2026-10-10T20:00' },
        { paciente: 1, item: 20, de: '2026-10-01T08:00', ate: '2026-10-02T08:00' },
        // Vigência invertida (dado ruim) não conta.
        { paciente: 3, item: 20, de: '2026-10-05T08:00', ate: '2026-10-04T08:00' },
      ],
      '2026-10',
    );
    expect(dot.get(10)).toBe(5);
    expect(dot.get(20)).toBe(2);
  });
  it('consumo com as parcelas; item sem DDD à parte; item só com DOT entra pelo nome provisório', () => {
    const c = consumoAntimicrobianos({
      itens: [
        {
          item: 10,
          nome: 'Ceftriaxona 1 g',
          atc: 'J01DD04',
          unidades: 30,
          dddGramas: 2,
          gramasPorUnidade: 1,
        },
        { item: 30, nome: 'Meropeném 1 g', atc: 'J01DH02', unidades: 12, dddGramas: 3, gramasPorUnidade: 1 },
        { item: 20, nome: 'Amicacina', atc: null, unidades: 5, dddGramas: null, gramasPorUnidade: null },
      ],
      dot: new Map([
        [10, 12],
        [20, 4],
        [40, 2],
      ]),
      pacientesDia: 500,
    });
    expect(c.itens.map((i) => [i.item, i.ddd, i.diasTerapia])).toEqual([
      [10, 15, 12],
      [30, 4, 0],
    ]);
    expect(c.semDdd.map((i) => [i.item, i.nome])).toEqual([
      [20, 'Amicacina'],
      [40, 'Item 40'],
    ]);
    expect(c.dddPorMilPacientesDia).toEqual({ numerador: 19, denominador: 500, fator: 1000, valor: 38 });
    expect(c.dotPorMilPacientesDia).toEqual({ numerador: 18, denominador: 500, fator: 1000, valor: 36 });
  });
});
