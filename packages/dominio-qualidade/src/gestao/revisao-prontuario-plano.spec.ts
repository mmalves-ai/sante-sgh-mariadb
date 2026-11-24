import { describe, expect, it } from 'vitest';
import {
  codigoItemChecklist,
  motivoCancelamentoPorCorrecao,
  planoRevisaoProntuario,
} from './revisao-prontuario-plano.js';

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

  it('a correção reabre a cancelada e a resolvida do item que segue não conforme, mantém a aberta e cancela a do item que ficou conforme', () => {
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
        reabrir: [1, 4],
        cancelar: [2],
        abertasDepois: 3,
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

  it('a resolvida de item que ficou conforme não reabre nem é cancelada', () => {
    const p = planoRevisaoProntuario(
      [r('a', 'conforme')],
      [{ id: 7, item: 'a', situacao: 'resolvida' }],
      false,
    );
    expect(p).toMatchObject({ ok: true, plano: { reabrir: [], cancelar: [], abertasDepois: 0 } });
  });

  it('o percentual é ponderado pelo peso dos itens aplicáveis (item sem peso pesa 1)', () => {
    const itens = [
      { codigo: 'critico', peso: 3, aceitaNaoAplicavel: false },
      { codigo: 'simples', peso: 1, aceitaNaoAplicavel: true },
      { codigo: 'zero', peso: 0, aceitaNaoAplicavel: true },
    ];
    const p1 = planoRevisaoProntuario(
      [
        r('critico', 'conforme'),
        r('simples', 'naoConforme'),
        r('zero', 'naoConforme'),
        r('livre', 'conforme'),
      ],
      [],
      true,
      itens,
    );
    // (3 + 1) ÷ (3 + 1 + 0 + 1) = 80%.
    expect(p1.ok && p1.plano.percentual).toBe(80);
    const p2 = planoRevisaoProntuario(
      [r('critico', 'naoConforme'), r('simples', 'conforme')],
      [],
      true,
      itens,
    );
    expect(p2.ok && p2.plano.percentual).toBe(25);
    // Só item de peso zero aplicável: sem percentual.
    const p3 = planoRevisaoProntuario(
      [r('zero', 'conforme'), r('simples', 'naoAplicavel')],
      [],
      false,
      itens,
    );
    expect(p3.ok && p3.plano.percentual).toBeNull();
  });

  it('"não se aplica" no item que não o aceita é recusado', () => {
    const itens = [{ codigo: 'critico', peso: 3, aceitaNaoAplicavel: false }];
    expect(planoRevisaoProntuario([r('critico', 'naoAplicavel')], [], true, itens)).toEqual({
      ok: false,
      motivo: 'nao-aplicavel-nao-aceito',
    });
    expect(planoRevisaoProntuario([r('critico', 'conforme')], [], true, itens).ok).toBe(true);
  });

  it('o código efetivo do item sem código é item<sequência>, como a tela', () => {
    expect(codigoItemChecklist(null, 3)).toBe('item3');
    expect(codigoItemChecklist('', 2)).toBe('item2');
    expect(codigoItemChecklist('assinatura', 1)).toBe('assinatura');
  });

  it('o motivo do cancelamento pela correção leva a justificativa', () => {
    expect(motivoCancelamentoPorCorrecao(' Item revisto ')).toBe(
      'Revisão corrigida: o item deixou de ser não conforme. Item revisto',
    );
    expect(motivoCancelamentoPorCorrecao(null)).toBe('Revisão corrigida: o item deixou de ser não conforme.');
  });
});
