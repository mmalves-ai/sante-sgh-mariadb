// Regra 16 do M32: a DRE com duas réguas declaradas (competência menos glosa aceita; caixa), com a divergência.
import { describe, expect, it } from 'vitest';
import { aberturaPorGrupo, mesDaCompetencia, montarDre } from './index.js';

describe('DRE com duas réguas (regra 16)', () => {
  it('março: competência 10.000 − 500 de glosa = 9.500; caixa 4.275 (55% de divergência); despesas 3.000 e 2.000', () => {
    const [mar] = montarDre(
      ['2026-03'],
      [
        { competencia: 202603, valor: 6_000, glosaAceita: 300 },
        { competencia: 202603, valor: 4_000, glosaAceita: 200 },
        { competencia: 202602, valor: 9_999, glosaAceita: 0 },
      ],
      [{ competencia: 202603, valor: 3_000, grupo: 210 }],
      [
        { data: '2026-03-15', valor: 4_275, natureza: 'receita', grupo: 100 },
        { data: '2026-03-20', valor: 2_000, natureza: 'despesa', grupo: 210 },
        { data: '2026-04-01', valor: 7_000, natureza: 'receita', grupo: 100 },
      ],
    );
    expect(mar).toEqual({
      mes: '2026-03',
      receitaCompetencia: 10_000,
      glosaAceita: 500,
      receitaLiquidaCompetencia: 9_500,
      receitaCaixa: 4_275,
      despesaCompetencia: 3_000,
      despesaCaixa: 2_000,
      resultadoCompetencia: 6_500,
      resultadoCaixa: 2_275,
      // |9.500 − 4.275| / 9.500 = 55%.
      divergenciaReceita: 55,
    });
  });
  it('mês sem receita de competência: divergência nula; competência 202612 → 2026-12', () => {
    expect(montarDre(['2026-05'], [], [], [])[0]?.divergenciaReceita).toBeNull();
    expect(mesDaCompetencia(202612)).toBe('2026-12');
  });
  it('abertura por grupo: 100 + 50 no 210 e 20 no 100', () => {
    expect(
      aberturaPorGrupo([
        { grupo: 210, valor: 100 },
        { grupo: 100, valor: 20 },
        { grupo: 210, valor: 50 },
      ]),
    ).toEqual([
      { grupo: 100, valor: 20 },
      { grupo: 210, valor: 150 },
    ]);
  });
});
