import { describe, expect, it } from 'vitest';
import {
  type ItemDoPeriodo,
  type PeriodoFaixa,
  guiasPorPeriodoFechado,
  periodoDoItem,
  periodoFechadoDoLancamento,
  resumoPorPeriodo,
  validarFechamentoPeriodo,
  validarReaberturaPeriodo,
  validarRetiradaPeriodo,
} from './periodos-conta.js';

const jan: PeriodoFaixa = {
  id: 1,
  inicio: '2026-01-20T08:00:00.000',
  fim: '2026-01-31T23:59:59.999',
  competencia: '2026-01-01',
  tipoLancamentoId: null,
  fechado: false,
};
const fev: PeriodoFaixa = {
  id: 2,
  inicio: '2026-02-01T00:00:00.000',
  fim: '2026-02-28T23:59:59.999',
  competencia: '2026-02-01',
  tipoLancamentoId: null,
  fechado: false,
};
const honorFev: PeriodoFaixa = { ...fev, id: 3, tipoLancamentoId: 7, competencia: '2026-03-01' };
const item = (id: number, realizadoEm: string, extra: Partial<ItemDoPeriodo> = {}): ItemDoPeriodo => ({
  id,
  realizadoEm,
  tipoLancamentoId: null,
  valorTotal: 10,
  guiaTissId: null,
  situacao: 'lancado',
  ...extra,
});

