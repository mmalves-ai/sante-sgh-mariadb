import { describe, expect, it } from 'vitest';
import {
  apurarComissoes,
  apurarEstornos,
  apurarMeta,
  descontoNaParcela,
  inadimplenteDesde,
  type ParcelaRegraComissao,
  parcelaDaRegra,
  problemasDaCampanha,
  problemasDaMeta,
  problemasDaMudancaCampanha,
  problemasDaMudancaComissao,
  problemasDaMudancaProposta,
  problemasDaProposta,
  problemasDasParcelasDaRegra,
  type Proponente,
  totaisDaComissao,
} from './comercial.js';
import { cpfSintetico } from './index.js';

const titular: Proponente = {
  sequencia: 1,
  tipo: 'titular',
  titularSequencia: null,
  parentesco: null,
  nome: 'Titular Sintético',
  nascimento: '1980-01-01',
  sexo: 'F',
  cpf: cpfSintetico('900950001'),
  cns: null,
  nomeMae: 'Mãe Sintética',
};
const ficha = (ps: Proponente[]) => ({
  propostaEm: '2026-11-01',
  hoje: '2026-11-25',
  diaVencimento: 10,
  proponentes: ps,
});
const cod = (ps: { codigo: string }[]) => ps.map((p) => p.codigo);

describe('proposta de adesão', () => {
  it('ficha completa passa; sem titular, dependente solto, CPF do maior e nome da mãe são cobrados', () => {
    expect(problemasDaProposta(ficha([titular]))).toEqual([]);
    const dep: Proponente = {
      ...titular,
      sequencia: 2,
      tipo: 'dependente',
      titularSequencia: 9,
      parentesco: null,
      cpf: null,
      nascimento: '2000-01-01',
      nomeMae: '',
    };
    expect(cod(problemasDaProposta(ficha([dep])))).toEqual([
      'proposta-sem-titular',
      'dependente-sem-titular',
      'dependente-sem-parentesco',
      'cpf-obrigatorio',
      'sem-nome-mae',
    ]);
    const crianca: Proponente = {
      ...dep,
      titularSequencia: 1,
      parentesco: 3,
      nascimento: '2015-05-05',
      nomeMae: 'Mãe',
    };
    expect(problemasDaProposta(ficha([titular, crianca]))).toEqual([]);
  });
  it('CPF inválido, repetido, data futura e dia de vencimento fora de 1 a 28', () => {
    const p = problemasDaProposta({
      propostaEm: '2026-12-01',
      hoje: '2026-11-25',
      diaVencimento: 30,
      proponentes: [
        titular,
        { ...titular, sequencia: 2, tipo: 'agregado', titularSequencia: 1, parentesco: 1 },
        { ...titular, sequencia: 3, cpf: '12345678900' },
      ],
    });
    expect(cod(p)).toEqual(['proposta-futura', 'dia-vencimento-invalido', 'cpf-repetido', 'cpf-invalido']);
  });
  it('o fluxo não pula etapas; recusa exige motivo; efetivação exige contrato; envio confere a ficha', () => {
    const f = ficha([titular]);
    const m = (de: never, para: never, motivo: string | null = null, contrato: number | null = null) =>
      cod(problemasDaMudancaProposta({ de, para, motivo, contrato, ficha: f }));
    expect(m('rascunho' as never, 'aprovada' as never)).toEqual(['proposta-transicao-invalida']);
    expect(m('em_analise' as never, 'recusada' as never)).toEqual(['proposta-sem-motivo']);
    expect(m('aprovada' as never, 'efetivada' as never)).toEqual(['efetivacao-sem-contrato']);
    expect(m('aprovada' as never, 'efetivada' as never, null, 7)).toEqual([]);
    expect(
      cod(
        problemasDaMudancaProposta({
          de: 'rascunho',
          para: 'enviada',
          motivo: null,
          contrato: null,
          ficha: ficha([]),
        }),
      ),
    ).toEqual(['proposta-sem-proponente']);
    expect(m('cancelada' as never, 'em_analise' as never)).toEqual(['proposta-transicao-invalida']);
  });
});

