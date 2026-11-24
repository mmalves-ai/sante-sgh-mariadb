import { describe, expect, it } from 'vitest';
import { RAZOES_IMPRESSAO, regraJustificativaImpressao } from './impressao-justificada.js';

describe('justificativa da impressão do prontuário (01-ADM L82)', () => {
  it('1ª via sem justificativa é recusada', () => {
    expect(regraJustificativaImpressao({ viaAnterior: false })).toMatchObject({
      ok: false,
      codigo: 'justificativa-obrigatoria',
    });
    expect(regraJustificativaImpressao({ viaAnterior: false, justificativa: '   curta  ' })).toMatchObject({
      ok: false,
      codigo: 'justificativa-obrigatoria',
    });
  });
  it('1ª via com justificativa vira evento "impresso" com o texto aparado', () => {
    expect(
      regraJustificativaImpressao({ viaAnterior: false, justificativa: `  ${RAZOES_IMPRESSAO[0]} ` }),
    ).toEqual({ ok: true, tipo: 'impresso', justificativa: RAZOES_IMPRESSAO[0] });
  });
  it('o motivo sozinho não serve de justificativa da 1ª via', () => {
    expect(regraJustificativaImpressao({ viaAnterior: false, motivo: 'Via extraviada' })).toMatchObject({
      ok: false,
    });
  });
  it('nova via exige o motivo; aceita a justificativa no lugar', () => {
    expect(regraJustificativaImpressao({ viaAnterior: true })).toMatchObject({
      ok: false,
      codigo: 'motivo-obrigatorio',
    });
    expect(regraJustificativaImpressao({ viaAnterior: true, motivo: 'Perda' })).toEqual({
      ok: true,
      tipo: 'segunda-via',
      justificativa: 'Perda',
    });
    expect(regraJustificativaImpressao({ viaAnterior: true, justificativa: 'Via rasgada' })).toMatchObject({
      ok: true,
      tipo: 'segunda-via',
    });
  });
  it('texto acima do limite é recusado', () => {
    expect(regraJustificativaImpressao({ viaAnterior: false, justificativa: 'x'.repeat(256) })).toMatchObject(
      {
        ok: false,
        codigo: 'justificativa-longa',
      },
    );
  });
});
