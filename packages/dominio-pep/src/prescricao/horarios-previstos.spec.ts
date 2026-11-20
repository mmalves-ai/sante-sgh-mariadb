// Regra 11 do M24: uma linha por frequência (os casos de 2026, inclusive "sem frequência"), a grade da unidade, as
// âncoras relativas, "agora" e a virada da vigência (16:01 e 13:00).
import { describe, expect, it } from 'vitest';
import { FREQUENCIAS, frequencia, SEM_FREQUENCIA } from './catalogo.js';
import { horariosPrevistos } from './horarios-previstos.js';

const GRADE = new Map<number, readonly string[]>([
  [1, ['2200', '2200']],
  [2, ['2200', '1000']],
  [3, ['2200', '0600', '1400']],
  [4, ['1800', '0000', '0600', '1200']],
  [6, ['1800', '2200', '0200', '0600', '1000', '1400']],
  [8, ['1700', '2000', '2300', '0200', '0500', '0800', '1100', '1400']],
  [12, ['1700', '1900', '2100', '2300', '0100', '0300', '0500', '0700', '0900', '1100', '1300', '1500']],
  [24, Array.from({ length: 24 }, (_, i) => `${String((17 + i) % 24).padStart(2, '0')}00`)],
]);
const SEGUINTE = { inicio: '2026-06-20T16:01', fim: '2026-06-21T16:00' };
const f = (id: number) => frequencia(id)!;
const horas = (id: number, agora = '2026-06-20T10:00', extra = {}) =>
  horariosPrevistos({ frequencia: f(id), vigencia: SEGUINTE, agora, grade: GRADE, ...extra }).map((h) =>
    h.dataHora.slice(5),
  );

describe('horários previstos por frequência (período seguinte, prescrito às 10:00)', () => {
  it.each([
    [9, ['06-20T22:00', '06-21T06:00', '06-21T14:00']],
    [5, ['06-20T22:00', '06-21T10:00']],
    [11, ['06-20T18:00', '06-21T00:00', '06-21T06:00', '06-21T12:00']],
    [13, ['06-20T18:00', '06-20T22:00', '06-21T02:00', '06-21T06:00', '06-21T10:00', '06-21T14:00']],
    [14, 8],
    [15, 12],
    [16, 24],
    [30, ['06-20T22:00']],
    [31, ['06-20T22:00']],
    [3, ['06-20T22:00']],
    [1, ['06-20T16:01']],
    [2, ['06-20T16:01']],
    [4, ['06-20T16:01']],
    [17, ['06-20T16:01']],
    [19, ['06-20T16:01']],
  ])('frequência %s', (id, esperado) => {
    const r = horas(id as number);
    if (typeof esperado === 'number') expect(r).toHaveLength(esperado);
    else expect(r).toEqual(esperado);
  });
  it('sem frequência: uma linha no início', () => {
    expect(
      horariosPrevistos({
        frequencia: SEM_FREQUENCIA,
        vigencia: SEGUINTE,
        agora: '2026-06-20T10:00',
        grade: GRADE,
      }).map((h) => h.dataHora),
    ).toEqual(['2026-06-20T16:01']);
  });
  it('relativa: as âncoras escolhidas, com a âncora na linha', () => {
    const r = horariosPrevistos({
      frequencia: f(18),
      vigencia: SEGUINTE,
      agora: '2026-06-20T10:00',
      grade: GRADE,
      relativos: [
        { id: 1, horario: '0600' },
        { id: 7, horario: '1800' },
        { id: 13, horario: '2200' },
      ],
    });
    expect(r.map((h) => [h.dataHora.slice(5), h.relativo])).toEqual([
      ['06-20T18:00', 7],
      ['06-20T22:00', 13],
      ['06-21T06:00', 1],
    ]);
  });
  it('as 16 frequências oferecidas geram horário (a relativa, pelas âncoras escolhidas)', () => {
    expect(FREQUENCIAS).toHaveLength(16);
    for (const x of FREQUENCIAS.filter((y) => y.natureza !== 'relativa'))
      expect(horas(x.id).length).toBeGreaterThan(0);
    expect(horas(18)).toEqual([]);
  });
});

describe('período já começado e "agora"', () => {
  const ATUAL = { inicio: '2026-06-19T16:01', fim: '2026-06-20T16:00' };
  it('só os horários a partir do momento da prescrição', () => {
    const r = horariosPrevistos({
      frequencia: f(9),
      vigencia: ATUAL,
      agora: '2026-06-20T10:15',
      grade: GRADE,
    });
    expect(r.map((h) => h.dataHora)).toEqual(['2026-06-20T14:00']);
  });
  it('a critério no período começado: no minuto da prescrição', () => {
    const r = horariosPrevistos({
      frequencia: f(1),
      vigencia: ATUAL,
      agora: '2026-06-20T10:15',
      grade: GRADE,
    });
    expect(r.map((h) => h.dataHora)).toEqual(['2026-06-20T10:15']);
  });
  it('"iniciar agora" acrescenta a dose imediata (e a única fica só nela)', () => {
    const r = horariosPrevistos({
      frequencia: f(9),
      vigencia: ATUAL,
      agora: '2026-06-20T10:15',
      grade: GRADE,
      iniciarAgora: true,
    });
    expect(r.map((h) => [h.dataHora, h.agora])).toEqual([
      ['2026-06-20T10:15', true],
      ['2026-06-20T14:00', false],
    ]);
    const u = horariosPrevistos({
      frequencia: f(3),
      vigencia: ATUAL,
      agora: '2026-06-20T10:15',
      grade: GRADE,
      iniciarAgora: true,
    });
    expect(u.map((h) => h.dataHora)).toEqual(['2026-06-20T10:15']);
    const acm = horariosPrevistos({
      frequencia: f(1),
      vigencia: SEGUINTE,
      agora: '2026-06-20T10:15',
      grade: GRADE,
      iniciarAgora: true,
    });
    expect(acm.map((h) => h.dataHora)).toEqual(['2026-06-20T16:01']);
  });
  it('primeiro horário escolhido desloca a grade pelo intervalo', () => {
    const r = horariosPrevistos({
      frequencia: f(9),
      vigencia: SEGUINTE,
      agora: '2026-06-20T10:00',
      grade: GRADE,
      primeiroHorario: '18:00',
    });
    expect(r.map((h) => h.dataHora.slice(11))).toEqual(['18:00', '02:00', '10:00']);
  });
  it('vencida não gera horários; grade sem o número de doses usa o início', () => {
    expect(
      horariosPrevistos({ frequencia: f(9), vigencia: ATUAL, agora: '2026-06-20T16:01', grade: GRADE }),
    ).toEqual([]);
    expect(
      horariosPrevistos({
        frequencia: f(9),
        vigencia: SEGUINTE,
        agora: '2026-06-20T10:00',
        grade: new Map(),
      }).map((h) => h.dataHora),
    ).toEqual(['2026-06-20T16:01']);
  });
  it('virada às 13:00: 8/8 pela grade da regra 2', () => {
    const v = { inicio: '2026-06-20T13:00', fim: '2026-06-21T12:59' };
    const g = new Map<number, readonly string[]>([[3, ['1400', '2200', '0600']]]);
    const r = horariosPrevistos({ frequencia: f(9), vigencia: v, agora: '2026-06-20T08:00', grade: g });
    expect(r.map((h) => h.dataHora)).toEqual(['2026-06-20T14:00', '2026-06-20T22:00', '2026-06-21T06:00']);
  });
});
