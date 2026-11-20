// M55, etapa 4 (Lei 14.133/2021, art. 23): o valor estimado pela mediana, média ou menor preço, com as parcelas
// impressas; o item com menos preços que o mínimo; a dispensa pelo valor até o limite.
import { describe, expect, it } from 'vitest';
import {
  estimarItem,
  estimarLicitacao,
  incisoDispensaValor,
  podeAvancar,
  podeDescartarPreco,
} from '../index.js';
import { estado, item, processo } from './fixtures.spec-util.js';

describe('pesquisa de preços', () => {
  const i = { id: 7, numero: 2, quantidade: 3 };
  it('mediana ímpar e par, média e menor, com a conta impressa', () => {
    expect(estimarItem(i, [12, 10, 11], 'mediana', 3)).toMatchObject({
      valorUnitario: 11,
      valorTotal: 33,
      quantidadePrecos: 3,
      abaixoDoMinimo: false,
    });
    expect(estimarItem(i, [10, 12, 11, 13], 'mediana', 3).valorUnitario).toBe(11.5);
    expect(estimarItem(i, [10, 11, 13], 'media', 3).valorUnitario).toBe(11.3333);
    const m = estimarItem(i, [10, 9.5, 13], 'menor', 3);
    expect(m.valorUnitario).toBe(9.5);
    expect(m.conta).toBe('item 2: menor de [9,50; 10,00; 13,00] = 9,50 × 3,00 = 28,50');
  });
  it('sem preço: nulo e a conta diz; abaixo do mínimo marcado', () => {
    const s = estimarItem(i, [], 'mediana', 3);
    expect(s).toMatchObject({ valorUnitario: null, valorTotal: null, abaixoDoMinimo: true });
    expect(s.conta).toMatch(/sem preço/);
    expect(estimarItem(i, [5, 6], 'mediana', 3).abaixoDoMinimo).toBe(true);
  });
  it('a estimativa do processo soma os itens com as parcelas', () => {
    const e = estimarLicitacao(
      [
        { id: 1, numero: 1, quantidade: 10 },
        { id: 2, numero: 2, quantidade: 2 },
      ],
      [
        { item: 1, valor: 1 },
        { item: 1, valor: 2 },
        { item: 1, valor: 3 },
        { item: 2, valor: 100 },
      ],
      'mediana',
      3,
    );
    expect(e.valorTotal).toBe(220);
    expect(e.conta).toBe('20,00 + 200,00 = 220,00');
    expect(e.itensAbaixoDoMinimo).toBe(1);
    expect(estimarLicitacao([{ id: 1, numero: 1, quantidade: 1 }], [], 'media', 3)).toMatchObject({
      valorTotal: null,
      conta: 'Há item sem preço pesquisado.',
    });
  });
  it('seguir da pesquisa: sem preço recusa; abaixo do mínimo pede a justificativa', () => {
    const base = { processo: processo({ etapa: 'pesquisa' }), itens: [item(1, { valorEstimado: null })] };
    expect(podeAvancar(estado(base), { para: 'edital', justificativaPesquisa: null })?.codigo).toBe(
      'licitacao-sem-preco',
    );
    const poucos = estado({ ...base, precos: [{ item: 1, valor: 5 }] });
    expect(podeAvancar(poucos, { para: 'edital', justificativaPesquisa: 'curta' })).toMatchObject({
      codigo: 'licitacao-pesquisa-insuficiente',
      campos: ['justificativaPesquisa'],
    });
    expect(
      podeAvancar(poucos, {
        para: 'edital',
        justificativaPesquisa: 'Só um fabricante registrado na Anvisa para este item',
      }),
    ).toBeNull();
  });
  it('dispensa pelo valor: o inciso lido do fundamento e o limite do estabelecimento', () => {
    expect(incisoDispensaValor('art. 75, II')).toBe('II');
    expect(incisoDispensaValor('Art. 75, inciso I, da Lei 14.133')).toBe('I');
    expect(incisoDispensaValor('art. 75, IV, alínea c')).toBeNull();
    expect(incisoDispensaValor(null)).toBeNull();
    const dispensa = (fundamento: string, valor: number) =>
      estado({
        processo: processo({ etapa: 'pesquisa', modalidade: 'dispensa', fundamento }),
        itens: [item(1, { quantidade: 1 })],
        precos: [1, 2, 3].map(() => ({ item: 1, valor })),
      });
    expect(
      podeAvancar(dispensa('art. 75, II', 70_000), { para: 'sessao', justificativaPesquisa: null }),
    ).toMatchObject({
      codigo: 'licitacao-dispensa-acima-limite',
    });
    expect(
      podeAvancar(dispensa('art. 75, I', 70_000), { para: 'sessao', justificativaPesquisa: null }),
    ).toBeNull();
    expect(
      podeAvancar(dispensa('art. 75, IV', 900_000), { para: 'sessao', justificativaPesquisa: null }),
    ).toBeNull();
    const regulamento = estado({
      ...dispensa('art. 75, II', 70_000),
      processo: processo({
        etapa: 'pesquisa',
        modalidade: 'dispensa',
        fundamento: 'art. 75, II',
        regime: 'regulamento',
      }),
    });
    expect(podeAvancar(regulamento, { para: 'sessao', justificativaPesquisa: null })).toBeNull();
  });

  it('o preço descartado (com justificativa) sai da estimativa e do mínimo; só na pesquisa e uma vez', () => {
    const descarte = {
      justificativa: 'Valor digitado errado: 10.000 no lugar de 100.',
      usuario: 'A',
      em: 'x',
    };
    const precos = [
      { item: 1, valor: 100 },
      { item: 1, valor: 110 },
      { item: 1, valor: 10_000, descarte },
    ];
    const est = estimarLicitacao([{ id: 1, numero: 1, quantidade: 2 }], precos, 'media', 3);
    expect(est.itens[0]).toMatchObject({ valorUnitario: 105, quantidadePrecos: 2, abaixoDoMinimo: true });
    expect(est.conta).toBe('210,00 = 210,00');
    expect(est.itensAbaixoDoMinimo).toBe(1);
    const lido = (id: number, d: typeof descarte | null = null) => ({ id, descarte: d });
    const naPesquisa = {
      processo: processo({ etapa: 'pesquisa' }),
      precosDetalhe: [lido(1), lido(2, descarte)],
    };
    expect(podeDescartarPreco(naPesquisa, 1)).toBeNull();
    expect(podeDescartarPreco(naPesquisa, 2)?.codigo).toBe('licitacao-preco-descartado');
    expect(podeDescartarPreco(naPesquisa, 9)?.codigo).toBe('licitacao-preco-inexistente');
    expect(podeDescartarPreco({ ...naPesquisa, processo: processo({ etapa: 'edital' }) }, 1)?.codigo).toBe(
      'licitacao-etapa-invalida',
    );
  });
});
