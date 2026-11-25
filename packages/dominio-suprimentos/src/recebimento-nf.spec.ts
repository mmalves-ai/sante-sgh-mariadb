// C2-038 (05-SUP linha 21): impostos por item e custo de entrada da nota; conferência física do recebimento.
import { describe, expect, it } from 'vitest';
import {
  classificarRecebimento,
  completarComPedido,
  conferirImpostosItem,
  conferirItensRecebimento,
  conferirNotaComRecebimento,
  custoEntradaNota,
  type ItemCustoEntrada,
  parametroCustoDe,
  podeCancelarRecebimento,
  podeValidarRecebimento,
  ratear,
} from '@sgh/contratos/regras-suprimentos';

const despesas = { desconto: 0, frete: 0, seguro: 0, outros: 0 };
const item = (x: Partial<ItemCustoEntrada> = {}): ItemCustoEntrada => ({
  quantidade: 10,
  valorUnitario: 10,
  quantidadeEstoque: 10,
  impostos: [],
  ...x,
});

describe('custo de entrada da nota (impostos por item)', () => {
  it('hospital: IPI e ICMS-ST entram no custo; ICMS próprio, PIS e COFINS já estão no preço', () => {
    const r = custoEntradaNota(
      [
        item({
          impostos: [
            { tributo: 'ICMS', base: 100, aliquota: 18, valor: 18 },
            { tributo: 'IPI', base: 100, aliquota: 5, valor: 5 },
            { tributo: 'ICMS_ST', base: 120, aliquota: 18, valor: 3.6 },
            { tributo: 'PIS', base: 100, aliquota: 1.65, valor: 1.65 },
          ],
        }),
      ],
      { desconto: 2, frete: 4, seguro: 1, outros: 0.5 },
    );
    // 100 − 2 + 4 + 1 + 0,5 + 5 + 3,6 = 112,10
    expect(r.itens[0]).toMatchObject({
      custoTotal: 112.1,
      custoUnitario: 11.21,
      impostosNoCusto: 8.6,
      creditos: 0,
    });
    expect(r.itens[0]!.impostos.every((i) => i.compoeCusto && !i.recuperavel)).toBe(true);
    expect(r.totais).toEqual({ baseIcms: 100, icms: 18, baseIcmsSt: 120, icmsSt: 3.6, ipi: 5, porFora: 8.6 });
    expect(r.valorTotal).toBe(112.1);
  });

  it('parâmetro: ICMS e IPI recuperáveis viram crédito e saem do custo', () => {
    const p = parametroCustoDe({ icms: 1, ipi: 1, pisCofins: 0 });
    expect(p.recuperaveis).toEqual(['ICMS', 'IPI']);
    const r = custoEntradaNota(
      [
        item({
          impostos: [
            { tributo: 'ICMS', base: 100, aliquota: 18, valor: 18 },
            { tributo: 'IPI', base: 100, aliquota: 5, valor: 5 },
          ],
        }),
      ],
      despesas,
      p,
    );
    // 100 − 18 (crédito do ICMS por dentro); IPI recuperável não soma.
    expect(r.itens[0]).toMatchObject({ custoTotal: 82, creditos: 18, impostosNoCusto: 0 });
    expect(r.itens[0]!.impostos.map((i) => [i.tributo, i.compoeCusto, i.recuperavel])).toEqual([
      ['ICMS', false, true],
      ['IPI', false, true],
    ]);
    // O total da nota continua com o IPI (por fora).
    expect(r.valorTotal).toBe(105);
  });

  it('rateio pelo valor dos itens fecha os centavos no último', () => {
    expect(ratear(10, [1, 1, 1])).toEqual([3.33, 3.33, 3.34]);
    expect(ratear(5, [0, 0])).toEqual([0, 0]);
    const r = custoEntradaNota(
      [item({ valorUnitario: 1 }), item({ valorUnitario: 2, quantidadeEstoque: 20 })],
      { ...despesas, frete: 3 },
    );
    expect(r.itens.map((i) => i.frete)).toEqual([1, 2]);
    expect(r.itens[1]!.custoUnitario).toBe(1.1);
    expect(r.custoTotal).toBe(33);
  });

  it('confere os impostos: tributo conhecido, único, valor = base × alíquota', () => {
    expect(conferirImpostosItem([{ tributo: 'IPI', base: 100, aliquota: 5, valor: 5.01 }], 1)).toBeNull();
    // ICMS-ST = base × alíquota − ICMS próprio: não é conferido pela conta simples.
    expect(conferirImpostosItem([{ tributo: 'ICMS_ST', base: 120, aliquota: 18, valor: 3.6 }], 1)).toBeNull();
    expect(conferirImpostosItem([{ tributo: 'IPI', base: 100, aliquota: 5, valor: 7 }], 1)?.codigo).toBe(
      'imposto-nao-confere',
    );
    expect(
      conferirImpostosItem(
        [
          { tributo: 'IPI', base: 1, aliquota: 0, valor: 0 },
          { tributo: 'IPI', base: 1, aliquota: 0, valor: 0 },
        ],
        2,
      )?.codigo,
    ).toBe('imposto-repetido');
    expect(conferirImpostosItem([{ tributo: 'IPI', base: -1, aliquota: 0, valor: 0 }], 1)?.codigo).toBe(
      'imposto-invalido',
    );
    expect(
      conferirImpostosItem([{ tributo: 'XX' as 'IPI', base: 1, aliquota: 0, valor: 0 }], 1)?.codigo,
    ).toBe('imposto-desconhecido');
  });
});

