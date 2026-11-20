// M44, regra 5: indicadores da classificação com numerador e denominador; só as marcas do novo (dados SINTÉTICOS).
import { describe, expect, it } from 'vitest';
import { indicadoresClassificacao, razao } from './indicadores-pa.js';

const a = (
  chegada: string | null,
  classificadoEm: string | null,
  cor: 'vermelho' | 'amarelo' | null,
  medico: string | null,
  reclass = 0,
) => ({
  chegada,
  classificadoEm,
  corInicial: cor,
  tempoAlvoMin: cor === 'amarelo' ? 60 : 0,
  atendimentoMedicoEm: medico,
  reclassificacoes: reclass,
});

describe('indicadores da classificação', () => {
  it('porta → classificação e porta → médico com amostra e total; sem chegada conta à parte', () => {
    const r = indicadoresClassificacao(
      [
        a('2026-10-23T10:00:00', '2026-10-23T10:08:00', 'amarelo', '2026-10-23T10:50:00'),
        a('2026-10-23T10:10:00', '2026-10-23T10:14:00', 'amarelo', '2026-10-23T11:30:00', 1),
        a('2026-10-23T10:20:00', '2026-10-23T10:30:00', 'vermelho', '2026-10-23T10:30:00'),
        a('2026-10-23T10:30:00', null, null, null),
        a(null, '2026-10-23T10:40:00', 'amarelo', null),
      ],
      '2026-10-23T12:00:00',
    );
    expect(r.atendimentos).toBe(5);
    expect(r.semMarcas).toBe(1);
    expect(r.portaClassificacao).toEqual({ medianaMin: 8, amostra: 3, total: 4 });
    expect(r.portaMedico).toEqual({ medianaMin: 50, amostra: 3, total: 4 });
    expect(r.dentroDoTempoAlvo.find((x) => x.cor === 'amarelo')).toEqual({
      cor: 'amarelo',
      numerador: 1,
      denominador: 3,
      percentual: 33.3,
    });
    expect(r.dentroDoTempoAlvo.find((x) => x.cor === 'vermelho')).toMatchObject({
      numerador: 1,
      denominador: 1,
    });
    expect(r.dentroDoTempoAlvo.find((x) => x.cor === 'azul')).toMatchObject({
      denominador: 0,
      percentual: null,
    });
    expect(r.reclassificados).toEqual({ numerador: 1, denominador: 4, percentual: 25 });
  });

  it('quem espera dentro do prazo ainda não entra no denominador', () => {
    const r = indicadoresClassificacao(
      [a('2026-10-23T10:00:00', '2026-10-23T10:05:00', 'amarelo', null)],
      '2026-10-23T10:30:00',
    );
    expect(r.dentroDoTempoAlvo.find((x) => x.cor === 'amarelo')).toMatchObject({
      numerador: 0,
      denominador: 0,
    });
    expect(r.portaMedico.medianaMin).toBeNull();
    expect(razao(2, 4).percentual).toBe(50);
  });
});
