// Regra 2 do M45: Morse 25 a 44 é risco moderado de queda e 45 ou mais é alto; o risco pede os cuidados preventivos.
import { describe, expect, it } from 'vitest';
import { calcularEscala } from './escalas.js';

const ZERO = {
  historiaQueda: 0,
  diagnosticoSecundario: 0,
  auxilioDeambulacao: 0,
  terapiaEndovenosa: 0,
  marcha: 0,
  estadoMental: 0,
};

describe('Morse', () => {
  it('0 a 24 baixo; 25 a 44 moderado; 45 ou mais alto', () => {
    expect(calcularEscala('morse', ZERO)).toMatchObject({ ok: true, total: 0, gatilho: 'nenhum' });
    const r20 = calcularEscala('morse', { ...ZERO, marcha: 20 });
    expect(r20.ok && r20.faixa.codigo).toBe('baixo');
    const r25 = calcularEscala('morse', { ...ZERO, historiaQueda: 25 });
    expect(r25).toMatchObject({ ok: true, total: 25, gatilho: 'prevencao' });
    expect(r25.ok && r25.faixa.codigo).toBe('moderado');
    const r44 = calcularEscala('morse', { ...ZERO, historiaQueda: 25, diagnosticoSecundario: 15 });
    expect(r44.ok && r44.faixa.codigo).toBe('moderado');
    const r45 = calcularEscala('morse', { ...ZERO, historiaQueda: 25, terapiaEndovenosa: 20 });
    expect(r45.ok && [r45.total, r45.faixa.codigo]).toEqual([45, 'alto']);
    const max = calcularEscala('morse', {
      historiaQueda: 25,
      diagnosticoSecundario: 15,
      auxilioDeambulacao: 30,
      terapiaEndovenosa: 20,
      marcha: 20,
      estadoMental: 15,
    });
    expect(max.ok && max.total).toBe(125);
    expect(max.ok && max.conduta).toMatch(/queda/);
  });
  it('ponto que não é opção do item é recusado (o 10 não existe no histórico de quedas)', () => {
    expect(calcularEscala('morse', { ...ZERO, historiaQueda: 10 })).toMatchObject({
      ok: false,
      codigo: 'valor-nunca-visto',
    });
  });
});
