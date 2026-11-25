import { FONTES_FATO } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { linha } from './fixtures.spec-util.js';
import {
  DERIVADORES,
  derivarMovimentoBancario,
  derivarNotaEntrada,
  derivarRecibo,
  derivarSaidaEstoque,
  derivarTituloPagar,
  derivarTituloReceber,
} from './fontes.js';

const ctx = { empresa: 1 };

describe('derivadores das fontes', () => {
  it('toda fonte lida tem derivador; a publicada pelo módulo na transação do documento não tem (ADR 0003)', () => {
    for (const f of FONTES_FATO)
      if (f.publicada) expect(DERIVADORES[f.tabela], f.tabela).toBeUndefined();
      else expect(DERIVADORES[f.tabela], f.tabela).toBeTypeOf('function');
    expect(FONTES_FATO.filter((f) => f.publicada).map((f) => f.tabela)).toEqual([
      'lancamento_titulos_folha',
      'cota_depreciacao',
      'ajuste_valor_bem',
      'lancamento_repasse',
    ]);
  });

  it('título a pagar: lançamento e pagamento', () => {
    const l = linha('titulo_pagar', 7, {
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
    const pago = linha('titulo_pagar', 7, { ...l.valores, DT_PGTO: '2027-02-01', PAGO: 300 });
    const r = derivarTituloPagar(pago, ctx);
    expect(r.map((f) => f.tipo)).toEqual(['tituloPagar', 'baixaTituloPagar']);
    expect(r[1]!.campos).toMatchObject({ contaBancaria: 4, tipoLancamento: 2 });
    expect(derivarTituloPagar(linha('titulo_pagar', 8, { EMISSAO: null }), ctx)).toEqual([]);
  });

  it('título a receber: lançamento e recebimento, com o centro de custo', () => {
    const l = linha('titulo_receber', 9, {
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
      derivarTituloReceber(linha('titulo_receber', 1, { APRES: '1899-12-30', PGTO: '1899-12-30' }), ctx),
    ).toEqual([]);
  });

  it('movimento bancário', () => {
    const r = derivarMovimentoBancario(
      linha('movimento_bancario', 3, {
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
    expect(derivarMovimentoBancario(linha('movimento_bancario', 4, { DATA: null }), ctx)).toEqual([]);
  });

  it('saída de estoque: quantidade × preço médio, competência por ano e mês', () => {
    const r = derivarSaidaEstoque(
      linha('movimento_estoque', 11, {
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
      linha('movimento_estoque', 12, { DATA_SAIDA: '2027-02-14', QTDE: -1, VLRMED: 10 }),
      ctx,
    );
    expect(comData[0]).toMatchObject({ data: '2027-02-14', valorCentavos: -1000 });
    expect(derivarSaidaEstoque(linha('movimento_estoque', 13, { ANO: 2027, MES: 13 }), ctx)).toEqual([]);
  });

  it('nota de entrada e recibo', () => {
    expect(
      derivarNotaEntrada(linha('nota_entrada', 1, { DATA: '2027-01-03', TOTAL: 99.9, NAT_OP: 1102 }), ctx)[0],
    ).toMatchObject({
      tipo: 'notaEntrada',
      valorCentavos: 9990,
    });
    expect(derivarNotaEntrada(linha('nota_entrada', 2, {}), ctx)).toEqual([]);
    expect(
      derivarRecibo(
        linha('recibo_autonomo', 5, { EMISSAO: '2027-01-31', VALOR_TITULOS: 500, STATUS: 'E', TIPO: 'M' }),
        ctx,
      )[0],
    ).toMatchObject({
      tipo: 'recibo',
      valorCentavos: 50_000,
    });
    expect(derivarRecibo(linha('recibo_autonomo', 6, { EMISSAO: '2027-01-31', STATUS: 'C' }), ctx)).toEqual(
      [],
    );
  });
});
