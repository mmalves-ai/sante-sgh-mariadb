import { describe, expect, it } from 'vitest';
import { mudancaValida, problemasVigentes } from './problemas.js';

describe('lista de problemas (versões, nunca apaga)', () => {
  it('vigentes são as folhas da cadeia; ativos primeiro', () => {
    const v = problemasVigentes([
      { id: 1, anterior: null, situacao: 'ativo' as const, em: '2026-10-01' },
      { id: 2, anterior: 1, situacao: 'resolvido' as const, em: '2026-10-05' },
      { id: 3, anterior: null, situacao: 'ativo' as const, em: '2026-10-03' },
      { id: 4, anterior: 2, situacao: 'ativo' as const, em: '2026-10-06' },
      { id: 5, anterior: null, situacao: 'descartado' as const, em: '2026-10-07' },
    ]);
    expect(v.map((x) => [x.id, x.versoes])).toEqual([
      [4, 3],
      [3, 1],
      [5, 1],
    ]);
  });
  it('mudança de situação', () => {
    expect(mudancaValida('ativo', 'resolvido')).toBe(true);
    expect(mudancaValida('resolvido', 'ativo')).toBe(true);
    expect(mudancaValida('descartado', 'ativo')).toBe(false);
    expect(mudancaValida('ativo', 'ativo')).toBe(false);
  });
});
