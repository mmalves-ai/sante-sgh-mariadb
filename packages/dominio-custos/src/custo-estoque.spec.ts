// Regra 9 (ficha do M54; DP-39): o custo do material é a saída pelo preço médio dos gatilhos do banco; sem custo por
// local enquanto a DP-39 não decidir; a linha atípica fica fora do custo direto.
import { describe, expect, it } from 'vitest';
import {
  POLITICA_CUSTO_ESTOQUE,
  reaisParaCentavos,
  saidaAtipica,
  valorSaidaCentavos,
} from './custo-estoque.js';

describe('custo do estoque', () => {
  it('valor da saída = quantidade × preço médio gravado na linha (o mesmo cálculo da contabilização)', () => {
    expect(valorSaidaCentavos(3, 12.5)).toBe(3_750);
    expect(valorSaidaCentavos('0.333', '10.01')).toBe(333);
    expect(valorSaidaCentavos(-2, 1.1)).toBe(-220);
    expect(valorSaidaCentavos(null, 10)).toBe(0);
    expect(valorSaidaCentavos('x', 10)).toBe(0);
    expect(valorSaidaCentavos(1, 'x')).toBe(0);
  });
  it('o preço médio não é recalculado e não há custo por local (contorno da DP-39)', () => {
    expect(POLITICA_CUSTO_ESTOQUE).toEqual({
      base: 'preco-medio-dos-gatilhos',
      porLocal: false,
      decisao: 'DP-39',
    });
  });
  it('linha atípica: acima do limite, em módulo', () => {
    expect(saidaAtipica(10_000_001, 10_000_000)).toBe(true);
    expect(saidaAtipica(-10_000_001, 10_000_000)).toBe(true);
    expect(saidaAtipica(10_000_000, 10_000_000)).toBe(false);
  });
  it('reais agregados no banco para centavos', () => {
    expect(reaisParaCentavos(5518531879.88025)).toBe(551_853_187_988);
    expect(reaisParaCentavos(undefined)).toBe(0);
  });
});
