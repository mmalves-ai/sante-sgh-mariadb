import { FONTES_FATO } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { linha } from './fixtures.spec-util.js';
import {
  DERIVADORES,
  derivarDepreciacao,
  derivarFolha,
  derivarImpairment,
  derivarMovimentoBancario,
  derivarNotaEntrada,
  derivarRecibo,
  derivarSaidaEstoque,
  derivarTituloPagar,
  derivarTituloReceber,
} from './fontes.js';
import { conciliarFatos, estornoDe } from './derivacao.js';

const ctx = { empresa: 1 };

describe('derivadores das fontes', () => {
  it('toda fonte tem derivador, inclusive a folha do M53 (SGH_PES_FOLHA_FATO)', () => {
    for (const f of FONTES_FATO) expect(DERIVADORES[f.tabela], f.tabela).toBeTypeOf('function');
  });

  it('título a pagar: lançamento e pagamento', () => {
    const l = linha('MFCONPAG', 7, {
      EMISSAO: '2027-01-05',
      VALOR: 300,
      DT_PGTO: '1899-12-30',
      PAGO: 0,
      ID_MFTIPOLANC: 2,
      TIPO: 'F',
      ONDE: 'C',
      ID_RPRPA: null,
      ID_TBCTABAN: 4,
    });
    expect(derivarTituloPagar(l, ctx).map((f) => [f.tipo, f.valorCentavos])).toEqual([
      ['tituloPagar', 30_000],
    ]);
    const pago = linha('MFCONPAG', 7, { ...l.valores, DT_PGTO: '2027-02-01', PAGO: 300 });
    const r = derivarTituloPagar(pago, ctx);
    expect(r.map((f) => f.tipo)).toEqual(['tituloPagar', 'baixaTituloPagar']);
    expect(r[1]!.campos).toMatchObject({ contaBancaria: 4, tipoLancamento: 2 });
    expect(derivarTituloPagar(linha('MFCONPAG', 8, { EMISSAO: null }), ctx)).toEqual([]);
  });

  it('título a receber: lançamento e recebimento, com o centro de custo', () => {
    const l = linha('MFCTAREC', 9, {
      APRES: '2027-01-10',
      VALOR: 1000,
      PGTO: '2027-03-01',
      VLR_PAG: 950,
      CONV: 5,
      CDC_DEB: 2,
    });
    const r = derivarTituloReceber(l, ctx);
    expect(r.map((f) => [f.tipo, f.valorCentavos, f.centroCusto])).toEqual([
      ['tituloReceber', 100_000, 2],
      ['baixaTituloReceber', 95_000, 2],
    ]);
    expect(
      derivarTituloReceber(linha('MFCTAREC', 1, { APRES: '1899-12-30', PGTO: '1899-12-30' }), ctx),
    ).toEqual([]);
  });

  it('movimento bancário', () => {
    const r = derivarMovimentoBancario(
      linha('MFLANCTO', 3, {
        DATA: '2027-01-02',
        VALOR: 12.34,
        TIPO_TRF: 'D',
        CDC_DEB: null,
        CDC_CRE: 6,
        ID_TBCTABAN_DEV: 1,
      }),
      ctx,
    );
    expect(r[0]).toMatchObject({ tipo: 'movimentoBancario', valorCentavos: 1234, centroCusto: 6 });
    expect(r[0]!.campos).toMatchObject({ tipoTransferencia: 'D', contaDebito: 1, contaCredito: null });
    expect(derivarMovimentoBancario(linha('MFLANCTO', 4, { DATA: null }), ctx)).toEqual([]);
  });

  it('saída de estoque: quantidade × preço médio, competência por ano e mês', () => {
    const r = derivarSaidaEstoque(
      linha('GELANSAI', 11, {
        ANO: 2027,
        MES: 2,
        QTDE: 2.5,
        VLRMED: 3.33,
        DOC: 77,
        ITEM: 900,
        CDC_DESTINO: 8,
        STATUS: 'N',
      }),
      ctx,
    );
    expect(r[0]).toMatchObject({
      tipo: 'saidaEstoque',
      data: '2027-02-01',
      valorCentavos: 833,
      centroCusto: 8,
    });
    const comData = derivarSaidaEstoque(
      linha('GELANSAI', 12, { DATA_SAIDA: '2027-02-14', QTDE: -1, VLRMED: 10 }),
      ctx,
    );
    expect(comData[0]).toMatchObject({ data: '2027-02-14', valorCentavos: -1000 });
    expect(derivarSaidaEstoque(linha('GELANSAI', 13, { ANO: 2027, MES: 13 }), ctx)).toEqual([]);
  });

  it('nota de entrada e recibo', () => {
    expect(
      derivarNotaEntrada(linha('GECADNFS', 1, { DATA: '2027-01-03', TOTAL: 99.9, NAT_OP: 1102 }), ctx)[0],
    ).toMatchObject({
      tipo: 'notaEntrada',
      valorCentavos: 9990,
    });
    expect(derivarNotaEntrada(linha('GECADNFS', 2, {}), ctx)).toEqual([]);
    expect(
      derivarRecibo(
        linha('RPRPA', 5, { EMISSAO: '2027-01-31', VALOR_TITULOS: 500, STATUS: 'E', TIPO: 'M' }),
        ctx,
      )[0],
    ).toMatchObject({
      tipo: 'recibo',
      valorCentavos: 50_000,
    });
    expect(derivarRecibo(linha('RPRPA', 6, { EMISSAO: '2027-01-31', STATUS: 'C' }), ctx)).toEqual([]);
  });

  it('folha: custo de pessoal no último dia da competência; rubrica fora da contabilização não gera fato', () => {
    const l = linha('SGH_PES_FOLHA_FATO', 9, {
      ID_LANCAMENTO: 3,
      COD_EMP: 1,
      PERIODO: '2027-02',
      ROTINA: 1,
      ID_TBCENCUS: 12,
      NATUREZA: 'encargo',
      CONTABILIZA: 'S',
      VALOR_CENTAVOS: 123_456,
    });
    const [f, ...resto] = derivarFolha(l, ctx);
    expect(resto).toEqual([]);
    expect(f).toMatchObject({ tipo: 'folha', data: '2027-02-28', valorCentavos: 123_456, centroCusto: 12 });
    expect(f!.campos).toEqual({ rotina: 1, natureza: 'encargo', empresaFolha: 1 });
    expect(derivarFolha(linha('SGH_PES_FOLHA_FATO', 9, { ...l.valores, CONTABILIZA: 'N' }), ctx)).toEqual([]);
    expect(derivarFolha(linha('SGH_PES_FOLHA_FATO', 9, { ...l.valores, PERIODO: '2027-13' }), ctx)).toEqual(
      [],
    );
    expect(derivarFolha(linha('SGH_PES_FOLHA_FATO', 9, { ...l.valores, VALOR_CENTAVOS: 0 }), ctx)).toEqual(
      [],
    );
  });

  it('depreciação (M54.6): a cota do bem no último dia da competência, pelo centro de custo, com o grupo nos campos', () => {
    const l = linha('SGH_PAT_DEPRECIACAO', 11, {
      ID_BEM: 4,
      EMPRESA: 1,
      COMPETENCIA: '2027-02',
      ID_TBCENCUS: 12,
      GRUPO: 'informatica',
      PLAQUETA: 'PC000004',
      VALOR_CENT: 100_00,
    });
    expect(derivarDepreciacao(l, ctx)).toEqual([
      {
        tipo: 'depreciacao',
        data: '2027-02-28',
        valorCentavos: 100_00,
        centroCusto: 12,
        documento: 'depreciação 2027-02 bem PC000004',
        campos: { grupoBem: 'informatica', bem: 4, empresaBem: 1 },
      },
    ]);
    expect(
      derivarDepreciacao(linha('SGH_PAT_DEPRECIACAO', 11, { ...l.valores, VALOR_CENT: 0 }), ctx),
    ).toEqual([]);
    expect(
      derivarDepreciacao(linha('SGH_PAT_DEPRECIACAO', 11, { ...l.valores, COMPETENCIA: 'x' }), ctx),
    ).toEqual([]);
    expect(
      derivarDepreciacao(
        linha('SGH_PAT_DEPRECIACAO', 11, { ...l.valores, GRUPO: null, PLAQUETA: null }),
        ctx,
      )[0],
    ).toMatchObject({ documento: 'depreciação 2027-02 bem', campos: { grupoBem: null } });
  });

  it('W0-08: a cota do cálculo estornado deixa de ser fato e a conciliação lança o estorno com motivo, data e origem', () => {
    const valores = {
      ID_BEM: 4,
      EMPRESA: 1,
      COMPETENCIA: '2027-02',
      ID_TBCENCUS: 12,
      GRUPO: 'informatica',
      PLAQUETA: 'PC000004',
      VALOR_CENT: 100_00,
      ESTORNADO_EM: null,
      MOTIVO_ESTORNO: null,
    };
    const antes = linha('SGH_PAT_DEPRECIACAO', 11, valores);
    const [original] = conciliarFatos(antes, derivarDepreciacao, [], ctx, '2027-03-10');
    expect(original).toMatchObject({ estorno: false, data: '2027-02-28', valorCentavos: 100_00 });
    const depois = linha('SGH_PAT_DEPRECIACAO', 11, {
      ...valores,
      ESTORNADO_EM: '2027-03-15',
      MOTIVO_ESTORNO: 'vida útil errada no cadastro',
    });
    expect(derivarDepreciacao(depois, ctx)).toEqual([]);
    const r = conciliarFatos(depois, derivarDepreciacao, [original!], ctx, '2027-03-15');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      estorno: true,
      referencia: original!.impressao,
      data: '2027-03-15',
      competencia: '2027-03',
      origem: original!.origem,
      valorCentavos: 100_00,
      centroCusto: 12,
    });
    expect(r[0]!.documento).toBe(
      '2027-02 bem PC000004 estornada em 2027-03-15 no patrimônio: vida útil errada no cadastro'.slice(0, 80),
    );
    // Sem estorno do cálculo, o fato que some leva o documento do original (o comportamento das outras fontes).
    expect(estornoDe(original!, '2027-03-15', null).documento).toBe('depreciação 2027-02 bem PC000004');
  });
  it('W0-08 (M1): só a perda por impairment vira fato (origem 7, data do ajuste); o estorno do ajuste lança o estorno com motivo, data e origem', () => {
    const valores = {
      ID_BEM: 4,
      EMPRESA: 1,
      TIPO: 'impairment',
      COMPETENCIA_MARCO: '2027-02',
      DATA_AJUSTE: '2027-03-05',
      ID_TBCENCUS: 12,
      GRUPO: 'informatica',
      PLAQUETA: 'PC000004',
      PERDA_CENT: 350_00,
      ESTORNADO_EM: null,
      MOTIVO_ESTORNO: null,
    };
    const l = linha('SGH_PAT_AJUSTE', 21, valores);
    expect(derivarImpairment(l, ctx)).toEqual([
      {
        tipo: 'impairment',
        data: '2027-03-05',
        valorCentavos: 350_00,
        centroCusto: 12,
        documento: 'impairment ajuste 21 bem PC000004',
        campos: { grupoBem: 'informatica', bem: 4, empresaBem: 1 },
      },
    ]);
    // Revisão de estimativa e reavaliação: eventos sem lançamento.
    for (const TIPO of ['revisao-estimativa', 'reavaliacao'])
      expect(
        derivarImpairment(linha('SGH_PAT_AJUSTE', 22, { ...valores, TIPO, PERDA_CENT: 0 }), ctx),
      ).toEqual([]);
    expect(derivarImpairment(linha('SGH_PAT_AJUSTE', 23, { ...valores, PERDA_CENT: 0 }), ctx)).toEqual([]);
    expect(derivarImpairment(linha('SGH_PAT_AJUSTE', 24, { ...valores, DATA_AJUSTE: null }), ctx)).toEqual(
      [],
    );
    const [original] = conciliarFatos(l, derivarImpairment, [], ctx, '2027-03-05');
    expect(original).toMatchObject({ estorno: false, valorCentavos: 350_00 });
    const depois = linha('SGH_PAT_AJUSTE', 21, {
      ...valores,
      ESTORNADO_EM: '2027-03-20',
      MOTIVO_ESTORNO: 'laudo substituído',
    });
    expect(derivarImpairment(depois, ctx)).toEqual([]);
    const r = conciliarFatos(depois, derivarImpairment, [original!], ctx, '2027-03-20');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      estorno: true,
      referencia: original!.impressao,
      data: '2027-03-20',
      origem: original!.origem,
      valorCentavos: 350_00,
      centroCusto: 12,
    });
    expect(r[0]!.documento).toBe(
      'impairment 21 bem PC000004 estornado em 2027-03-20 no patrimônio: laudo substituído'.slice(0, 80),
    );
  });
});
