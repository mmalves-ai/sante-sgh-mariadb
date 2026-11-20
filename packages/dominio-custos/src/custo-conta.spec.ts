// Custo por conta e margem (M54-F5): o custo final do produtivo chega às contas pela razão custo/receita do centro;
// glosa e recurso ajustam a receita (regra 4). Contas sintéticas.
import { describe, expect, it } from 'vitest';
import type { LinhaApuracaoCentro } from '@sgh/contratos';
import { agruparResultado, custearContas, type ItemContaLido, margemPercentualCent } from './custo-conta.js';

const linha = (
  centro: number,
  classe: LinhaApuracaoCentro['classe'],
  custoFinal: number,
): LinhaApuracaoCentro =>
  ({
    centro,
    codigo: 100 + centro,
    nome: `C${centro}`,
    classe,
    custoFinal,
  }) as unknown as LinhaApuracaoCentro;

const item = (
  conta: number,
  centro: number | null,
  bruta: number,
  extra: Partial<ItemContaLido> = {},
): ItemContaLido => ({
  conta,
  numero: 9000 + conta,
  tipoConta: 'I',
  convenio: 10,
  procedimento: '0303',
  centro,
  bruta,
  glosa: 0,
  recurso: 0,
  ...extra,
});

describe('custo por conta (razão custo/receita do centro)', () => {
  const linhas = [
    linha(1, 'produtivo', 9_000),
    linha(2, 'produtivo', 1_000),
    linha(3, 'auxiliar', 0),
    linha(4, 'produtivo', 500),
  ];
  const itens = [
    item(10, 1, 2_000, { glosa: 300 }),
    item(10, 2, 1_000),
    item(11, 1, 1_000, { convenio: 20, procedimento: '0401', recurso: 100 }),
    item(11, null, 50, { convenio: 20, procedimento: '0401' }),
    item(12, 3, 400, { convenio: null, procedimento: null, tipoConta: null }),
  ];
  const r = custearContas(linhas, itens);
  const conta = (id: number) => r.contas.find((c) => c.conta === id)!;

  it('cada conta recebe o custo do centro na proporção do que faturou nele; a soma é o custo final', () => {
    expect(conta(10).parcelas).toEqual([
      { centro: 1, receita: 2_000, custo: 6_000 },
      { centro: 2, receita: 1_000, custo: 1_000 },
    ]);
    expect(conta(11).parcelas).toEqual([{ centro: 1, receita: 1_000, custo: 3_000 }]);
    expect(conta(10).custo + conta(11).custo).toBe(10_000);
    expect(r.custoNasContas).toBe(10_000);
  });

  it('receita líquida = bruta − glosa + recurso; margem = líquida − custo', () => {
    expect(conta(10)).toMatchObject({
      receitaBruta: 3_000,
      glosa: 300,
      receitaLiquida: 2_700,
      custo: 7_000,
      margem: -4_300,
    });
    expect(conta(11)).toMatchObject({
      receitaBruta: 1_050,
      recurso: 100,
      receitaLiquida: 1_150,
      margem: -1_850,
    });
    expect(conta(10).margemPercentualCent).toBe(Math.round((-4_300 * 10_000) / 2_700));
  });

  it('item em auxiliar só conta receita; produtivo sem receita não passa custo (pendência)', () => {
    expect(conta(12)).toMatchObject({
      custo: 0,
      receitaBruta: 400,
      parcelas: [{ centro: 3, receita: 400, custo: 0 }],
    });
    expect(r.custoSemConta).toBe(500);
    expect(r.pendencias).toHaveLength(1);
    expect(r.pendencias[0]).toMatchObject({ tipo: 'produtivo-sem-receita', centros: [4], centavos: 500 });
    expect(r.receitaPorCentro.get(1)).toBe(3_000);
  });

  it('margem percentual sem receita é nula', () => {
    expect(margemPercentualCent(-10, 0)).toBeNull();
  });

  it('muitos produtivos sem receita: a mensagem resume', () => {
    const ls = Array.from({ length: 7 }, (_, i) => linha(50 + i, 'produtivo', 1));
    expect(custearContas(ls, []).pendencias[0]?.mensagem).toContain('e mais 2');
  });

  describe('agrupamentos (as parcelas do total são os grupos)', () => {
    it('por convênio', () => {
      const g = agruparResultado(r.contas, 'convenio', (k) => `Convênio ${k}`);
      expect(g.grupos.map((x) => [x.chave, x.contas, x.receitaLiquida, x.custo])).toEqual([
        ['10', 1, 2_700, 7_000],
        ['20', 1, 1_150, 3_000],
        ['sem-convenio', 1, 400, 0],
      ]);
      expect(g.grupos[0]?.rotulo).toBe('Convênio 10');
      expect(g.total).toMatchObject({ contas: 3, receitaLiquida: 4_250, custo: 10_000, margem: -5_750 });
      expect(g.total.receitaLiquida).toBe(g.grupos.reduce((s, x) => s + x.receitaLiquida, 0));
    });
    it('por procedimento e por tipo de conta', () => {
      expect(agruparResultado(r.contas, 'procedimento').grupos.map((x) => x.chave)).toEqual([
        '0303',
        '0401',
        'sem-procedimento',
      ]);
      expect(agruparResultado(r.contas, 'tipoConta').grupos.map((x) => x.chave)).toEqual(['I', 'sem-tipo']);
    });
    it('por unidade: receita e custo de cada centro; glosa, recurso e item sem centro em "sem-centro"', () => {
      const g = agruparResultado(r.contas, 'centro');
      const por = Object.fromEntries(g.grupos.map((x) => [x.chave, x]));
      expect(por['1']).toMatchObject({ receitaBruta: 3_000, custo: 9_000, contas: 2 });
      expect(por['sem-centro']).toMatchObject({
        receitaBruta: 50,
        glosa: 300,
        recurso: 100,
        receitaLiquida: -150,
      });
      expect(g.total.receitaLiquida).toBe(4_250);
      expect(g.total.custo).toBe(10_000);
    });
  });
});
