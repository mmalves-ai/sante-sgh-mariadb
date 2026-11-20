// Regra 13 do M52: apuração com o previsto da escala, as horas classificadas pelos tipos do domínio de horas do ramo e
// somadas pelos 13 tipos de integração com a folha. Dias sintéticos com as PARCELAS escritas em cada caso.
import { describe, expect, it } from 'vitest';
import type { MarcacaoEfetiva } from './ajuste.js';
import {
  agruparJornadas,
  apurarPeriodo,
  type EntradaApuracao,
  extrasDosEventos,
  horaNoturnaReduzida,
  noturnoDoPar,
  porFaixas,
  type RegrasApuracao,
} from './apuracao.js';

const REGRAS: RegrasApuracao = {
  toleranciaMarcacaoMin: 5,
  toleranciaDiariaMin: 10,
  noturnoInicio: 22 * 60,
  noturnoFim: 5 * 60,
  prorrogacaoNoturna: true,
  janelaMarcacaoMin: 240,
  limiteExtraDiarioMin: 120,
  faixas: [120],
  feriadoCompensado: false,
  intervaloPreAssinalado: true,
  dsrMin: 720,
  descansoMinimoMin: 36 * 60,
};
let seq = 0;
const mk = (...instantes: string[]): MarcacaoEfetiva[] =>
  instantes.map((instante) => ({ id: ++seq, instante, fonte: 'O', ajuste: null, desconsiderada: false }));
const dia12h = (d: string, id = 1) => ({ id, inicio: `${d}T07:00`, fim: `${d}T19:00` });
const noite = (d: string, prox: string, id = 2) => ({ id, inicio: `${d}T19:00`, fim: `${prox}T07:00` });
const entrada = (x: Partial<EntradaApuracao>): EntradaApuracao => ({
  dias: ['2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07'],
  plantoes: [],
  marcacoes: [],
  justificativas: [],
  feriados: new Set(),
  regras: REGRAS,
  ...x,
});
const dia = (r: ReturnType<typeof apurarPeriodo>, d: string) => r.dias.find((x) => x.dia === d)!;

