import { describe, expect, it } from 'vitest';
import {
  COMPONENTES_ZERO,
  centavos,
  explicarValor,
  modeloDaTabela,
  modeloDoItem,
  NOMES_COMPONENTES,
  totalComponentes,
} from './modelo-valor.js';

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
  it('metade exata dos itens já define o modelo da tabela', () => {
    expect(modeloDaTabela({ itens: 10, comCh: 5, comPorte: 5 })).toBe('CH');
    expect(modeloDaTabela({ itens: 10, comCh: 4, comPorte: 5 })).toBe('PORTE');
    expect(modeloDaTabela({ itens: 10, comCh: 4, comPorte: 4 })).toBe('VALOR');
    expect(modeloDaTabela({ itens: -1, comCh: 0, comPorte: 0 })).toBe('VALOR');
    expect(modeloDoItem({ ch: -2 })).toBe('CH');
  });
  it('CH sem filme dispensa o índice do filme; sem custo operacional conta só o CH', () => {
    const r = explicarValor({ ch: 100 }, null, { ch: 0.42 });
    expect(r).toMatchObject({ modelo: 'CH', falta: [] });
    expect(r.total).toBeCloseTo(42, 10);
    expect(r.passos[1]).toBe('0,42 × (100,00 + 0,00) + 0,00 × 0,00 = 42,00');
    // Filme informado sem o índice do filme: falta só ele.
    expect(explicarValor({ ch: 100, filmeM2: 0.2 }, null, { ch: 0.42 })).toMatchObject({
      total: null,
      falta: ['valor do filme do convênio na data'],
    });
    // Falta só o CH quando não há filme.
    expect(explicarValor({ ch: 100, cope: 5 }, null, { filme: 20 }).falta).toEqual([
      'valor do CH do convênio na data',
    ]);
    // Com filme e índice: 0,5 × (10 + 0) + 20 × 0,25 = 10.
    expect(explicarValor({ ch: 10, filmeM2: 0.25 }, null, { ch: 0.5, filme: 20 }).total).toBeCloseTo(10, 10);
  });
  it('PORTE: fração ausente ou negativa é o porte inteiro; UCO e filme só são pedidos quando o item usa', () => {
    expect(explicarValor({ ch: 0, porte: '3A' }, null, { porte: 150 })).toMatchObject({
      modelo: 'PORTE',
      total: 150,
      falta: [],
    });
    expect(explicarValor({ ch: 0, porte: '3A', fracaoPorte: null }, null, { porte: 150 }).total).toBe(150);
    expect(explicarValor({ ch: 0, porte: '3A', fracaoPorte: -0.5 }, null, { porte: 150 }).total).toBe(150);
    // 150 × 0,1 + 10 × 2 + 30 × 0,5 = 50.
    const completo = explicarValor({ ch: 0, porte: '3A', fracaoPorte: 0.1, cope: 2, filmeM2: 0.5 }, null, {
      porte: 150,
      uco: 10,
      filme: 30,
    });
    expect(completo.total).toBeCloseTo(50, 10);
    expect(completo.passos[1]).toBe('150,00 × 0,10 + 10,00 × 2,00 + 30,00 × 0,50 = 50,00');
    expect(explicarValor({ ch: 0, porte: '3A', filmeM2: 1 }, null, { porte: 150 }).falta).toEqual([
      'valor do filme do convênio na data',
    ]);
    expect(explicarValor({ ch: 0, porte: '3A', cope: 1 }, null, { porte: 150, filme: 3 }).falta).toEqual([
      'valor da UCO do convênio na data',
    ]);
    expect(explicarValor({ ch: 0, porte: '3A' }, null).falta).toEqual([
      'valor do porte 3A do convênio na data',
    ]);
  });
  it('VALOR mostra a soma dos cinco componentes', () => {
    const r = explicarValor({ ch: 0, porte: null }, { ch: 80, co: 10, filme: 5, anes: 3, outros: 2 });
    expect(r).toMatchObject({ modelo: 'VALOR', total: 100, falta: [] });
    expect(r.passos[1]).toBe('80,00 + 10,00 + 5,00 + 3,00 + 2,00 = 100,00');
    expect(totalComponentes(COMPONENTES_ZERO)).toBe(0);
    expect(NOMES_COMPONENTES).toEqual(['ch', 'co', 'filme', 'anes', 'outros']);
    expect(centavos(10.005)).toBe(10.01);
  });
});
