// Motor estoque → conta (F3.0): o preço do material ou medicamento na conta e o estorno do item na devolução.
// Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  estornoDoItemDeEstoque,
  negociadoDaConta,
  precoDoItemDeEstoque,
  type PrecoNegociadoEstoque,
  type ReferenciaEstoque,
} from '../index.js';

const conta = { plano: 7, tipoConta: 3, tabelaPreco: 11, basePreco: 'pmc' as const };
const neg = (x: Partial<PrecoNegociadoEstoque> & { id: number }): PrecoNegociadoEstoque => ({
  plano: null,
  tipoConta: null,
  tabelaPreco: null,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  valorUnitario: null,
  percentualAjuste: null,
  quantidadeFixa: null,
  ...x,
});
const ref = (x: Partial<ReferenciaEstoque> & { id: number }): ReferenciaEstoque => ({
  vigenciaInicio: '2026-01-01',
  precoFabrica: 8,
  precoMaximoConsumidor: 10,
  fatorDivisao: null,
  ...x,
});
const base = { dataBase: '2026-11-24', quantidade: 2, fatorConversao: null, conta };

describe('preço do item de estoque na conta', () => {
  it('o negociado fixo vigente prevalece sobre a referência', () => {
    const p = precoDoItemDeEstoque({
      ...base,
      negociados: [neg({ id: 1, valorUnitario: 3.5 })],
      referencias: [ref({ id: 9 })],
    });
    expect(p).toMatchObject({ regra: 'negociado_fixo', valorUnitario: 3.5, quantidadeCobrada: 2, valorTotal: 7 });
    expect(p.negociado).toBe(1);
  });

  it('entre negociados vale o mais específico (plano > tipo de conta > tabela), depois a vigência mais recente', () => {
    const lista = [
      neg({ id: 1, valorUnitario: 1, tabelaPreco: 11 }),
      neg({ id: 2, valorUnitario: 2, tipoConta: 3 }),
      neg({ id: 3, valorUnitario: 3, plano: 7 }),
      neg({ id: 4, valorUnitario: 4, plano: 8 }),
      neg({ id: 5, valorUnitario: 5, plano: 7, vigenciaInicio: '2026-06-01' }),
      neg({ id: 6, valorUnitario: 6, plano: 7, vigenciaInicio: '2026-12-01' }),
    ];
    expect(negociadoDaConta(lista, conta, '2026-11-24')?.id).toBe(5);
    expect(negociadoDaConta(lista.slice(0, 2), conta, '2026-11-24')?.id).toBe(2);
    expect(negociadoDaConta([neg({ id: 9, valorUnitario: 1, vigenciaFim: '2026-10-31' })], conta, '2026-11-24')).toBeNull();
  });

  it('negociado percentual sobre a referência pela base da tabela, com o fator da embalagem e a conversão', () => {
    const p = precoDoItemDeEstoque({
      ...base,
      quantidade: 4,
      fatorConversao: 2,
      conta: { ...conta, basePreco: 'pf' },
      negociados: [neg({ id: 1, percentualAjuste: 10 })],
      referencias: [ref({ id: 9, precoFabrica: 20, fatorDivisao: 10 })],
    });
    // 20 / 10 = 2 por unidade da referência; +10% = 2,2; 4 unidades de estoque = 2 da referência.
    expect(p).toMatchObject({ regra: 'negociado_percentual', valorUnitario: 2.2, quantidadeCobrada: 2, valorTotal: 4.4 });
  });

  it('quantidade fixa negociada cobra a quantidade fixa', () => {
    const p = precoDoItemDeEstoque({
      ...base,
      quantidade: 3,
      negociados: [neg({ id: 1, valorUnitario: 50, quantidadeFixa: 1 })],
      referencias: [],
    });
    expect(p).toMatchObject({ quantidadeCobrada: 1, valorTotal: 50, quantidadeFixa: true });
  });

  it('sem negociado, a referência vigente (máximo ao consumidor sem base declarada; a outra base na falta)', () => {
    const refs = [ref({ id: 1, precoMaximoConsumidor: 9 }), ref({ id: 2, vigenciaInicio: '2026-09-01', precoMaximoConsumidor: 12 })];
    const p = precoDoItemDeEstoque({ ...base, conta: { ...conta, basePreco: null }, negociados: [], referencias: refs });
    expect(p).toMatchObject({ regra: 'referencia', valorUnitario: 12, valorTotal: 24, referencia: 2 });
    const q = precoDoItemDeEstoque({
      ...base,
      negociados: [],
      referencias: [ref({ id: 3, precoMaximoConsumidor: null, precoFabrica: 5 })],
    });
    expect(q.valorUnitario).toBe(5);
  });

  it('sem preço o item entra com valor zero e a regra sem_preco (a dispensação não para)', () => {
    const p = precoDoItemDeEstoque({ ...base, negociados: [neg({ id: 1, percentualAjuste: 5 })], referencias: [] });
    expect(p).toMatchObject({ regra: 'sem_preco', valorUnitario: 0, valorTotal: 0, quantidadeCobrada: 2 });
    expect(p.passos.length).toBeGreaterThan(1);
  });
});

describe('estorno do item de estoque na devolução', () => {
  const item = {
    situacaoConta: 'aberta',
    situacaoItem: 'lancado',
    quantidadeItem: 4,
    valorUnitario: 2.5,
    percentualCobranca: 100,
    quantidadeFixa: false,
    quantidadeSaida: 4,
    jaDevolvida: 0,
  };

  it('devolução parcial reduz o item na proporção', () => {
    expect(estornoDoItemDeEstoque({ ...item, devolvida: 1 })).toEqual({
      recusa: null,
      situacao: 'lancado',
      quantidade: 3,
      valorTotal: 7.5,
      total: false,
    });
    expect(estornoDoItemDeEstoque({ ...item, quantidadeItem: 2, jaDevolvida: 2, devolvida: 1 })).toMatchObject({
      quantidade: 1,
      valorTotal: 2.5,
    });
  });

  it('devolução de tudo estorna o item (sem apagar)', () => {
    expect(estornoDoItemDeEstoque({ ...item, jaDevolvida: 1, quantidadeItem: 3, devolvida: 3 })).toMatchObject({
      situacao: 'estornado',
      quantidade: 3,
      total: true,
    });
  });

  it('quantidade fixa só muda no estorno total', () => {
    expect(estornoDoItemDeEstoque({ ...item, quantidadeItem: 1, quantidadeFixa: true, devolvida: 2 })).toMatchObject({
      quantidade: 1,
      total: false,
    });
  });

  it('recusa com a conta fechada, o item glosado ou a devolução acima do que saiu', () => {
    const cod = (r: ReturnType<typeof estornoDoItemDeEstoque>) => (r.recusa ? r.recusa.codigo : null);
    expect(cod(estornoDoItemDeEstoque({ ...item, situacaoConta: 'fechada', devolvida: 1 }))).toBe('conta-fechada');
    expect(cod(estornoDoItemDeEstoque({ ...item, situacaoItem: 'glosado', devolvida: 1 }))).toBe('item-conta-bloqueado');
    expect(cod(estornoDoItemDeEstoque({ ...item, situacaoItem: 'estornado', devolvida: 1 }))).toBe('item-conta-bloqueado');
    expect(cod(estornoDoItemDeEstoque({ ...item, devolvida: 5 }))).toBe('devolucao-acima');
  });
});