describe('apuração (regra 13)', () => {
  it('plantão cumprido dentro da tolerância: 720 trabalhadas; 3 + 2 = 5 min tolerados (≤ 5 por marcação, ≤ 10 no dia)', () => {
    const r = apurarPeriodo(
      entrada({ plantoes: [dia12h('2026-09-02')], marcacoes: mk('2026-09-02T07:03', '2026-09-02T18:58') }),
    );
    const d = dia(r, '2026-09-02');
    // previsto 07:00–19:00 = 720; dentro = 18:58 − 07:03 = 715; débito 5 → tolerado (variações 3 e 2).
    expect(d.minutos).toMatchObject({ 1: 715, 2: 0, 5: 0, 9: 5 });
    expect(r.eventos[1]).toBe(715);
    expect(r.eventos[4]).toBe(0);
  });

  it('passou da tolerância conta TUDO: atraso de 6 min + saída 4 min depois = 6 de débito e 4 de extra', () => {
    const r = apurarPeriodo(
      entrada({ plantoes: [dia12h('2026-09-02')], marcacoes: mk('2026-09-02T07:06', '2026-09-02T19:04') }),
    );
    const d = dia(r, '2026-09-02');
    // dentro = 19:00 − 07:06 = 714 → débito 720 − 714 = 6; extra = (19:04 − 07:06) − 714 = 718 − 714 = 4;
    // trabalhadas = 718 − 4 = 714.
    expect(d.minutos).toMatchObject({ 1: 714, 2: 6, 5: 4, 9: 0 });
    expect(r.eventos).toMatchObject({ 1: 714, 4: 6, 10: 4, 11: 0 });
  });

  it('horas extras por faixa: saída 3 h depois = 120 na 1ª faixa + 60 na 2ª; alerta acima de 2 h', () => {
    const r = apurarPeriodo(
      entrada({ plantoes: [dia12h('2026-09-02')], marcacoes: mk('2026-09-02T07:00', '2026-09-02T22:00') }),
    );
    const d = dia(r, '2026-09-02');
    expect(d.minutos[5]).toBe(180);
    expect(r.eventos[10]).toBe(120);
    expect(r.eventos[11]).toBe(60);
    expect(d.alertas).toContain('extra-acima-do-limite');
    expect(extrasDosEventos(r.eventos)).toBe(180);
  });

  it('plantão noturno que vira o dia: 7 h de noite (22 h–5 h) + 2 h de prorrogação = 540 → 617 reduzidas', () => {
    const r = apurarPeriodo(
      entrada({
        plantoes: [noite('2026-09-02', '2026-09-03')],
        marcacoes: mk('2026-09-02T19:00', '2026-09-03T07:00'),
      }),
    );
    const d = dia(r, '2026-09-02');
    // 22:00–05:00 = 420 min; prorrogação (Súmula 60) 05:00–07:00 = 120; total 540; 540 × 60 / 52,5 = 617,14 → 617.
    expect(d.noturnoMin).toBe(540);
    expect(d.noturnoReduzidoMin).toBe(617);
    expect(r.eventos[5]).toBe(617);
    expect(dia(r, '2026-09-03').jornadas).toHaveLength(0);
  });

  it('falta, falta abonada pelo dia inteiro e abono parcial; DSR descontado uma vez na semana com falta não abonada', () => {
    const r = apurarPeriodo(
      entrada({
        plantoes: [dia12h('2026-09-02', 1), dia12h('2026-09-04', 2), dia12h('2026-09-06', 3)],
        marcacoes: mk('2026-09-06T08:00', '2026-09-06T19:00'),
        justificativas: [
          { dia: '2026-09-04', movimento: 7, minutos: null },
          { dia: '2026-09-06', movimento: 8, minutos: 30 },
        ],
      }),
    );
    expect(dia(r, '2026-09-02').minutos).toMatchObject({ 7: 720, 8: 0 });
    expect(dia(r, '2026-09-04').minutos).toMatchObject({ 7: 0, 8: 720 });
    expect(dia(r, '2026-09-04').justificativa).toBe(7);
    // dia 6: atraso de 60; abono de 30 → débito 30.
    expect(dia(r, '2026-09-06').minutos[2]).toBe(30);
    expect(dia(r, '2026-09-06').abonadoMin).toBe(30);
    // semana de 31/08 a 06/09 com a falta do dia 2: um DSR de 720.
    expect(r.semanasDsr).toEqual(['2026-08-31']);
    expect(r.eventos).toMatchObject({ 2: 720, 3: 720, 4: 30 });
  });

  it('falta abonada em parte pelos minutos', () => {
    const r = apurarPeriodo(
      entrada({
        plantoes: [dia12h('2026-09-02')],
        justificativas: [{ dia: '2026-09-02', movimento: 8, minutos: 240 }],
      }),
    );
    expect(dia(r, '2026-09-02').minutos).toMatchObject({ 7: 480, 8: 240 });
  });

  it('justificativa do dia inteiro zera o débito do dia trabalhado', () => {
    const r = apurarPeriodo(
      entrada({
        plantoes: [dia12h('2026-09-02')],
        marcacoes: mk('2026-09-02T09:00', '2026-09-02T19:00'),
        justificativas: [{ dia: '2026-09-02', movimento: 7, minutos: null }],
      }),
    );
    expect(dia(r, '2026-09-02').minutos[2]).toBe(0);
    expect(dia(r, '2026-09-02').abonadoMin).toBe(120);
  });

  it('feriado trabalhado é extra de feriado; com o regime compensado (12x36) é jornada normal', () => {
    const base = {
      plantoes: [dia12h('2026-09-07')],
      marcacoes: mk('2026-09-07T07:00', '2026-09-07T19:00'),
      feriados: new Set(['2026-09-07']),
    };
    const r = apurarPeriodo(entrada(base));
    expect(dia(r, '2026-09-07').minutos).toMatchObject({ 1: 0, 4: 720 });
    expect(r.eventos).toMatchObject({ 6: 120, 7: 600 });
    const c = apurarPeriodo(entrada({ ...base, regras: { ...REGRAS, feriadoCompensado: true } }));
    expect(dia(c, '2026-09-07').minutos).toMatchObject({ 1: 720, 4: 0 });
  });

  it('trabalho sem plantão na escala: extra de descanso semanal (ou de feriado), com o alerta', () => {
    const r = apurarPeriodo(
      entrada({
        marcacoes: mk('2026-09-05T08:00', '2026-09-05T12:00', '2026-09-07T08:00', '2026-09-07T09:00'),
        feriados: new Set(['2026-09-07']),
      }),
    );
    expect(dia(r, '2026-09-05').minutos[3]).toBe(240);
    expect(dia(r, '2026-09-05').alertas).toContain('sem-escala');
    expect(dia(r, '2026-09-07').minutos[4]).toBe(60);
    expect(r.eventos).toMatchObject({ 8: 120, 9: 120, 6: 60 });
  });

  it('marcação ímpar é inconsistência (o período não fecha); a marcação desconsiderada não conta', () => {
    const ms = mk('2026-09-02T07:00', '2026-09-02T07:01', '2026-09-02T19:00');
    const r = apurarPeriodo(entrada({ plantoes: [dia12h('2026-09-02')], marcacoes: ms }));
    expect(dia(r, '2026-09-02').inconsistencias).toEqual(['marcacao-impar']);
    expect(dia(r, '2026-09-02').jornadas[0]?.semPar).toBe('2026-09-02T19:00');
    expect(r.diasInconsistentes).toBe(1);
    const ok = apurarPeriodo(
      entrada({
        plantoes: [dia12h('2026-09-02')],
        marcacoes: ms.map((m, i) => (i === 1 ? { ...m, desconsiderada: true } : m)),
      }),
    );
    expect(dia(ok, '2026-09-02').inconsistencias).toEqual([]);
    expect(dia(ok, '2026-09-02').minutos[1]).toBe(720);
    const so1 = apurarPeriodo(
      entrada({ plantoes: [dia12h('2026-09-02')], marcacoes: mk('2026-09-02T07:00') }),
    );
    expect(dia(so1, '2026-09-02').minutos[1]).toBe(0);
  });

  it('intervalo não pré-assinalado: 4 marcações com 30 min de intervalo pagam 30 min (art. 71, §4º)', () => {
    const r = apurarPeriodo(
      entrada({
        plantoes: [dia12h('2026-09-02')],
        marcacoes: mk('2026-09-02T07:00', '2026-09-02T12:00', '2026-09-02T12:30', '2026-09-02T19:00'),
        regras: { ...REGRAS, intervaloPreAssinalado: false },
      }),
    );
    const d = dia(r, '2026-09-02');
    // trabalhado = 300 + 390 = 690; intervalo = 720 − 690 = 30 → 60 − 30 = 30 na classe 6 (vai à 1ª faixa).
    expect(d.jornadas[0]?.intervaloMin).toBe(30);
    expect(d.minutos[6]).toBe(30);
    expect(r.eventos[10]).toBe(30);
  });

  it('descanso entre jornadas menor que o do regime gera o alerta', () => {
    const r = apurarPeriodo(
      entrada({
        plantoes: [dia12h('2026-09-02', 1), dia12h('2026-09-03', 2)],
        marcacoes: mk('2026-09-02T07:00', '2026-09-02T19:00', '2026-09-03T07:00', '2026-09-03T19:00'),
      }),
    );
    expect(dia(r, '2026-09-03').alertas).toContain('interjornada-menor');
  });

  it('a marcação vai ao plantão mais próximo dentro da janela; fora dela é jornada sem escala', () => {
    const g = agruparJornadas(
      [dia12h('2026-09-02', 1), noite('2026-09-02', '2026-09-03', 2)],
      mk('2026-09-02T18:50', '2026-09-03T06:00', '2026-09-04T03:00', '2026-09-04T22:00'),
      240,
    );
    expect(g.find((x) => x.plantao?.id === 1)?.marcas).toHaveLength(1);
    expect(g.find((x) => x.plantao?.id === 2)?.marcas).toHaveLength(1);
    const soltas = g.filter((x) => x.plantao === null);
    expect(soltas.map((x) => x.dia)).toEqual(['2026-09-04', '2026-09-04']);
  });

  it('auxiliares: noturno sem prorrogação, hora reduzida, faixas', () => {
    expect(noturnoDoPar(23 * 60, 26 * 60, { ...REGRAS, prorrogacaoNoturna: false })).toBe(180);
    expect(horaNoturnaReduzida(420)).toBe(480);
    expect(porFaixas(300, [120, 60], 4)).toEqual([120, 60, 120, 0]);
    expect(porFaixas(0, [120], 2)).toEqual([0, 0]);
    expect(porFaixas(300, [120, 60, 60], 4)).toEqual([120, 60, 60, 60]);
  });
});
