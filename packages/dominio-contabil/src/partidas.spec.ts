// Regra 5: partidas dobradas por lançamento e por período, com as parcelas.
import { describe, expect, it } from 'vitest';
import type { LancamentoGerado, PartidaGerada } from '@sgh/contratos';
import { equilibrio, equilibrioDoPeriodo, problemasDoLancamento } from './partidas.js';

const p = (lado: 'D' | 'C', valorCentavos: number): PartidaGerada => ({
  lado,
  conta: '1',
  valorCentavos,
  historico: 'x',
  centroCusto: null,
});
const l = (chave: string, partidas: PartidaGerada[]): LancamentoGerado => ({
  chave,
  fato: { tabela: 'X', id: 1, tipo: 'tituloPagar', impressao: 'i' },
  regra: { nome: 'r', versao: 1 },
  empresa: 1,
  data: '2027-01-01',
  competencia: '2027-01',
  partidas,
});

describe('partidas dobradas', () => {
  it('equilíbrio com as parcelas', () => {
    const e = equilibrio([p('D', 70), p('D', 30), p('C', 100)]);
    expect(e).toMatchObject({
      debitos: 100,
      creditos: 100,
      diferenca: 0,
      equilibrado: true,
      parcelasDebito: [70, 30],
      parcelasCredito: [100],
    });
  });

  it('problemas: desequilíbrio, um lado só, valor zero ou fracionado', () => {
    expect(problemasDoLancamento([p('D', 100), p('C', 100)])).toEqual([]);
    expect(problemasDoLancamento([p('D', 100), p('C', 90)])[0]).toMatch(/diferença de 10/);
    expect(problemasDoLancamento([p('D', 100)])).toContain('O lançamento precisa de débito e de crédito.');
    expect(problemasDoLancamento([p('D', 0), p('C', 0)])).toContain(
      'Toda partida tem valor positivo em centavos.',
    );
    expect(problemasDoLancamento([p('D', 1.5), p('C', 1.5)])).toContain(
      'Toda partida tem valor positivo em centavos.',
    );
  });

  it('período: soma dos lançamentos com a parcela de cada um', () => {
    const e = equilibrioDoPeriodo([l('a', [p('D', 10), p('C', 10)]), l('b', [p('D', 5), p('C', 4)])]);
    expect(e).toMatchObject({
      debitos: 15,
      creditos: 14,
      diferenca: 1,
      equilibrado: false,
      parcelasDebito: [10, 5],
    });
    expect(e.porLancamento).toEqual([
      { chave: 'a', debitos: 10, creditos: 10 },
      { chave: 'b', debitos: 5, creditos: 4 },
    ]);
  });
});
