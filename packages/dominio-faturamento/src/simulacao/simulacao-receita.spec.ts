import { describe, expect, it } from 'vitest';
import {
  type CenarioReceitaEntrada,
  consolidarInconsistencias,
  consolidarResultado,
  type ItemProducao,
  type LinhaRecalculada,
  objetivoDoCenario,
  planoDoItem,
  type RegraCenarioReceita,
  type RegraResolvida,
  regraDoItem,
  tipoAtendimentoDaConta,
  tipoDaSimulacao,
  totaisDaSimulacao,
  validarCenarioReceita,
  valorSimuladoDoItem,
} from './simulacao-receita.js';

const regra = (o: Partial<RegraCenarioReceita> = {}): RegraCenarioReceita => ({
  fontePagadoraId: 1,
  planoId: null,
  tabelaDestinoId: null,
  fonteDestinoId: null,
  planoDestinoId: null,
  percentualAjuste: 5,
  conversoes: [],
  ...o,
});
const cenario = (o: Partial<CenarioReceitaEntrada> = {}): CenarioReceitaEntrada => ({
  nome: 'Reajuste 2027',
  producaoInicio: '2026-01-01',
  producaoFim: '2026-01-31',
  dataReferencia: 'competencia',
  tipoAtendimento: null,
  regras: [regra()],
  ...o,
});
const conv = {
  itemAtualCodigo: '10101012',
  itemDestinoCodigo: '10101039',
  fatorAtual: 1,
  fatorDestino: 1,
  acrescimoValor: null,
  mantemValorOriginal: false,
};

describe('validarCenarioReceita', () => {
  it('aceita o cenário mínimo (um convênio com reajuste)', () => {
    expect(validarCenarioReceita(cenario())).toEqual({});
  });

  it('recusa nome curto, período invertido, período longo e data inválida', () => {
    expect(Object.keys(validarCenarioReceita(cenario({ nome: ' a ' })))).toEqual(['nome']);
    expect(validarCenarioReceita(cenario({ producaoFim: '2025-12-31' }))['producaoFim']).toMatch(/antes/);
    expect(validarCenarioReceita(cenario({ producaoFim: '2027-01-03' }))['producaoFim']).toMatch(/366/);
    expect(validarCenarioReceita(cenario({ producaoInicio: '2026-13-01' }))['producaoInicio']).toBeTruthy();
    expect(
      validarCenarioReceita(cenario({ dataReferencia: 'alta' as 'competencia' }))['dataReferencia'],
    ).toBeTruthy();
    expect(
      validarCenarioReceita(cenario({ tipoAtendimento: 'x' as 'internacao' }))['tipoAtendimento'],
    ).toBeTruthy();
  });

  it('exige ao menos uma regra e que cada regra mude algo', () => {
    expect(validarCenarioReceita(cenario({ regras: [] }))['regras']).toBeTruthy();
    expect(
      validarCenarioReceita(cenario({ regras: [regra({ percentualAjuste: 0 })] }))['regras.0.destino'],
    ).toMatch(/o que muda/);
    expect(
      validarCenarioReceita(cenario({ regras: [regra({ percentualAjuste: null, tabelaDestinoId: 3 })] })),
    ).toEqual({});
  });

  it('recusa convênio repetido, destino igual à origem, plano sem convênio simulado e reajuste fora da faixa', () => {
    const e = validarCenarioReceita(
      cenario({
        regras: [
          regra(),
          regra({ percentualAjuste: 1000 }),
          regra({ fontePagadoraId: 2, fonteDestinoId: 2 }),
          regra({ fontePagadoraId: 3, planoDestinoId: 9 }),
          regra({ fontePagadoraId: 0 }),
        ],
      }),
    );
    expect(e['regras.1.planoId']).toMatch(/já está/);
    expect(e['regras.1.percentualAjuste']).toMatch(/999/);
    expect(e['regras.2.fonteDestinoId']).toMatch(/mesmo/);
    expect(e['regras.3.planoDestinoId']).toMatch(/convênio simulado/);
    expect(e['regras.4.fontePagadoraId']).toBeTruthy();
    // O mesmo convênio em planos diferentes é permitido.
    expect(validarCenarioReceita(cenario({ regras: [regra(), regra({ planoId: 4 })] }))).toEqual({});
  });

  it('confere as conversões: códigos, repetição, fatores e acréscimo', () => {
    const e = validarCenarioReceita(
      cenario({
        regras: [
          regra({
            percentualAjuste: null,
            conversoes: [
              conv,
              { ...conv, itemDestinoCodigo: '' },
              { ...conv, itemAtualCodigo: '2', itemDestinoCodigo: '2' },
              { ...conv, itemAtualCodigo: '3', fatorAtual: 0, fatorDestino: -1, acrescimoValor: Number.NaN },
              { ...conv, itemAtualCodigo: '' },
            ],
          }),
        ],
      }),
    );
    expect(e['regras.0.conversoes.1.itemAtualCodigo']).toMatch(/já tem/);
    expect(e['regras.0.conversoes.1.itemDestinoCodigo']).toMatch(/destino/);
    expect(e['regras.0.conversoes.2.itemDestinoCodigo']).toMatch(/mesmo/);
    expect(e['regras.0.conversoes.3.fatorAtual']).toBeTruthy();
    expect(e['regras.0.conversoes.3.fatorDestino']).toBeTruthy();
    expect(e['regras.0.conversoes.3.acrescimoValor']).toBeTruthy();
    expect(e['regras.0.conversoes.4.itemAtualCodigo']).toMatch(/hoje/);
    expect(e['regras.0.destino']).toBeUndefined();
    // Mesmo código com acréscimo é uma conversão válida (soma um valor ao procedimento).
    expect(
      validarCenarioReceita(
        cenario({
          regras: [
            regra({
              percentualAjuste: null,
              conversoes: [{ ...conv, itemDestinoCodigo: conv.itemAtualCodigo, acrescimoValor: 10 }],
            }),
          ],
        }),
      ),
    ).toEqual({});
  });
});

