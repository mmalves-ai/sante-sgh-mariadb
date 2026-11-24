import { describe, expect, it } from 'vitest';
import { motivoCancelamentoPorCorrecao, planoRevisaoProntuario } from './revisao-prontuario-plano.js';

const r = (item: string, resultado: 'conforme' | 'naoConforme' | 'naoAplicavel') => ({
  item,
  resultado,
  observacao: null,
});

describe('plano da revisão do prontuário', () => {
  it('tudo conforme: resultado conforme, 100% e nenhuma pendência', () => {
    const p = planoRevisaoProntuario([r('a', 'conforme'), r('b', 'conforme')], [], false);
    expect(p).toEqual({
      ok: true,
      plano: {
        resultado: 'conforme',
        percentual: 100,
        criar: [],
        reabrir: [],
        cancelar: [],
        abertasDepois: 0,
      },
    });
  });

  it('o percentual conta só os itens aplicáveis, com quatro casas', () => {
    const p = planoRevisaoProntuario(
      [r('a', 'conforme'), r('b', 'naoConforme'), r('c', 'conforme'), r('d', 'naoAplicavel')],
      [],
      true,
    );
    expect(p.ok && p.plano).toMatchObject({ resultado: 'naoConforme', percentual: 66.6667, criar: ['b'] });
  });

  it('sem item aplicável, não há percentual', () => {
    const p = planoRevisaoProntuario([r('a', 'naoAplicavel')], [], false);
    expect(p.ok && p.plano.percentual).toBeNull();
  });

  it('a correção reabre a cancelada do mesmo item, mantém a aberta e cancela a do item que ficou conforme', () => {
    const p = planoRevisaoProntuario(
      [r('a', 'naoConforme'), r('b', 'conforme'), r('c', 'naoConforme'), r('d', 'naoConforme')],
      [
        { id: 1, item: 'a', situacao: 'cancelada' },
        { id: 2, item: 'b', situacao: 'aberta' },
        { id: 3, item: 'c', situacao: 'aberta' },
        { id: 4, item: 'd', situacao: 'resolvida' },
      ],
      true,
    );
    expect(p).toEqual({
      ok: true,
      plano: {
        resultado: 'naoConforme',
        percentual: 25,
        criar: [],
        reabrir: [1],
        cancelar: [2],
        abertasDepois: 2,
      },
    });
  });

  it('pendência nova ou reaberta sem o profissional responsável é recusada', () => {
    expect(planoRevisaoProntuario([r('a', 'naoConforme')], [], false)).toEqual({
      ok: false,
      motivo: 'pendencia-sem-responsavel',
    });
    expect(
      planoRevisaoProntuario([r('a', 'naoConforme')], [{ id: 1, item: 'a', situacao: 'cancelada' }], false),
    ).toEqual({ ok: false, motivo: 'pendencia-sem-responsavel' });
    // Só cancelar não exige o profissional.
    expect(
      planoRevisaoProntuario([r('a', 'conforme')], [{ id: 1, item: 'a', situacao: 'aberta' }], false).ok,
    ).toBe(true);
  });

  it('o motivo do cancelamento pela correção leva a justificativa', () => {
    expect(motivoCancelamentoPorCorrecao(' Item revisto ')).toBe(
      'Revisão corrigida: o item deixou de ser não conforme. Item revisto',
    );
    expect(motivoCancelamentoPorCorrecao(null)).toBe('Revisão corrigida: o item deixou de ser não conforme.');
  });
});
