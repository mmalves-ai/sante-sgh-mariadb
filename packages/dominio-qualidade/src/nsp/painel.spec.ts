// Painel do plano de segurança do paciente (M48, etapa 2): período, percentual com as parcelas, contagens do
// vocabulário e os indicadores de adesão às metas internacionais.
import { describe, expect, it } from 'vitest';
import {
  contagensDoVocabulario,
  indicador,
  indicadoresDeAdesao,
  percentual,
  periodoDoPainel,
} from './painel.js';

describe('painel do PSP', () => {
  it('período: padrão de 30 dias, fim no futuro e mais de 12 meses recusados', () => {
    expect(periodoDoPainel({}, '2026-10-26')).toEqual({
      ok: true,
      de: '2026-09-27',
      ate: '2026-10-26',
      fimExclusivo: '2026-10-27',
    });
    expect(periodoDoPainel({ de: '2026-01-01', ate: '2026-01-31' }, '2026-10-26')).toMatchObject({
      de: '2026-01-01',
      fimExclusivo: '2026-02-01',
    });
    expect(periodoDoPainel({ ate: '2026-10-27' }, '2026-10-26')).toEqual({ ok: false, motivo: 'fim-futuro' });
    expect(periodoDoPainel({ de: '2025-01-01', ate: '2026-01-02' }, '2026-10-26')).toEqual({
      ok: false,
      motivo: 'periodo-longo',
    });
    expect(periodoDoPainel({ de: '2025-10-27', ate: '2026-10-26' }, '2026-10-26').ok).toBe(true);
  });

  it('percentual com uma casa; sem denominador é null', () => {
    expect(percentual(1, 3)).toBe(33.3);
    expect(percentual(0, 0)).toBeNull();
    expect(indicador('x', 'X', 2, 4, 'fonte', 90)).toEqual({
      codigo: 'x',
      titulo: 'X',
      numerador: 2,
      denominador: 4,
      percentual: 50,
      meta: 90,
      fonte: 'fonte',
    });
  });

  it('contagens: o vocabulário inteiro, com zero onde não há linha', () => {
    expect(
      contagensDoVocabulario(
        [
          { codigo: 'a', rotulo: 'A' },
          { codigo: 'b', rotulo: 'B' },
        ],
        [
          { codigo: 'b', quantidade: 2 },
          { codigo: 'b', quantidade: 1 },
          { codigo: 'z', quantidade: 9 },
        ],
      ),
    ).toEqual([
      { codigo: 'a', rotulo: 'A', quantidade: 0 },
      { codigo: 'b', rotulo: 'B', quantidade: 3 },
    ]);
  });

  it('adesão às metas com as parcelas', () => {
    const r = indicadoresDeAdesao({
      checagens: 10,
      checagensComPulseira: 9,
      checklists: 4,
      checklistsConcluidos: 3,
      checklistsComPausa: 4,
      reavaliacoes: [{ escala: 'morse', devidas: 5, cumpridasNoPrazo: 4 }],
    });
    expect(r.map((i) => [i.codigo, i.numerador, i.denominador, i.percentual])).toEqual([
      ['meta1-pulseira', 9, 10, 90],
      ['meta4-checklist', 3, 4, 75],
      ['meta4-pausa', 4, 4, 100],
      ['meta6-morse', 4, 5, 80],
      ['lpp-braden', 0, 0, null],
    ]);
  });
});
