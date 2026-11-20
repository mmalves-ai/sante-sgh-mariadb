// Regra 4 do M32: quem lança não aprova, quem aprova não paga, quem paga não concilia (sem caixa no login).
import { describe, expect, it } from 'vitest';
import { conferirSegregacao } from './index.js';

const h = { lancou: 'ANA', aprovaram: ['BRUNO'], pagou: 'CARLA' };

describe('segregação (regra 4)', () => {
  it('quem lançou não aprova (sem diferença de caixa)', () => {
    expect(conferirSegregacao('aprovar', 'ana', h)?.codigo).toBe('segregacao-lancou-aprova');
    expect(conferirSegregacao('aprovar', 'BRUNO', h)).toBeNull();
  });
  it('quem lançou ou aprovou não paga', () => {
    expect(conferirSegregacao('pagar', 'ANA', h)?.codigo).toBe('segregacao-lancou-paga');
    expect(conferirSegregacao('pagar', ' bruno ', h)?.codigo).toBe('segregacao-aprovou-paga');
    expect(conferirSegregacao('pagar', 'CARLA', h)).toBeNull();
  });
  it('quem pagou não concilia', () => {
    expect(conferirSegregacao('conciliar', 'CARLA', h)?.codigo).toBe('segregacao-pagou-concilia');
    expect(conferirSegregacao('conciliar', 'DIEGO', h)).toBeNull();
    expect(conferirSegregacao('conciliar', 'DIEGO', { lancou: null, aprovaram: [], pagou: null })).toBeNull();
  });
});
