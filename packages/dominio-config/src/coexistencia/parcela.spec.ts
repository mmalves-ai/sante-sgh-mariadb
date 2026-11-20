// Regra 2 do M37: a divisão e o texto com as parcelas impressas.
import { describe, expect, it } from 'vitest';
import { calcularParcela, somarParcelas, textoParcela } from './parcela.js';

describe('parcela no novo e no outro sistema (regra 2)', () => {
  it('novo 61 de 100 = 61%', () => {
    const p = calcularParcela(100, 61);
    expect(p).toEqual({ novo: 61, legado: 39, total: 100, percentual: 61 });
    expect(textoParcela(p)).toBe('novo 61 de 100 = 61%');
  });
  it('sem linha no dia; trilha maior que a tabela (o total é o do novo)', () => {
    expect(textoParcela(calcularParcela(0, 0))).toBe('sem operações no dia');
    expect(calcularParcela(3, 5)).toEqual({ novo: 5, legado: 0, total: 5, percentual: 100 });
    expect(calcularParcela(-1, -2).total).toBe(0);
  });
  it('soma das parcelas do setor', () => {
    expect(somarParcelas([calcularParcela(10, 5), calcularParcela(30, 10)])).toEqual({
      novo: 15,
      legado: 25,
      total: 40,
      percentual: 38,
    });
    expect(somarParcelas([]).percentual).toBeNull();
  });
});