describe('objetivo, tipo e tipo de atendimento', () => {
  it('objetivo: convênio novo vence troca de tabela, que vence reajuste', () => {
    expect(objetivoDoCenario([regra()])).toBe('reajuste_fonte_pagadora');
    expect(objetivoDoCenario([regra(), regra({ tabelaDestinoId: 3 })])).toBe('troca_tabela_preco');
    expect(objetivoDoCenario([regra({ tabelaDestinoId: 3 }), regra({ fonteDestinoId: 4 })])).toBe(
      'nova_fonte_pagadora',
    );
  });

  it('tipo: uma natureza de mudança dá o tipo dela; mais de uma, o cenário completo', () => {
    expect(tipoDaSimulacao([regra()])).toBe('reajuste');
    expect(tipoDaSimulacao([regra({ percentualAjuste: null, tabelaDestinoId: 3 })])).toBe('conversao_tabela');
    expect(tipoDaSimulacao([regra({ percentualAjuste: null, conversoes: [conv] })])).toBe(
      'conversao_procedimento',
    );
    expect(tipoDaSimulacao([regra({ tabelaDestinoId: 3 })])).toBe('cenario_completo');
  });

  it('tipo de atendimento pela natureza da conta', () => {
    expect(tipoAtendimentoDaConta('pronto_atendimento')).toBe('urgencia');
    expect(tipoAtendimentoDaConta('internacao')).toBe('internacao');
    expect(tipoAtendimentoDaConta('ambulatorial')).toBe('ambulatorial');
    expect(tipoAtendimentoDaConta('externo')).toBe('externo');
    expect(tipoAtendimentoDaConta('domiciliar')).toBe('domiciliar');
    expect(tipoAtendimentoDaConta('outra')).toBeNull();
  });

  it('a regra do plano da conta vence a do convênio inteiro; outro convênio fica sem regra', () => {
    const geral = { fontePagadoraId: 1, planoId: null };
    const plano = { fontePagadoraId: 1, planoId: 7 };
    expect(regraDoItem([geral, plano], 1, 7)).toBe(plano);
    expect(regraDoItem([geral, plano], 1, 8)).toBe(geral);
    expect(regraDoItem([geral, plano], 1, null)).toBe(geral);
    expect(regraDoItem([plano], 1, null)).toBeNull();
    expect(regraDoItem([geral], 2, null)).toBeNull();
  });
});

