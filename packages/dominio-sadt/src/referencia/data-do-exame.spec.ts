import { describe, expect, it } from 'vitest';
import { dataDaReferencia } from './data-do-exame.js';

describe('data da referência do resultado (F3.5, linhas 3 e 10)', () => {
  it('a coleta antes da solicitação; sem as duas, hoje', () => {
    expect(
      dataDaReferencia({ coletadaEm: '2026-03-02T08:10:00', solicitadoEm: '2026-03-01', hoje: '2026-11-24' }),
    ).toBe('2026-03-02');
    expect(
      dataDaReferencia({ coletadaEm: null, solicitadoEm: '2026-03-01 07:00:00', hoje: '2026-11-24' }),
    ).toBe('2026-03-01');
    expect(dataDaReferencia({ hoje: '2026-11-24' })).toBe('2026-11-24');
  });

  it('data no futuro (relógio adiantado) não passa de hoje; texto inválido é ignorado', () => {
    expect(dataDaReferencia({ coletadaEm: '2027-01-01', hoje: '2026-11-24' })).toBe('2026-11-24');
    expect(dataDaReferencia({ coletadaEm: 'ontem', solicitadoEm: '2026-10-10', hoje: '2026-11-24' })).toBe(
      '2026-10-10',
    );
  });
});