describe('conta parcial por período', () => {
  it('o item cai no período pela data; o do tipo de lançamento vale sobre o geral', () => {
    const ps = [jan, fev, honorFev];
    expect(periodoDoItem(ps, item(1, '2026-01-31T23:59:59.999'))?.id).toBe(1);
    expect(periodoDoItem(ps, item(1, '2026-02-10T10:00:00.000'))?.id).toBe(2);
    expect(periodoDoItem(ps, { realizadoEm: '2026-02-10T10:00:00.000', tipoLancamentoId: 7 })?.id).toBe(3);
    expect(periodoDoItem(ps, item(1, '2026-01-19T23:00:00.000'))).toBeNull();
  });

  it('resumo por período e competência: soma só o que cobra, lista as guias, mostra o que ficou sem período', () => {
    const r = resumoPorPeriodo(
      [jan, fev, honorFev],
      [
        item(1, '2026-01-21T10:00:00.000', { valorTotal: 100.1, guiaTissId: 9 }),
        item(2, '2026-01-22T10:00:00.000', { valorTotal: 50.2, guiaTissId: 9 }),
        item(3, '2026-01-23T10:00:00.000', { valorTotal: 999, situacao: 'estornado' }),
        item(4, '2026-02-02T10:00:00.000', { valorTotal: 30, guiaTissId: 11 }),
        item(5, '2026-02-02T10:00:00.000', { valorTotal: 70, tipoLancamentoId: 7, guiaTissId: 12 }),
        item(6, '2026-03-02T10:00:00.000', { valorTotal: 5 }),
      ],
    );
    expect(r.periodos).toEqual([
      { periodoId: 1, competencia: '2026-01-01', fechado: false, itens: 2, valor: 150.3, guias: [9] },
      { periodoId: 2, competencia: '2026-02-01', fechado: false, itens: 1, valor: 30, guias: [11] },
      { periodoId: 3, competencia: '2026-03-01', fechado: false, itens: 1, valor: 70, guias: [12] },
    ]);
    expect(r.semPeriodo).toEqual({ itens: 1, valor: 5, guias: [] });
    expect(r.porCompetencia.map((c) => [c.competencia, c.itens, c.valor])).toEqual([
      ['2026-01-01', 2, 150.3],
      ['2026-02-01', 1, 30],
      ['2026-03-01', 1, 70],
    ]);
  });

  it('fechamento parcial: em ordem, com a conta aberta e com item', () => {
    const aberta = { situacao: 'aberta' };
    expect(validarFechamentoPeriodo(aberta, jan, [jan, fev], 2)).toEqual({});
    expect(validarFechamentoPeriodo(aberta, fev, [jan, fev], 1)['periodo']).toMatch(/anterior/);
    // o período de outro tipo de lançamento não espera o geral
    expect(validarFechamentoPeriodo(aberta, honorFev, [jan, fev, honorFev], 1)).toEqual({});
    expect(validarFechamentoPeriodo(aberta, fev, [{ ...jan, fechado: true }, fev], 0)['itens']).toMatch(
      /item/,
    );
    expect(validarFechamentoPeriodo(aberta, { ...jan, fechado: true }, [jan], 1)['periodo']).toMatch(/já/);
    expect(validarFechamentoPeriodo({ situacao: 'fechada' }, jan, [jan], 1)['conta']).toMatch(/reabra/);
  });

  it('reabertura: com motivo, do último para o primeiro e sem guia em lote', () => {
    const aberta = { situacao: 'aberta' };
    const j = { ...jan, fechado: true };
    const f = { ...fev, fechado: true };
    expect(validarReaberturaPeriodo(aberta, f, [j, f], 0, 'conferência refeita')).toEqual({});
    expect(validarReaberturaPeriodo(aberta, j, [j, f], 0, 'conferência refeita')['periodo']).toMatch(
      /seguinte/,
    );
    expect(validarReaberturaPeriodo(aberta, f, [j, f], 1, 'conferência refeita')['periodo']).toMatch(/lote/);
    expect(validarReaberturaPeriodo(aberta, f, [j, f], 0, 'ok')['motivo']).toBeDefined();
    expect(validarReaberturaPeriodo(aberta, jan, [jan], 0, 'conferência refeita')['periodo']).toMatch(
      /não está/,
    );
  });

  it('período fechado: não sai e recusa lançamento na faixa (do mesmo escopo)', () => {
    const j = { ...jan, fechado: true };
    const h = { ...honorFev, fechado: true };
    expect(validarRetiradaPeriodo(j)['periodo']).toMatch(/reabra/);
    expect(validarRetiradaPeriodo(jan)).toEqual({});
    expect(periodoFechadoDoLancamento([j, fev], item(1, '2026-01-25T00:00:00.000'))?.id).toBe(1);
    expect(periodoFechadoDoLancamento([j, fev], item(1, '2026-02-25T00:00:00.000'))).toBeNull();
    expect(periodoFechadoDoLancamento([fev, h], item(1, '2026-02-10T00:00:00.000'))).toBeNull();
    expect(
      periodoFechadoDoLancamento([fev, h], { realizadoEm: '2026-02-10T00:00:00.000', tipoLancamentoId: 7 })
        ?.id,
    ).toBe(3);
  });

  it('lote TISS por período (decisão 58): uma guia por período fechado com as datas da faixa e a do que sobra', () => {
    const conta = { inicio: '2026-01-20T08:00:00.000', fim: '2026-03-05T10:00:00.000' };
    const itens = [
      item(1, '2026-01-21T10:00:00.000'),
      item(2, '2026-02-03T10:00:00.000'),
      item(3, '2026-02-10T10:00:00.000', { tipoLancamentoId: 7 }),
      item(4, '2026-03-02T10:00:00.000'),
    ];
    // Sem período fechado: uma guia só, com a conta inteira.
    expect(guiasPorPeriodoFechado([jan, fev], itens, conta)).toEqual([
      { periodo: null, itens: [1, 2, 3, 4], ...conta },
    ]);
    // Janeiro e fevereiro fechados; o honorário de fevereiro (tipo 7) cai no período dele, aberto: vai ao resto.
    const fj = { ...jan, fechado: true };
    const ff = { ...fev, fechado: true };
    expect(guiasPorPeriodoFechado([ff, fj, honorFev], itens, conta)).toEqual([
      { periodo: fj, itens: [1], inicio: jan.inicio, fim: jan.fim },
      { periodo: ff, itens: [2], inicio: fev.inicio, fim: fev.fim },
      { periodo: null, itens: [3, 4], inicio: conta.inicio, fim: conta.fim },
    ]);
    // O resto todo depois do último fechado começa no fim dele; período fechado sem item não gera guia.
    expect(guiasPorPeriodoFechado([fj, ff], [itens[0]!, itens[3]!], conta)).toEqual([
      { periodo: fj, itens: [1], inicio: jan.inicio, fim: jan.fim },
      { periodo: null, itens: [4], inicio: fev.fim, fim: conta.fim },
    ]);
    // Tudo dentro de períodos fechados: só as guias dos períodos.
    expect(guiasPorPeriodoFechado([fj], [itens[0]!], conta)).toHaveLength(1);
  });
});