describe('recálculo do item', () => {
  const item: ItemProducao = { itemFaturavelId: 10, quantidade: 2, percentualCobranca: 100, valorAtual: 200 };
  const r = (o: Partial<RegraResolvida> = {}): RegraResolvida => ({
    tabelaDestinoId: null,
    fonteDestinoId: null,
    percentualAjuste: null,
    conversoes: [],
    ...o,
  });

  it('só reajuste: parte do valor atual, sem buscar preço', () => {
    const regraR = r({ percentualAjuste: 7.5 });
    const p = planoDoItem(item, regraR);
    expect(p).toEqual({ itemCobradoId: 10, quantidade: 2, conversao: null, precisaPreco: false });
    expect(valorSimuladoDoItem(item, regraR, p, null)).toEqual({ valorSimulado: 215, inconsistencia: null });
  });

  it('troca de tabela: preço de destino × quantidade × percentual de cobrança, e o reajuste por cima', () => {
    const regraR = r({ tabelaDestinoId: 3, percentualAjuste: 10 });
    const metade = { ...item, percentualCobranca: 50 };
    const p = planoDoItem(metade, regraR);
    expect(p.precisaPreco).toBe(true);
    // 120 × 2 × 50% = 120; +10% = 132.
    expect(valorSimuladoDoItem(metade, regraR, p, 120)).toEqual({ valorSimulado: 132, inconsistencia: null });
  });

  it('sem preço de destino: fica pelo valor atual e vira inconsistência', () => {
    const regraR = r({ fonteDestinoId: 4 });
    const p = planoDoItem(item, regraR);
    expect(valorSimuladoDoItem(item, regraR, p, null)).toEqual({
      valorSimulado: 200,
      inconsistencia: 'sem_preco_destino',
    });
  });

  it('conversão: outro procedimento, quantidade pelos fatores, acréscimo por unidade atual', () => {
    const c = {
      itemAtualId: 10,
      itemDestinoId: 20,
      fatorAtual: 2,
      fatorDestino: 3,
      acrescimoValor: 5,
      mantemValorOriginal: false,
    };
    const regraR = r({ conversoes: [c] });
    const p = planoDoItem(item, regraR);
    expect(p).toEqual({ itemCobradoId: 20, quantidade: 3, conversao: c, precisaPreco: true });
    // 40 × 3 = 120 + 5 × 2 = 130.
    expect(valorSimuladoDoItem(item, regraR, p, 40).valorSimulado).toBe(130);
    // Outro item não é convertido e, sem troca de tabela, não precisa de preço.
    expect(planoDoItem({ ...item, itemFaturavelId: 11 }, regraR).precisaPreco).toBe(false);
  });

  it('conversão que conserva o valor: só troca o código; reajuste incide; fator inválido é inconsistência', () => {
    const c = {
      itemAtualId: 10,
      itemDestinoId: 20,
      fatorAtual: 1,
      fatorDestino: 1,
      acrescimoValor: null,
      mantemValorOriginal: true,
    };
    const regraR = r({ conversoes: [c], percentualAjuste: -10, tabelaDestinoId: 3 });
    const p = planoDoItem(item, regraR);
    expect(p.precisaPreco).toBe(false);
    expect(valorSimuladoDoItem(item, regraR, p, 999).valorSimulado).toBe(180);
    const ruim = { ...c, fatorAtual: 0 };
    expect(
      valorSimuladoDoItem(item, r({ conversoes: [ruim] }), { ...p, conversao: ruim }, 1).inconsistencia,
    ).toBe('fator_invalido');
    // Redução de 100% zera, nunca fica negativo.
    expect(
      valorSimuladoDoItem(item, r({ percentualAjuste: -100 }), planoDoItem(item, r()), null).valorSimulado,
    ).toBe(0);
  });
});

describe('consolidação', () => {
  const linha = (o: Partial<LinhaRecalculada>): LinhaRecalculada => ({
    fontePagadoraId: 1,
    planoId: null,
    fonteDestinoId: null,
    planoDestinoId: null,
    itemFaturavelId: 10,
    tipoAtendimento: 'internacao',
    atendimentoId: 100,
    quantidade: 1,
    valorAtual: 100,
    valorSimulado: 110,
    ...o,
  });

  it('resultado por convênio, procedimento e tipo de atendimento, com atendimentos distintos', () => {
    const linhas = [
      linha({}),
      linha({ atendimentoId: 101, quantidade: 2, valorAtual: 200, valorSimulado: 220 }),
      linha({ atendimentoId: 100 }),
      linha({ fontePagadoraId: 2, valorSimulado: 90 }),
      linha({ tipoAtendimento: 'ambulatorial' }),
    ];
    const r = consolidarResultado(linhas);
    expect(r.map((x) => [x.sequencia, x.fontePagadoraId, x.tipoAtendimento, x.quantidade])).toEqual([
      [1, 1, 'ambulatorial', 1],
      [2, 1, 'internacao', 4],
      [3, 2, 'internacao', 1],
    ]);
    expect(r[1]).toMatchObject({ quantidadeAtendimentos: 2, valorAtual: 400, valorSimulado: 440 });
    const t = totaisDaSimulacao(linhas, []);
    // Σ atual = 100 + 200 + 100 + 100 + 100 = 600; Σ simulado = 110 + 220 + 110 + 90 + 110 = 640.
    expect(t).toEqual({
      quantidadeItens: 5,
      quantidadeAtendimentos: 2,
      quantidadeInconsistencias: 0,
      valorAtual: 600,
      valorSimulado: 640,
      diferenca: 40,
      percentual: 6.67,
      situacao: 'concluida',
    });
    expect(totaisDaSimulacao([], []).percentual).toBeNull();
  });

  it('inconsistências agrupadas por causa, com a primeira data e o valor que ficou sem recálculo', () => {
    const o = {
      motivo: 'sem_preco_destino' as const,
      itemAtualId: 10,
      itemDestinoId: null,
      fatorAtual: null,
      fatorDestino: null,
      fontePagadoraId: 1,
      detalhe: null,
    };
    const r = consolidarInconsistencias([
      { ...o, data: '2026-01-10', valorAtual: 50 },
      { ...o, data: '2026-01-05', valorAtual: 25 },
      { ...o, motivo: 'outro', detalhe: 'falta índice', data: '2026-01-07', valorAtual: 10 },
    ]);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ sequencia: 1, ocorrencias: 2, data: '2026-01-05', valorAtual: 75 });
    expect(r[0]!.detalhe).toMatch(/sem preço vigente.*\(2 itens\)/);
    expect(r[1]!.detalhe).toMatch(/recusou o item: falta índice \(1 item\)/);
    const t = totaisDaSimulacao([], r);
    expect(t.situacao).toBe('concluida_com_inconsistencia');
    expect(t.quantidadeInconsistencias).toBe(3);
  });
});
