// Regra 5 do M53: exportação de ponto pelos 13 tipos de integração da folha e pelos tipos de hora da apuração
// (POTPHORA), a partir do período fechado pelo M52.
import { describe, expect, it } from 'vitest';
import { eventosDoFechamento, exportarEventosPonto, horasDoFechamento } from './exportacao.js';

const TODOS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);

describe('exportarEventosPonto (regra 5)', () => {
  it('um evento por vínculo e tipo de integração, em ordem, sem os zerados', () => {
    const r = exportarEventosPonto(
      [
        { vinculo: 9, eventos: { '1': 600, '10': 120, '3': 0 } },
        { vinculo: 2, eventos: { '5': 30, '1': 480 } },
      ],
      TODOS,
    );
    expect(r.eventos).toEqual([
      { vinculo: 2, evento: 1, minutos: 480 },
      { vinculo: 2, evento: 5, minutos: 30 },
      { vinculo: 9, evento: 1, minutos: 600 },
      { vinculo: 9, evento: 10, minutos: 120 },
    ]);
    expect(r.minutosFechados).toBe(1230);
    expect(r.minutosExportados).toBe(1230);
    expect(r.semFechamento).toEqual([]);
    expect(r.indisponiveis).toEqual([]);
  });

  it('o vínculo sem período fechado vira pendência (nenhum evento dele)', () => {
    const r = exportarEventosPonto(
      [
        { vinculo: 7, eventos: null },
        { vinculo: 3, eventos: null },
        { vinculo: 1, eventos: { '1': 60 } },
      ],
      TODOS,
    );
    expect(r.semFechamento).toEqual([3, 7]);
    expect(r.eventos).toHaveLength(1);
  });

  it('tipo de integração não cadastrado ou fora dos 13 vira pendência, e a soma mostra a diferença', () => {
    const r = exportarEventosPonto(
      [
        { vinculo: 1, eventos: { '1': 60, '12': 30, '99': 5 } },
        { vinculo: 2, eventos: { '12': 10 } },
      ],
      new Set([1, 2, 3]),
    );
    expect(r.indisponiveis).toEqual([
      { evento: 12, vinculos: [1, 2] },
      { evento: 99, vinculos: [1] },
    ]);
    expect(r.minutosFechados).toBe(105);
    expect(r.minutosExportados).toBe(60);
  });

  it('minutos negativos ou fracionários são erro de programação', () => {
    expect(() => exportarEventosPonto([{ vinculo: 1, eventos: { '1': -1 } }], TODOS)).toThrow(RangeError);
    expect(() => exportarEventosPonto([{ vinculo: 1, eventos: { '1': 1.5 } }], TODOS)).toThrow(RangeError);
  });
});

describe('eventosDoFechamento', () => {
  it('lê os eventos do TOTAIS do fechamento', () => {
    expect(eventosDoFechamento(JSON.stringify({ classes: { 1: 10 }, eventos: { 1: 10, 5: 2 } }))).toEqual({
      '1': 10,
      '5': 2,
    });
  });

  it('ausente, ilegível ou sem eventos: null', () => {
    expect(eventosDoFechamento(null)).toBeNull();
    expect(eventosDoFechamento('{')).toBeNull();
    expect(eventosDoFechamento('{"classes":{}}')).toBeNull();
    expect(eventosDoFechamento('{"eventos":[1]}')).toBeNull();
    expect(eventosDoFechamento('{"eventos":{"1":"x","2":3}}')).toEqual({ '2': 3 });
  });
  it('os tipos de hora (POTPHORA) do fechamento: um por vínculo e tipo, em ordem, sem os zerados; fora da soma', () => {
    const r = exportarEventosPonto(
      [
        { vinculo: 9, eventos: { '1': 600 }, horas: { '5': 60, '1': 540, '2': 0 } },
        { vinculo: 2, eventos: { '1': 480 }, horas: { '1': 480 } },
        { vinculo: 4, eventos: null, horas: { '1': 30 } },
        { vinculo: 3, eventos: { '1': 10 } },
      ],
      TODOS,
    );
    expect(r.horas).toEqual([
      { vinculo: 2, tipoHora: 1, minutos: 480 },
      { vinculo: 9, tipoHora: 1, minutos: 540 },
      { vinculo: 9, tipoHora: 5, minutos: 60 },
    ]);
    expect(r.minutosExportados).toBe(1090);
    expect(() =>
      exportarEventosPonto([{ vinculo: 1, eventos: { '1': 1 }, horas: { '10': 1 } }], TODOS),
    ).toThrow(RangeError);
    expect(() =>
      exportarEventosPonto([{ vinculo: 1, eventos: { '1': 1 }, horas: { '1': -1 } }], TODOS),
    ).toThrow(RangeError);
  });

  it('lê os tipos de hora gravados no fechamento (classes); ilegível ou ausente: null', () => {
    expect(
      horasDoFechamento(JSON.stringify({ classes: { '1': 480, '2': 15 }, eventos: { '1': 480 } })),
    ).toEqual({
      '1': 480,
      '2': 15,
    });
    expect(horasDoFechamento(JSON.stringify({ eventos: { '1': 1 } }))).toBeNull();
    expect(horasDoFechamento('{')).toBeNull();
    expect(horasDoFechamento(null)).toBeNull();
  });
});
