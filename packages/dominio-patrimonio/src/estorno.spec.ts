import { describe, expect, it } from 'vitest';
import { impedimentoDoEstorno, type SituacaoParaEstorno } from './estorno.js';

const base: SituacaoParaEstorno = {
  daCompetencia: { id: 7, competencia: '2026-09' },
  ultimo: { id: 7, competencia: '2026-09' },
  lotesExportados: [],
  bensBaixados: [],
};

describe('W0-08: estorno do cálculo da depreciação', () => {
  it('o último cálculo vigente, sem lote exportado nem bem baixado, se estorna', () => {
    expect(impedimentoDoEstorno('2026-09', base)).toBeNull();
  });

  it('sem cálculo vigente na competência: recusa', () => {
    expect(impedimentoDoEstorno('2026-09', { ...base, daCompetencia: null })?.codigo).toBe('sem-calculo');
  });

  it('só o último se estorna (as competências seguem em sequência)', () => {
    const r = impedimentoDoEstorno('2026-09', { ...base, ultimo: { id: 8, competencia: '2026-10' } });
    expect(r?.codigo).toBe('nao-e-o-ultimo');
    expect(r?.detalhe).toContain('2026-10');
  });

  it('lote contábil da competência exportado: indica cancelar a exportação primeiro', () => {
    const r = impedimentoDoEstorno('2026-09', {
      ...base,
      lotesExportados: [{ periodo: '2026-09', exportadoEm: '2026-10-02T10:00:00' }],
    });
    expect(r?.codigo).toBe('lote-exportado');
    expect(r?.detalhe).toMatch(/cancele a exportação primeiro/);
  });

  it('bem do cálculo já baixado: recusa com quantos e quais', () => {
    const bens = Array.from({ length: 12 }, (_, i) => `P${i + 1}`);
    const r = impedimentoDoEstorno('2026-09', { ...base, bensBaixados: bens });
    expect(r?.codigo).toBe('bem-baixado');
    expect(r?.detalhe).toMatch(/^12 bem/);
    expect(r?.detalhe).toContain('P10 e mais 2');
  });
});
