import { describe, expect, it } from 'vitest';
import { financeiroMemoriaDoContexto, PortaFinanceiroMemoria } from './porta-memoria.js';

describe('financeiroMemoriaDoContexto (M33: o título do RPA em memória chega ao contas a pagar)', () => {
  it('devolve a mesma porta para o mesmo contexto dos módulos e outra para outro contexto', () => {
    const a = {};
    const b = {};
    const pa = financeiroMemoriaDoContexto(a);
    expect(pa).toBeInstanceOf(PortaFinanceiroMemoria);
    expect(financeiroMemoriaDoContexto(a)).toBe(pa);
    expect(financeiroMemoriaDoContexto(b)).not.toBe(pa);
  });
});
