import { describe, expect, it } from 'vitest';
import { centavos, explicarValor, modeloDaTabela, modeloDoItem, totalComponentes } from './modelo-valor.js';

describe('três modelos de honorário (regra 3)', () => {
  it('modelo da tabela pela maioria dos itens', () => {
    expect(modeloDaTabela({ itens: 3835, comCh: 3788, comPorte: 0 })).toBe('CH');
    expect(modeloDaTabela({ itens: 4535, comCh: 0, comPorte: 4520 })).toBe('PORTE');
    expect(modeloDaTabela({ itens: 4728, comCh: 0, comPorte: 0 })).toBe('VALOR');
    expect(modeloDaTabela({ itens: 0, comCh: 0, comPorte: 0 })).toBe('VALOR');
  });
  it('modelo do item: CH ≠ 0 é AMB; porte é CBHPM; senão VALOR', () => {
    expect(modeloDoItem({ ch: 12.5 })).toBe('CH');
    expect(modeloDoItem({ ch: 0, porte: '3A' })).toBe('PORTE');
    expect(modeloDoItem({ ch: 0, porte: '  ' })).toBe('VALOR');
    expect(modeloDoItem({ ch: 0, porte: null })).toBe('VALOR');
  });
  it('total = soma dos 5 componentes, sem arredondar', () => {
    expect(totalComponentes({ ch: 89.2008, co: 1, filme: 0.5, anes: 0, outros: 0.25 })).toBeCloseTo(
      90.9508,
      10,
    );
    expect(centavos(89.2008)).toBe(89.2);
  });
  it('explica VALOR, CH e PORTE e diz o que falta', () => {
    const valor = explicarValor({ ch: 0 }, { ch: 100, co: 10, filme: 0, anes: 0, outros: 0 });
    expect(valor.total).toBe(110);
    expect(explicarValor({ ch: 0 }, null).falta).toEqual(['vigência na data']);
    const amb = explicarValor({ ch: 10, cope: 2, filmeM2: 0.5 }, null, { ch: 0.5, filme: 20 });
    expect(amb.total).toBeCloseTo(16, 10);
    expect(explicarValor({ ch: 10, filmeM2: 1 }, null, {}).falta).toHaveLength(2);
    const porte = explicarValor({ ch: 0, porte: '2B', fracaoPorte: 0.5, cope: 1 }, null, {
      porte: 200,
      uco: 10,
    });
    expect(porte.total).toBe(110);
    const porteInteiro = explicarValor({ ch: 0, porte: '2B', fracaoPorte: 0 }, null, { porte: 200 });
    expect(porteInteiro.total).toBe(200);
    expect(explicarValor({ ch: 0, porte: '2B', cope: 1, filmeM2: 1 }, null, {}).falta).toHaveLength(3);
  });
});