const regra: ParcelaRegraComissao[] = [
  {
    parcelaInicial: 1,
    parcelaFinal: 1,
    tipo: 'percentual',
    percentual: 100,
    valor: null,
    desconto: null,
    vigenciaInicio: '2026-01-01',
  },
  {
    parcelaInicial: 2,
    parcelaFinal: 3,
    tipo: 'percentual',
    percentual: 30,
    valor: null,
    desconto: null,
    vigenciaInicio: '2026-01-01',
  },
  {
    parcelaInicial: 2,
    parcelaFinal: 3,
    tipo: 'valor',
    percentual: null,
    valor: 50,
    desconto: 5,
    vigenciaInicio: '2026-09-01',
  },
];

describe('comissão sobre parcelas pagas', () => {
  it('regra sem sobreposição na mesma vigência; vale a faixa da vigência mais recente até a venda', () => {
    expect(problemasDasParcelasDaRegra(regra)).toEqual([]);
    expect(
      cod(problemasDasParcelasDaRegra([regra[1]!, { ...regra[1]!, parcelaInicial: 3, parcelaFinal: 4 }])),
    ).toEqual(['parcela-sobreposta']);
    expect(parcelaDaRegra(regra, 2, '2026-05-01')?.percentual).toBe(30);
    expect(parcelaDaRegra(regra, 2, '2026-10-01')?.valor).toBe(50);
    expect(parcelaDaRegra(regra, 4, '2026-10-01')).toBeNull();
  });
  it('só a paga gera comissão; a não paga vira pendência sem valor no lote; a já comissionada não repete', () => {
    const base = {
      contrato: 1,
      vendidoEm: '2026-05-01',
      jaComissionada: false,
      competencia: '2026-06-01',
      valor: 400,
    };
    const itens = apurarComissoes(
      [
        { ...base, fatura: 1, numeroParcela: 1, valorPago: 400, pagoEm: '2026-06-10' },
        { ...base, fatura: 2, numeroParcela: 2, valorPago: null, pagoEm: null },
        { ...base, fatura: 3, numeroParcela: 3, valorPago: 400, pagoEm: '2026-08-10', jaComissionada: true },
        { ...base, fatura: 4, numeroParcela: 9, valorPago: 400, pagoEm: '2026-08-10' },
      ],
      regra,
    );
    expect(itens.map((i) => [i.fatura, i.tipo, i.valor, i.pendente])).toEqual([
      [1, 'comissao', 400, false],
      [2, 'pendencia', 120, true],
    ]);
    expect(totaisDaComissao(itens, { irrf: 1.5, iss: 0 })).toEqual({
      bruto: 400,
      estorno: 0,
      irrf: 0,
      iss: 0,
      liquido: 400,
    });
    expect(
      totaisDaComissao(
        [
          { valor: 1000, pendente: false },
          { valor: -200, pendente: false },
        ],
        { irrf: 1.5, iss: 2 },
      ),
    ).toEqual({
      bruto: 1000,
      estorno: 200,
      irrf: 12,
      iss: 16,
      liquido: 772,
    });
  });
  it('inadimplência após 60 dias; estorno só dentro do prazo, uma vez, com a permanência', () => {
    expect(inadimplenteDesde(['2026-08-10', '2026-07-10'], '2026-09-08')).toBe('2026-09-08');
    expect(inadimplenteDesde(['2026-07-10'], '2026-09-07')).toBeNull();
    const s = {
      contrato: 1,
      motivo: 'cancelamento' as const,
      vendidoEm: '2026-05-01',
      comissaoPaga: 400,
      jaEstornado: false,
    };
    expect(apurarEstornos([{ ...s, saidaEm: '2026-07-30' }], 90)).toEqual([
      { contrato: 1, motivo: 'cancelamento', diasPermanencia: 90, valor: -400 },
    ]);
    expect(apurarEstornos([{ ...s, saidaEm: '2026-08-30' }], 90)).toEqual([]);
    expect(apurarEstornos([{ ...s, saidaEm: '2026-06-01', jaEstornado: true }], 90)).toEqual([]);
  });
  it('lote: fechar só calculado; reabrir e cancelar com motivo; pago é final', () => {
    expect(cod(problemasDaMudancaComissao('aberta', 'fechada', null))).toEqual([
      'comissao-transicao-invalida',
    ]);
    expect(problemasDaMudancaComissao('calculada', 'fechada', null)).toEqual([]);
    expect(cod(problemasDaMudancaComissao('fechada', 'calculada', ''))).toEqual(['comissao-sem-motivo']);
    expect(cod(problemasDaMudancaComissao('paga', 'cancelada', 'x'))).toEqual([
      'comissao-transicao-invalida',
    ]);
  });
});

