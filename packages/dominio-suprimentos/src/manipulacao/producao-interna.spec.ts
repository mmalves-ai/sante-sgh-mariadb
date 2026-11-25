// C1-124 (05-SUP linha 12): o fechamento da ordem de manipulação baixada vira o lote produzido e o kit montado entra
// no estoque com a composição do kit padrão consumida; validade, rendimento, custos e saldo conferidos.
import { describe, expect, it } from 'vitest';
import {
  conferirFechamentoProducao,
  conferirMontagemKit,
  conferirValidadeDoKit,
  consumoDaMontagem,
  custoDoLote,
  type FechamentoParaConferir,
  type MontagemParaConferir,
  numeroLoteProduzido,
} from '../index.js';

const fech: FechamentoParaConferir = {
  situacao: 'baixada',
  jaTemLote: false,
  quantidadePrevista: 10,
  quantidadeProduzida: 9,
  perda: 1,
  produzidoEm: '2026-11-25T10:00',
  validadeEm: '2026-11-26T10:00',
  numeroLote: null,
  custos: [{ custo: 1, quantidade: 1, valorUnitario: 12.5 }],
};
const cf = (x: Partial<FechamentoParaConferir>) =>
  conferirFechamentoProducao({ ...fech, ...x }).map((r) => r.codigo);

const mont: MontagemParaConferir = {
  kitAtivo: true,
  produto: 99,
  componentes: [
    { insumo: 1, nome: 'GAZE', quantidade: 2, saldo: 10 },
    { insumo: 2, nome: 'LUVA', quantidade: 1, saldo: 3 },
  ],
  quantidadeKits: 3,
  produzidoEm: '2026-11-25T10:00',
  validadeEm: '2026-12-25T10:00',
  numeroLote: 'KT-1',
  custos: [],
};
const cm = (x: Partial<MontagemParaConferir>) => conferirMontagemKit({ ...mont, ...x }).map((r) => r.codigo);

describe('fechamento da produção da ordem (lote produzido)', () => {
  it('aceita a ordem baixada com quantidade, perda, validade e custos válidos', () => {
    expect(cf({})).toEqual([]);
  });
  it('só a ordem baixada e uma vez', () => {
    expect(cf({ situacao: 'conferida' })).toEqual(['ordem-nao-baixada']);
    expect(cf({ jaTemLote: true })).toEqual(['producao-ja-fechada']);
  });
  it('quantidade e perda: produzido > 0, perda >= 0 e rendimento até 10% acima do previsto', () => {
    expect(cf({ quantidadeProduzida: 0 })).toEqual(['quantidade-invalida']);
    expect(cf({ perda: -1 })).toEqual(['perda-invalida']);
    expect(cf({ quantidadeProduzida: 10, perda: 1 })).toEqual([]);
    expect(cf({ quantidadeProduzida: 11, perda: 0.5 })).toEqual(['rendimento-acima']);
  });
  it('validade com hora e depois da produção; número do lote no formato', () => {
    expect(cf({ validadeEm: '2026-11-25T10:00' })).toEqual(['validade-invalida']);
    expect(cf({ validadeEm: '2026-11-26' })).toEqual(['validade-invalida']);
    expect(cf({ numeroLote: 'LOTE 1' })).toEqual(['numero-lote-invalido']);
    expect(cf({ numeroLote: 'MP-2026/11.A' })).toEqual([]);
  });
  it('custo indireto uma vez por lote, quantidade > 0 e valor não negativo', () => {
    expect(cf({ custos: [fech.custos[0]!, fech.custos[0]!] })).toEqual(['custo-repetido']);
    expect(cf({ custos: [{ custo: 2, quantidade: 0, valorUnitario: 1 }] })).toEqual(['custo-invalido']);
    expect(cf({ custos: [{ custo: 2, quantidade: 1, valorUnitario: -1 }] })).toEqual(['custo-invalido']);
  });
  it('o custo do lote soma insumos, indiretos e adicional, com as parcelas e o custo por unidade', () => {
    const c = custoDoLote(
      100,
      [
        { custo: 1, quantidade: 2, valorUnitario: 7.255 },
        { custo: 2, quantidade: 1, valorUnitario: 10 },
      ],
      5,
      8,
    );
    expect(c.custos.map((x) => x.valorTotal)).toEqual([14.51, 10]);
    expect(c.valorIndireto).toBe(24.51);
    expect(c.valorTotal).toBe(129.51);
    expect(c.custoUnitario).toBe(16.1888);
    expect(custoDoLote(10, [], 0, 0).custoUnitario).toBe(0);
  });
  it('número do lote gerado pelo tipo, o dia e a sequência', () => {
    expect(numeroLoteProduzido('manipulacao', '2026-11-25', 7)).toBe('MP-20261125-0007');
    expect(numeroLoteProduzido('kit_montado', '2026-11-25', 12345)).toBe('KT-20261125-12345');
  });
});

describe('kit montado na produção interna', () => {
  it('consome a composição vezes os kits', () => {
    expect(consumoDaMontagem(mont.componentes, 3)).toEqual([
      { insumo: 1, quantidade: 6 },
      { insumo: 2, quantidade: 3 },
    ]);
    expect(cm({})).toEqual([]);
  });
  it('recusa kit inativo, sem composição e o produto como componente', () => {
    expect(cm({ kitAtivo: false })).toEqual(['kit-inativo']);
    expect(cm({ componentes: [] })).toEqual(['kit-sem-itens']);
    expect(cm({ produto: 1 })).toEqual(['produto-no-kit']);
  });
  it('kits inteiros de 1 a 500 e saldo de cada componente no local', () => {
    expect(cm({ quantidadeKits: 0 })).toEqual(['quantidade-invalida']);
    expect(cm({ quantidadeKits: 1.5 })).toEqual(['quantidade-invalida']);
    expect(cm({ quantidadeKits: 501 })).toEqual(['quantidade-invalida']);
    const r = conferirMontagemKit({ ...mont, quantidadeKits: 4 });
    expect(r.map((x) => x.codigo)).toEqual(['saldo-insuficiente']);
    expect(r[0]!.mensagem).toContain('1 componente(s): LUVA');
  });
  it('validade depois da produção e nunca acima do lote do componente que vence primeiro', () => {
    expect(cm({ validadeEm: '2026-11-24T10:00' })).toEqual(['validade-invalida']);
    expect(
      conferirValidadeDoKit('2027-01-10T10:00', ['2027-03-31', '2027-01-09']).map((x) => x.codigo),
    ).toEqual(['validade-acima-componente']);
    expect(conferirValidadeDoKit('2027-01-09T23:00', ['2027-03-31', '2027-01-09'])).toEqual([]);
    expect(conferirValidadeDoKit('2030-01-01T00:00', [])).toEqual([]);
  });
});
