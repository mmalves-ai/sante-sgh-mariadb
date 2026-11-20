// Regra 4: receita no fechamento da conta; glosa e recurso são ajustes, não exclusão; conta reaberta gera estorno.
import { describe, expect, it } from 'vitest';
import { linha } from './fixtures.spec-util.js';
import {
  conciliarFatos,
  dataValida,
  estornoDe,
  inteiroOuNulo,
  montarFato,
  textoOuVazio,
} from './derivacao.js';
import { derivarConta, derivarItemConta } from './receita.js';

const ctx = { empresa: 1 };
const contaFechada = (extra: Record<string, string | number | null> = {}) =>
  linha('FCCTAEXT', 10, {
    FECHADA: 'S',
    DATA_FEC: '2027-01-20',
    TOTAL_CONTA: 1500.5,
    CENCUS: 7,
    CON: 5,
    TIPO_CTA: 'I',
    ...extra,
  });

describe('receita da conta (regra 4)', () => {
  it('conta aberta não tem receita; fechada e apresentada têm, pelo total e na data do fechamento', () => {
    expect(derivarConta(contaFechada({ FECHADA: 'N' }), ctx)).toEqual([]);
    expect(derivarConta(contaFechada({ FECHADA: 'F' }), ctx)).toEqual([]);
    const [s] = derivarConta(contaFechada(), ctx);
    expect(s).toMatchObject({
      tipo: 'receitaConta',
      data: '2027-01-20',
      valorCentavos: 150_050,
      centroCusto: 7,
    });
    expect(s!.campos).toMatchObject({ convenio: 5, tipoConta: 'I', situacaoConta: 'S' });
    expect(derivarConta(contaFechada({ FECHADA: 'A' }), ctx)).toHaveLength(1);
    expect(derivarConta(contaFechada({ DATA_FEC: '1899-12-30' }), ctx)).toEqual([]);
  });

  it('fechar gera o fato; refechar igual não gera nada; mudar o total estorna e lança de novo', () => {
    const [f1] = conciliarFatos(contaFechada(), derivarConta, [], ctx, '2027-02-01');
    expect(f1).toMatchObject({ tipo: 'receitaConta', origem: 3, competencia: '2027-01', estorno: false });
    expect(conciliarFatos(contaFechada(), derivarConta, [f1!], ctx, '2027-02-01')).toEqual([]);
    const mudou = conciliarFatos(contaFechada({ TOTAL_CONTA: 1600 }), derivarConta, [f1!], ctx, '2027-02-03');
    expect(mudou.map((f) => [f.estorno, f.valorCentavos, f.competencia])).toEqual([
      [true, 150_050, '2027-02'],
      [false, 160_000, '2027-01'],
    ]);
    expect(mudou[0]!.referencia).toBe(f1!.impressao);
  });

  it('conta reaberta: só o estorno, no período da reabertura (nunca exclusão)', () => {
    const [f1] = conciliarFatos(contaFechada(), derivarConta, [], ctx, '2027-01-20');
    const r = conciliarFatos(contaFechada({ FECHADA: 'N' }), derivarConta, [f1!], ctx, '2027-03-02');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      estorno: true,
      valorCentavos: 150_050,
      data: '2027-03-02',
      competencia: '2027-03',
    });
  });

  it('fatos ativos de outra linha ou já estornados não entram na conciliação', () => {
    const [f1] = conciliarFatos(contaFechada(), derivarConta, [], ctx, '2027-01-20');
    const outro = { ...f1!, id: 99 };
    const est = estornoDe(f1!, '2027-02-01', null);
    expect(
      conciliarFatos(contaFechada({ FECHADA: 'N' }), derivarConta, [outro, est], ctx, '2027-03-02'),
    ).toEqual([]);
  });
});

describe('glosa e recurso como ajuste (regra 4)', () => {
  const item = (extra: Record<string, string | number | null> = {}) =>
    linha('FCLANEXT', 500, {
      ID_FCCTAEXT: 10,
      CONVENIO: 5,
      CDC: 3,
      GLOSADO: 'T',
      DT_PG: '2027-02-10',
      VALOR_C: 100,
      VLR_PG: 80,
      DT_RP: null,
      VLR_RP: 0,
      ...extra,
    });

  it('glosa = cobrado − pago no item baixado', () => {
    const r = derivarItemConta(item(), ctx);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      tipo: 'ajusteGlosa',
      valorCentavos: 2000,
      data: '2027-02-10',
      centroCusto: 3,
    });
    expect(r[0]!.campos).toEqual({ convenio: 5, conta: 10 });
  });

  it('item não baixado, sem data de pagamento ou pago inteiro não tem glosa', () => {
    expect(derivarItemConta(item({ GLOSADO: 'F' }), ctx)).toEqual([]);
    expect(derivarItemConta(item({ DT_PG: '1899-12-30' }), ctx)).toEqual([]);
    expect(derivarItemConta(item({ VLR_PG: 100 }), ctx)).toEqual([]);
  });

  it('recurso acatado só com a data do retorno gravada; glosa e recurso no mesmo item', () => {
    expect(derivarItemConta(item({ VLR_RP: 20 }), ctx)).toHaveLength(1);
    const r = derivarItemConta(item({ VLR_RP: 20, DT_RP: '2027-04-05' }), ctx);
    expect(r.map((f) => [f.tipo, f.valorCentavos, f.data])).toEqual([
      ['ajusteGlosa', 2000, '2027-02-10'],
      ['ajusteRecurso', 2000, '2027-04-05'],
    ]);
  });

  it('a glosa vista depois do recurso não muda o fato da glosa (impressões por tipo)', () => {
    const antes = conciliarFatos(item(), derivarItemConta, [], ctx, '2027-02-10');
    const depois = conciliarFatos(
      item({ VLR_RP: 20, DT_RP: '2027-04-05' }),
      derivarItemConta,
      antes,
      ctx,
      '2027-04-05',
    );
    expect(depois.map((f) => f.tipo)).toEqual(['ajusteRecurso']);
  });
});

describe('auxiliares da derivação', () => {
  it('datas, inteiros e textos', () => {
    expect(dataValida('2027-01-02T10:00:00')).toBe('2027-01-02');
    expect(dataValida('9999-12-31')).toBeNull();
    expect(dataValida(20270102)).toBeNull();
    expect(dataValida('x')).toBeNull();
    expect(inteiroOuNulo('12')).toBe(12);
    expect(inteiroOuNulo('1.5')).toBeNull();
    expect(inteiroOuNulo('')).toBeNull();
    expect(inteiroOuNulo(undefined)).toBeNull();
    expect(textoOuVazio(null)).toBe('');
    expect(textoOuVazio(' a ')).toBe('a');
  });

  it('a impressão do fato muda com o efeito contábil, não com a coluna irrelevante', () => {
    const b = derivarConta(contaFechada(), ctx)[0]!;
    const l1 = contaFechada({ OUTRA: 'x' });
    const l2 = contaFechada({ OUTRA: 'y' });
    expect(montarFato(l1, b, ctx).impressao).toBe(montarFato(l2, b, ctx).impressao);
    expect(montarFato(l1, { ...b, valorCentavos: 1 }, ctx).impressao).not.toBe(
      montarFato(l1, b, ctx).impressao,
    );
  });

  it('fato de valor zero não entra', () => {
    expect(conciliarFatos(contaFechada({ TOTAL_CONTA: 0 }), derivarConta, [], ctx, '2027-01-20')).toEqual([]);
  });
});
