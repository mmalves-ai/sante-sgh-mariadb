// Motor por item e por período (regras 1, 4, 5 e 6), com as parcelas escritas no teste.
import { describe, expect, it } from 'vitest';
import { calcularItem, calcularPeriodo, type OpcoesCalculo } from './calculo.js';
import { item, regra } from './fixtures.spec-util.js';

const o: OpcoesCalculo = { basePadrao: 'cobrado', modoAdicional: 'sobre-valor', feriados: new Set() };

describe('calcularItem', () => {
  it('percentual: 200,00 × 18,5% = 37,00, com a memória completa', () => {
    const m = calcularItem(item(), [regra({ id: 9, percentual: 18.5, profissional: 77 })], o);
    expect(m).toMatchObject({
      item: 1,
      beneficiario: 77,
      regra: 9,
      base: 'cobrado',
      origemBase: 'cobrado',
      baseCentavos: 20000,
      percentual: 18.5,
      valorFixoCentavos: 0,
      valorSemAdicionalCentavos: 3700,
      adicional: null,
      valorCentavos: 3700,
      pendencia: null,
    });
    expect(m.dimensoes).toEqual(['profissional', 'convenio']);
  });

  it('arredonda metade para longe do zero: 33,33 × 50% = 16,665 → 16,67', () => {
    const m = calcularItem(item({ cobrado: 33.33 }), [regra({ id: 1 })], o);
    expect(m.valorCentavos).toBe(1667);
  });

  it('valor fixo de 80,00 com adicional de fim de semana de 10% = 88,00', () => {
    const m = calcularItem(
      item({ data: '2026-10-10' }),
      [regra({ id: 2, percentual: 0, valorFixo: 80, percentualFimDeSemana: 10 })],
      o,
    );
    expect(m).toMatchObject({
      valorFixoCentavos: 8000,
      valorSemAdicionalCentavos: 8000,
      valorCentavos: 8800,
    });
    expect(m.adicional).toEqual({ tipo: 'fim-de-semana', percentual: 10 });
  });

  it('pendências: sem executante, sem regra, não conciliado', () => {
    expect(calcularItem(item({ executante: null }), [regra({ id: 1 })], o).pendencia).toBe('sem-executante');
    const sem = calcularItem(item(), [regra({ id: 1, convenio: 999 })], o);
    expect(sem.pendencia).toBe('sem-regra');
    expect(sem.ignoradas).toHaveLength(1);
    const nc = calcularItem(item({ conciliado: false }), [regra({ id: 3, base: 'recebido' })], o);
    expect(nc).toMatchObject({ pendencia: 'nao-conciliado', regra: 3, valorCentavos: 0 });
  });
});

describe('calcularPeriodo', () => {
  it('item já integrado não entra de novo', () => {
    const ms = calcularPeriodo([item({ id: 1 }), item({ id: 2 })], [regra({ id: 1 })], new Set([2]), o);
    expect(ms.map((m) => m.pendencia)).toEqual([null, 'ja-integrado']);
  });
});
