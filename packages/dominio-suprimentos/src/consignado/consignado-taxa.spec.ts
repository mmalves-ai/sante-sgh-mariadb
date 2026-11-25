// Taxa de comercialização do consignado por faixa de valor (05-SUP linha 24): a tabela nova conferida (faixas contíguas
// a partir de zero, percentual de 0 a 1000, teto positivo, vigência que não começa no passado), a tabela do fornecedor
// acima da geral, a faixa semiaberta, o teto, e o plano da gravação que fecha a vigente na véspera sem apagar nada.
import { describe, expect, it } from 'vitest';
import {
  calcularTaxaConsignacao,
  conferirTabelaTaxaConsignacao,
  type FaixaTaxaConsignacao,
  planejarTabelaTaxaConsignacao,
  tabelaTaxaVigente,
  taxaDoFaturamentoConsignado,
  vesperaIso,
} from '../index.js';

const HOJE = '2026-11-25';
const f = (x: Partial<FaixaTaxaConsignacao>): FaixaTaxaConsignacao => ({
  id: 1,
  fornecedor: null,
  inicio: '2026-01-01',
  fim: null,
  valorInicial: 0,
  valorFinal: null,
  percentual: 10,
  teto: null,
  ...x,
});

const GERAL = [
  f({ id: 1, valorInicial: 0, valorFinal: 1000, percentual: 30 }),
  f({ id: 2, valorInicial: 1000, valorFinal: 10000, percentual: 15 }),
  f({ id: 3, valorInicial: 10000, valorFinal: null, percentual: 8, teto: 2000 }),
];
const DO_FORNECEDOR = [
  f({ id: 4, fornecedor: 7, valorInicial: 0, valorFinal: 5000, percentual: 20 }),
  f({ id: 5, fornecedor: 7, valorInicial: 5000, valorFinal: null, percentual: 5 }),
];

describe('conferirTabelaTaxaConsignacao', () => {
  const ok = { fornecedor: null, inicio: HOJE, faixas: GERAL };
  it('aceita a tabela contígua a partir de zero', () => {
    expect(conferirTabelaTaxaConsignacao(ok, HOJE)).toEqual([]);
  });
  it('recusa início no passado, tabela vazia e faixa que não começa em zero', () => {
    expect(conferirTabelaTaxaConsignacao({ ...ok, inicio: '2026-11-24' }, HOJE).map((r) => r.codigo)).toEqual(
      ['inicio-no-passado'],
    );
    expect(conferirTabelaTaxaConsignacao({ ...ok, faixas: [] }, HOJE).map((r) => r.codigo)).toEqual([
      'sem-faixas',
    ]);
    expect(
      conferirTabelaTaxaConsignacao({ ...ok, faixas: [f({ valorInicial: 10 })] }, HOJE).map((r) => r.codigo),
    ).toEqual(['faixa-sem-zero']);
  });
  it('recusa buraco, cruzamento, faixa aberta no meio e faixa invertida', () => {
    const cod = (faixas: FaixaTaxaConsignacao[]) =>
      conferirTabelaTaxaConsignacao({ ...ok, faixas }, HOJE).map((r) => r.codigo);
    expect(cod([f({ valorFinal: 100 }), f({ valorInicial: 200 })])).toEqual(['faixas-com-buraco']);
    expect(cod([f({ valorFinal: 300 }), f({ valorInicial: 200 })])).toEqual(['faixas-cruzadas']);
    expect(cod([f({ valorFinal: null }), f({ valorInicial: 200 })])).toEqual(['faixa-aberta-no-meio']);
    expect(cod([f({ valorFinal: 0 })])).toEqual(['faixa-invertida']);
  });
  it('recusa percentual fora de 0 a 1000 e teto não positivo', () => {
    const cod = (x: Partial<FaixaTaxaConsignacao>) =>
      conferirTabelaTaxaConsignacao({ ...ok, faixas: [f(x)] }, HOJE).map((r) => r.codigo);
    expect(cod({ percentual: -1 })).toEqual(['percentual-invalido']);
    expect(cod({ percentual: 1000.01 })).toEqual(['percentual-invalido']);
    expect(cod({ percentual: 1000 })).toEqual([]);
    expect(cod({ teto: 0 })).toEqual(['teto-invalido']);
  });
});

