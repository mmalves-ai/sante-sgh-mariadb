import { describe, expect, it } from 'vitest';
import { esquemaFiltroIndicadoresPessoas } from './indicadores-pessoas.js';

describe('filtro do painel de indicadores de pessoas (W0-06, M4)', () => {
  it('aceita o período com unidade e setor opcionais', () => {
    expect(esquemaFiltroIndicadoresPessoas.parse({ inicio: '2026-01-01', fim: '2026-03-31' })).toEqual({
      inicio: '2026-01-01',
      fim: '2026-03-31',
      hospital: null,
      setor: null,
    });
    expect(
      esquemaFiltroIndicadoresPessoas.parse({
        inicio: '2026-01-01',
        fim: '2026-01-31',
        hospital: 'aa',
        setor: 10,
      }).setor,
    ).toBe(10);
  });

  it('recusa o fim antes do início e o período maior que um ano', () => {
    expect(
      esquemaFiltroIndicadoresPessoas.safeParse({ inicio: '2026-03-01', fim: '2026-01-31' }).success,
    ).toBe(false);
    expect(
      esquemaFiltroIndicadoresPessoas.safeParse({ inicio: '2025-01-01', fim: '2026-03-31' }).success,
    ).toBe(false);
    expect(esquemaFiltroIndicadoresPessoas.safeParse({ inicio: '2026-1-1', fim: '2026-03-31' }).success).toBe(
      false,
    );
  });
});
