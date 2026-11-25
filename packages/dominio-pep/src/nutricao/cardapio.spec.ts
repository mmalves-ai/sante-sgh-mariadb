import { describe, expect, it } from 'vitest';
import {
  calcularFichaTecnica,
  preverProducao,
  transicaoPlanejamento,
  validarEscolhaCardapio,
  validarPlanejamento,
} from './cardapio.js';

describe('ficha técnica da preparação', () => {
  it('calcula o líquido pelo fator de correção, o custo per capita e o custo da porção', () => {
    const r = calcularFichaTecnica([
      { insumo: 1, perCapitaBruto: 0.15, fatorCorrecao: 1.5, custoUnidade: 30 },
      { insumo: 2, perCapitaBruto: 0.08, perCapitaLiquido: 0.08, custoUnidade: 6.5 },
      { insumo: 3, perCapitaBruto: 0.01 },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.itens[0]).toMatchObject({ sequencia: 1, perCapitaLiquido: 0.1, custoPerCapita: 4.5 });
    expect(r.valor.itens[1]).toMatchObject({ fatorCorrecao: 1, custoPerCapita: 0.52 });
    expect(r.valor.itens[2]).toMatchObject({ fatorCorrecao: 1, custoPerCapita: null });
    expect(r.valor.custoPorcao).toBe(5.02);
    expect(r.valor.liquidoPorcao).toBe(0.19);
    expect(r.valor.semCusto).toBe(1);
  });

  it('deduz o fator do líquido informado', () => {
    const r = calcularFichaTecnica([{ insumo: 1, perCapitaBruto: 0.2, perCapitaLiquido: 0.16 }]);
    expect(r.ok && r.valor.itens[0]?.fatorCorrecao).toBe(1.25);
  });

  it('recusa ficha vazia, gênero repetido, fator abaixo de 1, líquido acima do bruto e bruto zero', () => {
    expect(calcularFichaTecnica([]).ok).toBe(false);
    const r = calcularFichaTecnica([
      { insumo: 1, perCapitaBruto: 0.1, fatorCorrecao: 0.8 },
      { insumo: 1, perCapitaBruto: 0.1, perCapitaLiquido: 0.2 },
      { insumo: 2, perCapitaBruto: 0 },
      { insumo: 3, perCapitaBruto: 0.1, fatorCoccao: 20, custoUnidade: -1 },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problemas.map((p) => p.campo)).toEqual([
      'ficha.0.fatorCorrecao',
      'ficha.1',
      'ficha.1.perCapitaLiquido',
      'ficha.2.perCapitaBruto',
      'ficha.3.fatorCoccao',
      'ficha.3.custoUnidade',
    ]);
  });
});

describe('planejamento do cardápio', () => {
  const base = { periodoInicio: '2026-12-01', periodoFim: '2026-12-07' };
  it('ordena por dia e opção e numera a sequência', () => {
    const r = validarPlanejamento({
      ...base,
      itens: [
        { data: '2026-12-02', alternativa: null, preparacao: 9, porcoes: 40 },
        { data: '2026-12-01', alternativa: 2, preparacao: 8, porcoes: 10 },
        { data: '2026-12-01', alternativa: null, preparacao: 7, porcoes: 40 },
      ],
    });
    expect(r.ok && r.valor.itens.map((i) => [i.preparacao, i.sequencia])).toEqual([
      [7, 1],
      [8, 2],
      [9, 3],
    ]);
  });

  it('recusa período invertido ou longo, dia fora do período, porção zero e preparação repetida', () => {
    expect(validarPlanejamento({ periodoInicio: '2026-12-05', periodoFim: '2026-12-01', itens: [] }).ok).toBe(
      false,
    );
    expect(validarPlanejamento({ periodoInicio: '2026-12-01', periodoFim: '2027-01-15', itens: [] }).ok).toBe(
      false,
    );
    const r = validarPlanejamento({
      ...base,
      itens: [
        { data: '2026-12-09', alternativa: null, preparacao: 1, porcoes: 1 },
        { data: '2026-12-02', alternativa: null, preparacao: 1, porcoes: 0 },
        { data: '2026-12-02', alternativa: null, preparacao: 1, porcoes: 3 },
      ],
    });
    expect(!r.ok && r.problemas.map((p) => p.campo)).toEqual([
      'itens.0.data',
      'itens.1.porcoes',
      'itens.2.preparacao',
    ]);
  });

  it('segue o fluxo rascunho, aprovação por nutricionista e publicação', () => {
    const t = (situacao: 'rascunho' | 'em_aprovacao' | 'aprovado' | 'publicado' | 'cancelado', acao: never) =>
      transicaoPlanejamento({ situacao, acao, itens: 2, cbosDoUsuario: ['223710'], motivo: 'ajustar sal' });
    expect(t('rascunho', 'enviar' as never)).toEqual({
      ok: true,
      valor: { situacao: 'em_aprovacao', aprova: false },
    });
    expect(t('em_aprovacao', 'aprovar' as never)).toEqual({
      ok: true,
      valor: { situacao: 'aprovado', aprova: true },
    });
    expect(t('aprovado', 'publicar' as never)).toEqual({
      ok: true,
      valor: { situacao: 'publicado', aprova: false },
    });
    expect(t('em_aprovacao', 'devolver' as never)).toMatchObject({
      ok: true,
      valor: { situacao: 'rascunho' },
    });
    expect(t('publicado', 'cancelar' as never)).toMatchObject({ ok: true, valor: { situacao: 'cancelado' } });
    expect(t('cancelado', 'cancelar' as never).ok).toBe(false);
    expect(t('rascunho', 'publicar' as never).ok).toBe(false);
  });

  it('aprovar exige nutricionista; enviar exige preparação; cancelar e devolver exigem motivo', () => {
    const r = transicaoPlanejamento({
      situacao: 'em_aprovacao',
      acao: 'aprovar',
      itens: 2,
      cbosDoUsuario: ['225125', '322205'],
    });
    expect(!r.ok && r.problemas[0]?.campo).toBe('aprovador');
    expect(
      transicaoPlanejamento({ situacao: 'rascunho', acao: 'enviar', itens: 0, cbosDoUsuario: [] }).ok,
    ).toBe(false);
    expect(
      transicaoPlanejamento({
        situacao: 'aprovado',
        acao: 'cancelar',
        itens: 1,
        cbosDoUsuario: [],
        motivo: ' ',
      }).ok,
    ).toBe(false);
    expect(
      transicaoPlanejamento({ situacao: 'em_aprovacao', acao: 'devolver', itens: 1, cbosDoUsuario: [] }).ok,
    ).toBe(false);
  });
});

describe('previsão da produção', () => {
  const ficha = [
    { insumo: 10, perCapitaBruto: 0.15, custoPerCapita: 4.5 },
    { insumo: 11, perCapitaBruto: 0.05, custoPerCapita: null },
  ];
  it('usa a escolha da opção, depois o mapa com margem, depois o planejado, e soma os gêneros', () => {
    const r = preverProducao({
      preparacoes: [
        { preparacao: 1, alternativa: null, porcoesPlanejadas: 30, ficha },
        { preparacao: 2, alternativa: 5, porcoesPlanejadas: 8, ficha: [ficha[0]!] },
        { preparacao: 3, alternativa: 6, porcoesPlanejadas: 4, ficha: [ficha[1]!] },
      ],
      comensaisMapa: 20,
      escolhas: new Map([[5, 3]]),
      margemPercentual: 10,
    });
    expect(r.preparacoes.map((p) => [p.porcoes, p.base])).toEqual([
      [22, 'mapa'],
      [3, 'escolha'],
      [4, 'planejado'],
    ]);
    expect(r.generos).toEqual([
      { insumo: 10, quantidade: 3.75, custo: 112.5 },
      { insumo: 11, quantidade: 1.3, custo: null },
    ]);
    expect(r.custoTotal).toBe(112.5);
  });

  it('sem mapa usa o planejado e limita a margem a 30%', () => {
    const r = preverProducao({
      preparacoes: [{ preparacao: 1, alternativa: null, porcoesPlanejadas: 12, ficha }],
      comensaisMapa: 0,
      escolhas: new Map(),
      margemPercentual: 90,
    });
    expect(r.preparacoes[0]).toMatchObject({ porcoes: 12, base: 'planejado' });
    const m = preverProducao({
      preparacoes: [{ preparacao: 1, alternativa: null, porcoesPlanejadas: 12, ficha }],
      comensaisMapa: 10,
      escolhas: new Map(),
      margemPercentual: 90,
    });
    expect(m.preparacoes[0]?.porcoes).toBe(13);
  });
});

describe('escolha do paciente', () => {
  it('aceita a opção ofertada no cardápio publicado de hoje em diante', () => {
    expect(
      validarEscolhaCardapio({
        situacaoPlano: 'publicado',
        data: '2026-12-02',
        hoje: '2026-12-01',
        alternativaOfertada: true,
        quantidade: 1,
      }),
    ).toEqual([]);
  });
  it('recusa cardápio não publicado, dia passado, opção fora do dia e quantidade fora da faixa', () => {
    const p = validarEscolhaCardapio({
      situacaoPlano: 'aprovado',
      data: '2026-11-30',
      hoje: '2026-12-01',
      alternativaOfertada: false,
      quantidade: 4,
    });
    expect(p.map((x) => x.campo)).toEqual(['data', 'data', 'alternativa', 'quantidade']);
  });
});