describe('tabelaTaxaVigente e calcularTaxaConsignacao', () => {
  const todas = [...GERAL, ...DO_FORNECEDOR];
  it('a tabela do fornecedor vale acima da geral; sem ela, a geral', () => {
    expect(tabelaTaxaVigente(todas, 7, HOJE).map((x) => x.id)).toEqual([4, 5]);
    expect(tabelaTaxaVigente(todas, 8, HOJE).map((x) => x.id)).toEqual([1, 2, 3]);
    expect(tabelaTaxaVigente(todas, null, HOJE).map((x) => x.id)).toEqual([1, 2, 3]);
  });
  it('a faixa é semiaberta: o valor final é o começo da próxima', () => {
    const r = calcularTaxaConsignacao(todas, 8, 1000, HOJE);
    expect(r).toMatchObject({ origem: 'geral', percentual: 15, taxaBruta: 150, taxa: 150, total: 1150 });
    expect(r.faixa?.id).toBe(2);
    expect(calcularTaxaConsignacao(todas, 8, 999.99, HOJE)).toMatchObject({ percentual: 30, taxa: 300 });
  });
  it('o teto limita a taxa, com a parcela bruta impressa', () => {
    expect(calcularTaxaConsignacao(todas, null, 50000, HOJE)).toMatchObject({
      percentual: 8,
      taxaBruta: 4000,
      teto: 2000,
      taxa: 2000,
      total: 52000,
    });
  });
  it('do fornecedor e sem tabela vigente', () => {
    expect(calcularTaxaConsignacao(todas, 7, 6000.555, HOJE)).toMatchObject({
      origem: 'fornecedor',
      valor: 6000.56,
      taxa: 300.03,
      total: 6300.59,
    });
    const r = calcularTaxaConsignacao(todas, 7, 100, '2025-12-31');
    expect(r).toMatchObject({ origem: 'sem-tabela', taxa: 0, total: 100, faixa: null });
  });
  it('a faixa vencida não vale', () => {
    const vencida = [f({ fim: '2026-11-24', percentual: 50 }), f({ id: 9, inicio: HOJE, percentual: 12 })];
    expect(calcularTaxaConsignacao(vencida, null, 100, HOJE)).toMatchObject({ percentual: 12, taxa: 12 });
  });
});

describe('taxaDoFaturamentoConsignado', () => {
  it('o valor do material é o custo unitário × quantidade, e a faixa é a da tabela do fornecedor no dia', () => {
    expect(taxaDoFaturamentoConsignado([...GERAL, ...DO_FORNECEDOR], 7, 3000, 2, HOJE)).toEqual({
      valorMaterial: 6000,
      faixa: 5,
      origem: 'fornecedor',
      percentual: 5,
      taxaBruta: 300,
      teto: null,
      taxa: 300,
    });
  });
  it('sem tabela do fornecedor, a geral com o teto; sem tabela nenhuma, taxa zero', () => {
    expect(taxaDoFaturamentoConsignado(GERAL, 9, 20000, 1, HOJE)).toMatchObject({
      faixa: 3,
      origem: 'geral',
      taxaBruta: 1600,
      taxa: 1600,
    });
    expect(taxaDoFaturamentoConsignado(GERAL, 9, 15000, 2, HOJE)).toMatchObject({
      taxaBruta: 2400,
      taxa: 2000,
    });
    expect(taxaDoFaturamentoConsignado([], 9, 100, 1, HOJE)).toMatchObject({
      valorMaterial: 100,
      faixa: null,
      origem: 'sem-tabela',
      taxa: 0,
    });
  });
});

describe('planejarTabelaTaxaConsignacao', () => {
  it('fecha a vigente do mesmo escopo na véspera e não toca na de outro fornecedor', () => {
    const p = planejarTabelaTaxaConsignacao(
      { fornecedor: 7, inicio: '2026-12-01', faixas: [f({ fornecedor: 7 })] },
      [...GERAL, ...DO_FORNECEDOR],
      HOJE,
    );
    expect(p.recusas).toEqual([]);
    expect(p.fechar).toEqual([4, 5]);
    expect(p.fim).toBe('2026-11-30');
  });
  it('substitui a tabela do mesmo escopo que começa nessa data ou depois e não foi cobrada (fica inativa)', () => {
    const p = planejarTabelaTaxaConsignacao(
      { fornecedor: null, inicio: HOJE, faixas: [f({})] },
      [f({ id: 11, inicio: '2026-12-10' }), f({ id: 12, inicio: HOJE })],
      HOJE,
    );
    expect(p.recusas).toEqual([]);
    expect(p.desativar).toEqual([11, 12]);
    expect(p.fechar).toEqual([]);
  });
  it('recusa substituir a tabela já usada em cobrança', () => {
    const p = planejarTabelaTaxaConsignacao(
      { fornecedor: null, inicio: HOJE, faixas: [f({})] },
      [{ ...f({ id: 12, inicio: HOJE }), usada: true }],
      HOJE,
    );
    expect(p.recusas.map((r) => r.codigo)).toEqual(['tabela-ja-cobrada']);
  });
  it('a anterior que fechava na véspera da substituída passa a fechar na véspera da nova', () => {
    const p = planejarTabelaTaxaConsignacao(
      { fornecedor: null, inicio: '2026-12-20', faixas: [f({})] },
      [f({ id: 1, inicio: '2026-01-01', fim: '2026-12-09' }), f({ id: 2, inicio: '2026-12-10' })],
      HOJE,
    );
    expect(p.recusas).toEqual([]);
    expect(p.desativar).toEqual([]);
    expect(p.fechar).toEqual([2]);
    const q = planejarTabelaTaxaConsignacao(
      { fornecedor: null, inicio: '2026-12-05', faixas: [f({})] },
      [f({ id: 1, inicio: '2026-01-01', fim: '2026-12-09' }), f({ id: 2, inicio: '2026-12-10' })],
      HOJE,
    );
    expect(q.desativar).toEqual([2]);
    expect(q.fechar).toEqual([1]);
    expect(q.fim).toBe('2026-12-04');
  });
  it('véspera atravessa mês e ano', () => {
    expect(vesperaIso('2027-01-01')).toBe('2026-12-31');
    expect(vesperaIso('2028-03-01')).toBe('2028-02-29');
  });
});
