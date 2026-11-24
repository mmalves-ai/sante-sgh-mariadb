// Regra da aplicação da classificação externa (F3.9-6, 08-INTG L140): a recebida vigente vira classificação interna.
import { describe, expect, it } from 'vitest';
import { planoAplicacao, type RecebidaParaAplicar } from './classificacao-externa.js';

const base: RecebidaParaAplicar = {
  situacao: 'recebida',
  cor: 'amarelo',
  tempoAlvoMinutos: 60,
  classificadoEm: new Date('2026-11-24T10:00:00Z'),
  queixaPrincipal: 'Dor torácica',
  descricaoPrioridade: 'Urgente',
  codigoPrioridade: 'U',
};

describe('planoAplicacao', () => {
  it('a recebida vigente gera o plano com o prazo contado da hora da classificação externa', () => {
    const r = planoAplicacao(base);
    expect(r.erros).toEqual([]);
    expect(r.plano).toEqual({
      cor: 'amarelo',
      tempoAlvoMinutos: 60,
      prazo: new Date('2026-11-24T11:00:00Z'),
      queixa: 'Dor torácica',
    });
  });

  it('sem queixa, a interna leva a prioridade recebida como queixa (nunca vazia)', () => {
    expect(planoAplicacao({ ...base, queixaPrincipal: '  ' }).plano?.queixa).toBe(
      'Classificação externa: Urgente',
    );
    expect(planoAplicacao({ ...base, queixaPrincipal: null, descricaoPrioridade: null }).plano?.queixa).toBe(
      'Classificação externa: U',
    );
  });

  it.each(['aplicada', 'rejeitada', 'substituida'] as const)('recusa a recebida %s', (situacao) => {
    const r = planoAplicacao({ ...base, situacao });
    expect(r.plano).toBeNull();
    expect(r.erros.map((e) => e.codigo)).toEqual(['nao-vigente']);
  });

  it('recusa sem cor e sem tempo-alvo válido, com os dois motivos', () => {
    const r = planoAplicacao({ ...base, cor: null, tempoAlvoMinutos: null });
    expect(r.plano).toBeNull();
    expect(r.erros.map((e) => e.codigo)).toEqual(['sem-cor', 'sem-tempo-alvo']);
    expect(planoAplicacao({ ...base, tempoAlvoMinutos: 1441 }).erros.map((e) => e.codigo)).toEqual([
      'sem-tempo-alvo',
    ]);
  });
});
