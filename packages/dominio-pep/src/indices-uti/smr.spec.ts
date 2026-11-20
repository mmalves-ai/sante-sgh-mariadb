// Regra 5 do M45: SMR = óbitos observados ÷ esperados, com as parcelas impressas; internação aberta fora da conta; uma
// internação conta uma vez (o primeiro índice validado).
import { describe, expect, it } from 'vitest';
import { calcularSmr } from './smr.js';

describe('SMR', () => {
  it('2 óbitos ÷ 1,10 esperados = 1,82, com as parcelas; a aberta fica fora; o segundo índice da internação não conta', () => {
    const r = calcularSmr([
      { id: 1, reg: 10, mortalidade: 0.45, obito: true, coletadoEm: '2026-10-01T08:00' },
      { id: 2, reg: 11, mortalidade: 0.05, obito: false, coletadoEm: '2026-10-02T08:00' },
      { id: 3, reg: 12, mortalidade: 0.6, obito: true, coletadoEm: '2026-10-03T08:00' },
      { id: 4, reg: 10, mortalidade: 0.9, obito: true, coletadoEm: '2026-10-04T08:00' },
      { id: 5, reg: 13, mortalidade: 0.3, obito: null, coletadoEm: '2026-10-05T08:00' },
    ]);
    expect(r).toMatchObject({
      indices: 4,
      comDesfecho: 3,
      semDesfecho: 1,
      obitosObservados: 2,
      obitosEsperados: 1.1,
      smr: 1.82,
    });
    expect(r.parcelas.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(r.conta).toBe('SMR = 2 óbito(s) observado(s) ÷ 1,10 esperado(s) (0,45 + 0,05 + 0,60) = 1,82');
  });
  it('sem óbito esperado, a SMR não se calcula (e diz por quê)', () => {
    const r = calcularSmr([
      { id: 1, reg: null, mortalidade: 0.2, obito: null, coletadoEm: '2026-10-01T08:00' },
    ]);
    expect(r).toMatchObject({ smr: null, comDesfecho: 0, semDesfecho: 1 });
    expect(r.conta).toMatch(/não se calcula/);
    expect(calcularSmr([]).smr).toBeNull();
  });
});
