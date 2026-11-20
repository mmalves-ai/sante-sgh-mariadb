// Regra 12 do M24: dose por kg, por m², pelo clearance (com o dado e a data) e velocidade de infusão.
import { describe, expect, it } from 'vitest';
import {
  calcularDose,
  clearanceEstimado,
  faixaRenal,
  gotasPorMinuto,
  superficieCorporal,
  velocidadeInfusao,
} from './calculo-dose.js';

describe('cálculo de dose', () => {
  it('por kg, por m² e fixa', () => {
    expect(calcularDose('por-kg', 15, { pesoKg: 70 })).toEqual({
      dose: 1050,
      regra: 'por-kg',
      base: 70,
      falta: null,
    });
    expect(superficieCorporal(70, 170)).toBe(1.818);
    expect(calcularDose('por-m2', 100, { pesoKg: 70, alturaCm: 170 }).dose).toBe(181.8);
    expect(calcularDose('fixa', 500, {}).dose).toBe(500);
  });
  it('falta de dado diz o que falta', () => {
    expect(calcularDose('por-kg', 1, {}).falta).toBe('peso');
    expect(calcularDose('por-m2', 1, {}).falta).toBe('peso');
    expect(calcularDose('por-m2', 1, { pesoKg: 70 }).falta).toBe('altura');
    expect(calcularDose('por-clearance', 1, {}).falta).toBe('peso');
    expect(calcularDose('por-clearance', 1, { pesoKg: 70 }).falta).toBe('creatinina');
    expect(calcularDose('por-clearance', 1, { pesoKg: 70, creatinina: 1 }).falta).toBe('idade');
  });
  it('Cockcroft-Gault com o fator feminino e a dose proporcional ao clearance (teto na dose de referência)', () => {
    expect(clearanceEstimado({ pesoKg: 72, idadeAnos: 40, creatinina: 1, sexo: 'M' })).toBe(100);
    expect(clearanceEstimado({ pesoKg: 72, idadeAnos: 40, creatinina: 1, sexo: 'F' })).toBe(85);
    expect(clearanceEstimado({ pesoKg: 72, idadeAnos: null, creatinina: 1 })).toBeNull();
    expect(
      calcularDose('por-clearance', 1000, { pesoKg: 72, idadeAnos: 40, creatinina: 2, sexo: 'M' }).dose,
    ).toBe(500);
    expect(
      calcularDose('por-clearance', 1000, { pesoKg: 72, idadeAnos: 20, creatinina: 0.5, sexo: 'M' }).dose,
    ).toBe(1000);
  });
  it('faixas renais nos limites', () => {
    expect([90, 89.9, 60, 59.9, 30, 29.9, 15, 14.9].map(faixaRenal)).toEqual([
      'normal',
      'leve',
      'leve',
      'moderada',
      'moderada',
      'grave',
      'grave',
      'falencia',
    ]);
  });
  it('velocidade de infusão e gotas', () => {
    expect(velocidadeInfusao(500, 240)).toBe(125);
    expect(gotasPorMinuto(500, 240)).toBe(42);
    expect(gotasPorMinuto(500, 240, true)).toBe(125);
    expect(() => velocidadeInfusao(0, 10)).toThrow();
    expect(() => gotasPorMinuto(10, 0)).toThrow();
  });
});
