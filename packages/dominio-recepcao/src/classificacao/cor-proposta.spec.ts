// M44, regra 3: cor proposta = a de maior prioridade entre os discriminadores presentes; sobrepor exige justificativa
// (dados SINTÉTICOS).
import { describe, expect, it } from 'vitest';
import { decidirCorFinal, proporCor, valoresDaClassificacao } from './cor-proposta.js';
import { PROTOCOLO_SINTETICO } from './protocolo-sintetico.js';

const P = PROTOCOLO_SINTETICO;

describe('cor proposta', () => {
  it('a mais grave entre as marcadas pela regra e as marcadas à mão', () => {
    const v = valoresDaClassificacao({ dor: 9, pas: 85 }, 54);
    const r = proporCor(P, 'dor-toracica', v, ['dor-precordial']);
    expect(r.cor).toBe('vermelho');
    expect(r.presentes.map((d) => d.codigo)).toEqual(['choque', 'dor-precordial', 'dor-intensa']);
    expect(r.automaticos).toEqual(['choque', 'dor-intensa']);
    expect(r.semDiscriminador).toBe(false);
  });

  it('só os discriminadores do fluxograma escolhido; o marcado de outro fluxograma é desconhecido', () => {
    const r = proporCor(P, 'dispneia', valoresDaClassificacao({ saturacao: 80, fr: 30 }, 40), [
      'dor-precordial',
    ]);
    expect(r.cor).toBe('laranja');
    expect(r.presentes.map((d) => d.codigo)).toEqual(['saturacao-baixa', 'taquipneia']);
    expect(r.desconhecidos).toEqual(['dor-precordial']);
  });

  it('sem discriminador presente, a menos grave (azul)', () => {
    const r = proporCor(P, 'geral', valoresDaClassificacao({ saturacao: 98, temperatura: 36.5 }, 30), []);
    expect(r).toMatchObject({ cor: 'azul', semDiscriminador: true, presentes: [] });
  });

  it('marcado à mão e pela regra conta uma vez', () => {
    const r = proporCor(P, 'geral', { dor: 6 }, ['dor-moderada', 'problema-recente']);
    expect(r.presentes.map((d) => d.codigo)).toEqual(['dor-moderada', 'problema-recente']);
    expect(r.cor).toBe('amarelo');
  });

  it('sobrepor a proposta exige justificativa; a direção vai ao evento de auditoria', () => {
    expect(decidirCorFinal('amarelo', 'amarelo', null)).toEqual({
      ok: true,
      sobreposta: false,
      direcao: 'igual',
    });
    expect(decidirCorFinal('amarelo', 'laranja', '  ')).toEqual({
      ok: false,
      motivo: 'justificativa-obrigatoria',
    });
    expect(decidirCorFinal('amarelo', 'laranja', 'Aspecto toxêmico')).toEqual({
      ok: true,
      sobreposta: true,
      direcao: 'mais-grave',
    });
    expect(decidirCorFinal('amarelo', 'verde', 'Reavaliado em repouso')).toMatchObject({
      direcao: 'menos-grave',
    });
  });
});