describe('metas e campanhas', () => {
  const faixas = [
    { de: 0, ate: 49, percentualPremio: null, valorPremio: 0 },
    { de: 50, ate: 99, percentualPremio: 2, valorPremio: null },
    { de: 100, ate: null, percentualPremio: 5, valorPremio: null },
  ];
  it('meta com faixas sem sobreposição; apuração dá o atingido e a faixa', () => {
    expect(
      problemasDaMeta({
        descricao: 'Vidas',
        inicio: '2026-11-01',
        fim: '2026-11-30',
        valorMeta: 100,
        faixas,
      }),
    ).toEqual([]);
    expect(
      cod(
        problemasDaMeta({
          descricao: '',
          inicio: '2026-11-30',
          fim: '2026-11-01',
          valorMeta: 0,
          faixas: [faixas[0]!, { ...faixas[1]!, de: 40 }],
        }),
      ),
    ).toEqual(['meta-sem-descricao', 'meta-periodo-invalido', 'meta-valor-invalido', 'faixa-sobreposta']);
    expect(apurarMeta({ valorMeta: 100, faixas }, 60)).toEqual({
      realizado: 60,
      atingido: 60,
      faixa: 2,
      percentualPremio: 2,
      valorPremio: null,
    });
    expect(apurarMeta({ valorMeta: null, faixas: [] }, 3).faixa).toBeNull();
  });
  it('campanha: desconto por percentual ou valor; ativa só com desconto; desconto só na venda do período', () => {
    const c = {
      codigo: 'C1',
      descricao: 'Campanha',
      inicio: '2026-11-01',
      fim: '2026-11-30',
      descontos: [{ parcela: 1, percentual: 50, valor: null }],
    };
    expect(problemasDaCampanha(c)).toEqual([]);
    expect(
      cod(
        problemasDaCampanha({
          ...c,
          descontos: [
            { parcela: 1, percentual: 10, valor: 5 },
            { parcela: 1, percentual: 120, valor: null },
          ],
        }),
      ),
    ).toEqual(['desconto-forma', 'desconto-parcela-repetida', 'desconto-percentual-invalido']);
    expect(cod(problemasDaMudancaCampanha('planejada', 'ativa', 0))).toEqual(['campanha-sem-desconto']);
    expect(cod(problemasDaMudancaCampanha('encerrada', 'ativa', 1))).toEqual(['campanha-transicao-invalida']);
    expect(descontoNaParcela({ ...c, situacao: 'ativa' }, '2026-11-10', 1, 400)).toBe(200);
    expect(descontoNaParcela({ ...c, situacao: 'ativa' }, '2026-12-10', 1, 400)).toBe(0);
    expect(descontoNaParcela({ ...c, situacao: 'planejada' }, '2026-11-10', 1, 400)).toBe(0);
  });
});
