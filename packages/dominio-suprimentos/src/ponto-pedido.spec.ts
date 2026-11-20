// Regra 15 (ficha do M28): consumo médio, estoque de segurança, ponto de pedido, curvas ABC e XYZ, sugestão.
import { describe, expect, it } from 'vitest';
import {
  calcularPontos,
  chavePonto,
  pontoDefinidoDoItem,
  curvaAbc,
  curvaXyz,
  desvioPadrao,
  itensASugerir,
  media,
  PARAMETROS_PADRAO,
  valorDaSugestao,
} from '@sgh/contratos/regras-suprimentos';

describe('ponto de pedido (regra 15)', () => {
  it('média e desvio', () => {
    expect(media([])).toBe(0);
    expect(media([10, 20])).toBe(15);
    expect(desvioPadrao([5])).toBe(0);
    expect(desvioPadrao([10, 20, 30])).toBe(10);
  });
  it('curva ABC pelo acumulado do valor e XYZ pela variação', () => {
    const c = curvaAbc(
      [
        { item: 1, valor: 800 },
        { item: 2, valor: 150 },
        { item: 3, valor: 50 },
      ],
      PARAMETROS_PADRAO,
    );
    expect([...c.entries()]).toEqual([
      [1, 'A'],
      [2, 'B'],
      [3, 'C'],
    ]);
    expect(curvaXyz(0.2, PARAMETROS_PADRAO)).toBe('X');
    expect(curvaXyz(0.7, PARAMETROS_PADRAO)).toBe('Y');
    expect(curvaXyz(3, PARAMETROS_PADRAO)).toBe('Z');
    expect([...curvaAbc([{ item: 1, valor: 0 }], PARAMETROS_PADRAO).values()]).toEqual(['C']);
  });
  it('ponto de pedido e sugestão', () => {
    const [a, b] = calcularPontos([
      { item: 1, consumos: [30, 30, 30, 30, 30, 30], valor: 1000, saldo: 10, prazoDias: 15, emPedido: 0 },
      { item: 2, consumos: [0, 0, 0, 0, 0, 0], valor: 0, saldo: 0, prazoDias: 10, emPedido: 0 },
    ]);
    expect(a).toMatchObject({
      mediaMensal: 30,
      desvio: 0,
      estoqueSeguranca: 0,
      pontoPedido: 15,
      sugestao: 35,
      curvaXyz: 'X',
    });
    expect(b).toMatchObject({ sugestao: 0, coeficienteVariacao: 0 });
    const [c] = calcularPontos([
      { item: 3, consumos: [0, 0, 6], valor: 6, saldo: 100, prazoDias: 30, emPedido: 0 },
    ]);
    expect(c?.sugestao).toBe(0);
    expect(itensASugerir([a!, b!]).map((x) => x.item)).toEqual([1]);
  });
  it('o estoque de segurança definido entra no ponto e na sugestão; a chave e o ponto sem local', () => {
    const [a] = calcularPontos([
      {
        item: 1,
        consumos: [30, 30, 30, 30, 30, 30],
        valor: 1000,
        saldo: 10,
        prazoDias: 15,
        emPedido: 0,
        estoqueSegurancaDefinido: 20,
      },
    ]);
    expect(a).toMatchObject({ estoqueSeguranca: 20, pontoPedido: 35, sugestao: 55 });
    const definidos = new Map([
      [chavePonto(1, 10), { prazoDias: 20, estoqueSeguranca: 5 }],
      [chavePonto(1, 11), { prazoDias: 40, estoqueSeguranca: 3 }],
      [chavePonto(12, 10), { prazoDias: 7, estoqueSeguranca: null }],
    ]);
    expect(chavePonto(1, 10)).toBe('1:10');
    expect(pontoDefinidoDoItem(definidos, 1, 10)).toEqual({ prazoDias: 20, estoqueSeguranca: 5 });
    expect(pontoDefinidoDoItem(definidos, 1)).toEqual({ prazoDias: 40, estoqueSeguranca: 8 });
    expect(pontoDefinidoDoItem(definidos, 12)).toEqual({ prazoDias: 7, estoqueSeguranca: null });
    expect(pontoDefinidoDoItem(definidos, 2)).toBeNull();
  });
  it('valor da sugestão com as parcelas', () => {
    expect(
      valorDaSugestao([
        { quantidade: 2, custo: 1.5 },
        { quantidade: 1, custo: 2 },
      ]),
    ).toEqual({ total: 5, parcelas: [3, 2] });
  });
});
