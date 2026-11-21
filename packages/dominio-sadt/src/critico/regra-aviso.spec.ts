import { describe, expect, it } from 'vitest';
import {
  alvosDoAviso,
  avisoDoAlvo,
  escolherRegraCritico,
  PRAZO_PADRAO_AVISO_CRITICO_MINUTOS,
  prazoDoAviso,
  type RegraCriticoCandidata,
} from './regra-aviso.js';

const r = (
  id: number,
  estabelecimento: number | null,
  analito: number | null,
  exame: number | null,
  prazo = 15,
) => ({ id, estabelecimento, analito, exame, prazoMinutos: prazo }) satisfies RegraCriticoCandidata;
const alvo = { estabelecimento: 7, exame: 100, analito: 50 };

describe('regra do aviso de valor crítico', () => {
  it('a regra da unidade vale antes da regra da rede', () => {
    expect(escolherRegraCritico([r(1, null, 50, null), r(2, 7, 50, null)], alvo)?.id).toBe(2);
    expect(escolherRegraCritico([r(2, 7, 50, null), r(1, null, 50, null)], alvo)?.id).toBe(2);
  });
  it('a regra do analito vale antes da regra do exame, na mesma abrangência', () => {
    expect(escolherRegraCritico([r(1, 7, null, 100), r(2, 7, 50, null)], alvo)?.id).toBe(2);
    expect(escolherRegraCritico([r(1, null, null, 100), r(2, null, 50, null)], alvo)?.id).toBe(2);
  });
  it('a unidade pesa mais que o analito: a regra do exame da unidade vence a do analito da rede', () => {
    expect(escolherRegraCritico([r(1, null, 50, null), r(2, 7, null, 100)], alvo)?.id).toBe(2);
  });
  it('empate: a regra mais recente', () => {
    expect(escolherRegraCritico([r(3, 7, 50, null), r(9, 7, 50, null)], alvo)?.id).toBe(9);
  });
  it('ignora regra de outra unidade, de outro analito e de outro exame', () => {
    expect(escolherRegraCritico([r(1, 8, 50, null), r(2, 7, 51, null), r(3, 7, null, 101)], alvo)).toBeNull();
  });
  it('alvo do exame (sem analito) só aceita regra do exame', () => {
    const doExame = { ...alvo, analito: null };
    expect(escolherRegraCritico([r(1, 7, 50, null), r(2, null, null, 100)], doExame)?.id).toBe(2);
  });
  it('prazo: o da regra, ou o padrão sem regra', () => {
    expect(prazoDoAviso(r(1, 7, 50, null, 12))).toBe(12);
    expect(prazoDoAviso(null)).toBe(PRAZO_PADRAO_AVISO_CRITICO_MINUTOS);
    expect(prazoDoAviso({ ...r(1, 7, 50, null), prazoMinutos: null })).toBe(
      PRAZO_PADRAO_AVISO_CRITICO_MINUTOS,
    );
  });
  it('o aviso do alvo: regra, prazo e instante-limite', () => {
    const g = new Date('2026-11-21T10:00:00.000Z');
    expect(avisoDoAlvo([r(4, 7, 50, null, 20)], alvo, g)).toEqual({
      regra: 4,
      prazoMinutos: 20,
      prazoEm: new Date('2026-11-21T10:20:00.000Z'),
    });
    expect(avisoDoAlvo([], alvo, g)).toEqual({
      regra: null,
      prazoMinutos: 30,
      prazoEm: new Date('2026-11-21T10:30:00.000Z'),
    });
  });
  it('alvos: um por analito crítico, ou um do exame; o já avisado não se repete', () => {
    const crit = [
      { analito: 50, resultadoAnalito: 500 },
      { analito: 51, resultadoAnalito: 501 },
    ];
    expect(alvosDoAviso(crit, true, new Set())).toHaveLength(2);
    expect(alvosDoAviso(crit, true, new Set([500]))).toEqual([{ analito: 51, resultadoAnalito: 501 }]);
    expect(alvosDoAviso([], true, new Set())).toEqual([{ analito: null, resultadoAnalito: null }]);
    expect(alvosDoAviso([], true, new Set([null]))).toEqual([]);
    expect(alvosDoAviso([], false, new Set())).toEqual([]);
  });
});
