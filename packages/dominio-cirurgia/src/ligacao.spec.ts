// Agendamento e cirurgia realizada casam por REG, sala e data (regra 9); o que não é exato vai para revisão.
import { describe, expect, it } from 'vitest';
import { casar, precisaRevisao, resumirCasamentos } from './ligacao.js';

const ag = [
  { id: 1, reg: 100, sala: 1, dia: '2026-11-03' },
  { id: 2, reg: 100, sala: 2, dia: '2026-11-04' },
  { id: 3, reg: 200, sala: 1, dia: '2026-11-03' },
  { id: 4, reg: 200, sala: 1, dia: '2026-11-03' },
];

describe('casamento agendamento × realizada', () => {
  it('exato, REG e dia, só REG, ambíguo e nenhum', () => {
    expect(casar({ id: 9, reg: 100, sala: 1, dia: '2026-11-03' }, ag)).toEqual({
      tipo: 'exato',
      agendamento: 1,
    });
    expect(casar({ id: 9, reg: 100, sala: 3, dia: '2026-11-04' }, ag)).toEqual({
      tipo: 'reg-e-dia',
      candidatos: [2],
    });
    expect(casar({ id: 9, reg: 100, sala: 3, dia: '2026-11-09' }, ag)).toEqual({
      tipo: 'so-reg',
      candidatos: [1, 2],
    });
    expect(casar({ id: 9, reg: 200, sala: 1, dia: '2026-11-03' }, ag)).toEqual({
      tipo: 'ambiguo',
      candidatos: [3, 4],
    });
    expect(casar({ id: 9, reg: 300, sala: 1, dia: '2026-11-03' }, ag)).toEqual({ tipo: 'nenhum' });
    expect(casar({ id: 9, reg: 0, sala: 1, dia: '2026-11-03' }, ag)).toEqual({ tipo: 'nenhum' });
  });
  it('resumo e revisão', () => {
    const cs = [
      casar({ id: 1, reg: 100, sala: 1, dia: '2026-11-03' }, ag),
      casar({ id: 2, reg: 100, sala: 3, dia: '2026-11-04' }, ag),
      casar({ id: 3, reg: 100, sala: 3, dia: '2026-12-01' }, ag),
      casar({ id: 4, reg: 200, sala: 1, dia: '2026-11-03' }, ag),
      casar({ id: 5, reg: 999, sala: 1, dia: '2026-11-03' }, ag),
    ];
    expect(resumirCasamentos(cs)).toEqual({ exato: 1, regEDia: 1, soReg: 1, ambiguo: 1, nenhum: 1 });
    expect(cs.filter(precisaRevisao)).toHaveLength(4);
  });
});