describe('conferência física do recebimento', () => {
  const hoje = '2026-11-25';
  it('classifica: apontamento, validade curta, falta, sobra e nenhuma', () => {
    const r = classificarRecebimento(
      [
        { item: 1, esperada: 10, conferida: 10, controlaLote: false },
        { item: 2, esperada: 10, conferida: 8, controlaLote: false },
        { item: 3, esperada: 10, conferida: 12, controlaLote: false },
        { item: 4, esperada: 5, conferida: 5, controlaLote: true, lote: 'L', validade: '2027-01-10' },
        {
          item: 5,
          esperada: 5,
          conferida: 5,
          controlaLote: false,
          apontamento: 'avaria',
          observacao: 'caixa',
        },
        { item: 6, esperada: null, conferida: 3, controlaLote: false },
      ],
      hoje,
    );
    expect(r.itens.map((i) => i.divergencia)).toEqual([
      'nenhuma',
      'falta',
      'sobra',
      'validade',
      'avaria',
      'nenhuma',
    ]);
    expect(r.itens[1]!.diferenca).toBe(-2);
    expect(r.situacao).toBe('divergente');
    expect(
      classificarRecebimento([{ item: 1, esperada: 2, conferida: 2, controlaLote: false }], hoje).situacao,
    ).toBe('conferida');
  });

  it('confere a entrada: item repetido, lote obrigatório, apontamento sem descrição', () => {
    expect(conferirItensRecebimento([])?.codigo).toBe('sem-itens');
    const base = { item: 1, esperada: 1, conferida: 1, controlaLote: false };
    expect(conferirItensRecebimento([base, base])?.codigo).toBe('item-repetido');
    expect(conferirItensRecebimento([{ ...base, controlaLote: true }])?.codigo).toBe('lote-obrigatorio');
    expect(conferirItensRecebimento([{ ...base, apontamento: 'temperatura' }])?.codigo).toBe(
      'apontamento-sem-observacao',
    );
    expect(conferirItensRecebimento([base])).toBeNull();
  });

  it('validação por outra pessoa; divergente só com justificativa', () => {
    expect(podeValidarRecebimento({ situacao: 'conferida', conferente: 7 }, 7, null)?.codigo).toBe(
      'mesmo-conferente',
    );
    expect(podeValidarRecebimento({ situacao: 'divergente', conferente: 7 }, 8, 'curta')?.codigo).toBe(
      'divergencia-sem-justificativa',
    );
    expect(
      podeValidarRecebimento({ situacao: 'divergente', conferente: 7 }, 8, 'Falta reposta pelo fornecedor'),
    ).toBeNull();
    expect(podeValidarRecebimento({ situacao: 'validada', conferente: 7 }, 8, null)?.codigo).toBe(
      'situacao-nao-permite',
    );
  });

  it('cancelamento com motivo e nunca da conferência já usada pela nota', () => {
    expect(
      podeCancelarRecebimento({ situacao: 'validada', notaLigada: true }, 'motivo bastante')?.codigo,
    ).toBe('conferencia-usada');
    expect(podeCancelarRecebimento({ situacao: 'conferida', notaLigada: false }, 'x')?.codigo).toBe(
      'motivo-obrigatorio',
    );
    expect(
      podeCancelarRecebimento({ situacao: 'cancelada', notaLigada: false }, 'motivo bastante')?.codigo,
    ).toBe('ja-cancelada');
    expect(
      podeCancelarRecebimento({ situacao: 'aberta', notaLigada: false }, 'Entrega devolvida inteira'),
    ).toBeNull();
  });

  it('com pedido: o esperado é o saldo do pedido, o item fora do pedido é produto errado e o que não veio é falta', () => {
    const saldos = new Map([
      [1, 10],
      [2, 5],
      [3, 4],
      [4, 0],
    ]);
    const itens = completarComPedido(
      [
        { item: 1, esperada: 999, conferida: 10, controlaLote: false },
        // Fora do pedido: a tela manda esperada igual à conferida, e o servidor não aceita.
        { item: 9, esperada: 3, conferida: 3, controlaLote: false },
        { item: 2, esperada: null, conferida: 5, controlaLote: false },
        // Item do pedido já recebido por inteiro (saldo 0): também fora.
        { item: 4, esperada: null, conferida: 1, controlaLote: false },
      ],
      saldos,
    );
    expect(itens.map((i) => [i.item, i.esperada, i.conferida])).toEqual([
      [1, 10, 10],
      [9, 0, 3],
      [2, 5, 5],
      [4, 0, 1],
      // O item 3 do pedido não veio: falta inteira.
      [3, 4, 0],
    ]);
    const c = classificarRecebimento(itens, hoje);
    expect(c.itens.map((i) => i.divergencia)).toEqual([
      'nenhuma',
      'produto_errado',
      'nenhuma',
      'produto_errado',
      'falta',
    ]);
    expect(c.itens[4]!.diferenca).toBe(-4);
    expect(c.situacao).toBe('divergente');
    // Pedido de 3 itens que chega com 2, conferidos certos: divergente pela falta, e a validação pede justificativa.
    const parcial = classificarRecebimento(
      completarComPedido(
        [
          { item: 1, esperada: 10, conferida: 10, controlaLote: false },
          { item: 2, esperada: 5, conferida: 5, controlaLote: false },
        ],
        saldos,
      ),
      hoje,
    );
    expect(parcial.situacao).toBe('divergente');
    expect(podeValidarRecebimento({ situacao: parcial.situacao, conferente: 1 }, 2, null)?.codigo).toBe(
      'divergencia-sem-justificativa',
    );
    // Sem pedido, a lista fica como veio (conferência às cegas ou contra a nota).
    const sem = [{ item: 1, esperada: null, conferida: 2, controlaLote: false }];
    expect(completarComPedido(sem, null)).toEqual(sem);
  });

  it('a nota não dá entrada acima da quantidade conferida nem com lote ou validade diferente do conferido', () => {
    const ci = {
      item: 5,
      conferida: 8,
      lote: 'L1',
      validade: '2030-06-30',
      divergencia: 'falta' as const,
    };
    const c = { situacao: 'validada' as const, fornecedor: 1, local: 2, notaLigada: false, itens: [ci] };
    const ni = (q: number, lote = 'l1', validade = '2030-06-30') => ({
      item: 5,
      quantidadeEstoque: q,
      lotes: [{ lote, validade }],
    });
    const n = (...itens: ReturnType<typeof ni>[]) => ({ fornecedor: 1, local: 2, itens });
    expect(conferirNotaComRecebimento(c, n(ni(8)))).toBeNull();
    expect(conferirNotaComRecebimento(c, n(ni(6)))).toBeNull();
    expect(conferirNotaComRecebimento(c, n(ni(10)))?.codigo).toBe('quantidade-acima-da-conferida');
    // Duas linhas do mesmo item somam.
    expect(conferirNotaComRecebimento(c, n(ni(5, 'L1'), ni(4, 'L1')))?.codigo).toBe(
      'quantidade-acima-da-conferida',
    );
    // Conferida 0 (tudo avariado e recusado): nenhuma entrada.
    expect(
      conferirNotaComRecebimento(
        { ...c, itens: [{ ...ci, conferida: 0, divergencia: 'avaria' as const }] },
        n(ni(1)),
      )?.codigo,
    ).toBe('quantidade-acima-da-conferida');
    expect(conferirNotaComRecebimento(c, n(ni(8, 'L2')))?.codigo).toBe('lote-divergente-da-conferencia');
    expect(conferirNotaComRecebimento(c, n(ni(8, 'L1', '2031-01-01')))?.codigo).toBe(
      'lote-divergente-da-conferencia',
    );
    // A divergência de lote aceita na validação libera o lote da nota.
    expect(
      conferirNotaComRecebimento({ ...c, itens: [{ ...ci, divergencia: 'lote' as const }] }, n(ni(8, 'L2'))),
    ).toBeNull();
  });

  it('a nota usa a conferência validada, da mesma entrega, uma vez, com todos os itens', () => {
    const item = (i: number) => ({
      item: i,
      conferida: 10,
      lote: null,
      validade: null,
      divergencia: 'nenhuma' as const,
    });
    const c = {
      situacao: 'validada' as const,
      fornecedor: 1,
      local: 2,
      notaLigada: false,
      itens: [item(5), item(6)],
    };
    const ni = (i: number) => ({ item: i, quantidadeEstoque: 1, lotes: [] });
    const n = { fornecedor: 1, local: 2, itens: [ni(5)] };
    expect(conferirNotaComRecebimento(c, n)).toBeNull();
    expect(conferirNotaComRecebimento({ ...c, situacao: 'conferida' }, n)?.codigo).toBe(
      'conferencia-nao-validada',
    );
    expect(conferirNotaComRecebimento({ ...c, notaLigada: true }, n)?.codigo).toBe('conferencia-usada');
    expect(conferirNotaComRecebimento(c, { ...n, local: 3 })?.codigo).toBe('conferencia-de-outra-entrega');
    expect(conferirNotaComRecebimento(c, { ...n, itens: [ni(5), ni(9)] })?.codigo).toBe('item-nao-conferido');
  });
});
