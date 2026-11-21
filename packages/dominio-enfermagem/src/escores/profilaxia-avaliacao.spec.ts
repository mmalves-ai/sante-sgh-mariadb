// A avaliação de risco de TEV criada a partir do escore: perfil, risco e profilaxia indicada pela faixa; faixa
// desconhecida e escala que não é de TEV são recusadas (nunca se presume risco).
import { describe, expect, it } from 'vitest';
import { avaliacaoTevDoEscore } from './profilaxia.js';

describe('avaliação de TEV a partir do escore', () => {
  it('Caprini é do paciente cirúrgico, com a profilaxia por faixa', () => {
    expect(avaliacaoTevDoEscore('caprini', 'muitoBaixo')).toEqual({
      ok: true,
      avaliacao: { perfil: 'cirurgico', risco: 'muito_baixo', indicada: 'deambulacao', mecanico: null },
    });
    expect(avaliacaoTevDoEscore('caprini', 'baixo')).toMatchObject({
      avaliacao: { risco: 'baixo', indicada: 'mecanica', mecanico: 'compressao_pneumatica' },
    });
    expect(avaliacaoTevDoEscore('caprini', 'moderado')).toMatchObject({
      avaliacao: { risco: 'moderado', indicada: 'farmacologica', mecanico: null },
    });
    expect(avaliacaoTevDoEscore('caprini', 'alto')).toMatchObject({
      avaliacao: { risco: 'alto', indicada: 'farmacologica_mecanica', mecanico: 'compressao_pneumatica' },
    });
  });

  it('Padua é do paciente clínico: alto leva à farmacológica, baixo à deambulação', () => {
    expect(avaliacaoTevDoEscore('padua', 'alto')).toEqual({
      ok: true,
      avaliacao: { perfil: 'clinico', risco: 'alto', indicada: 'farmacologica', mecanico: null },
    });
    expect(avaliacaoTevDoEscore('padua', 'baixo')).toMatchObject({
      avaliacao: { perfil: 'clinico', risco: 'baixo', indicada: 'deambulacao' },
    });
  });

  it('recusa a faixa desconhecida e a escala que não é de TEV (sem presumir risco alto)', () => {
    expect(avaliacaoTevDoEscore('caprini', '')).toMatchObject({ ok: false, codigo: 'faixa-desconhecida' });
    expect(avaliacaoTevDoEscore('caprini', 'altissimo')).toMatchObject({
      ok: false,
      codigo: 'faixa-desconhecida',
    });
    expect(avaliacaoTevDoEscore('padua', 'moderado')).toMatchObject({
      ok: false,
      codigo: 'faixa-desconhecida',
    });
    expect(avaliacaoTevDoEscore('caprini', 'toString')).toMatchObject({
      ok: false,
      codigo: 'faixa-desconhecida',
    });
    expect(avaliacaoTevDoEscore('braden', 'alto')).toMatchObject({ ok: false, codigo: 'escala-nao-tev' });
  });
});
