// M44, seção 7: o quadro do PA com a cor e o cronômetro; o painel de TV sem nome (dados SINTÉTICOS).
import { describe, expect, it } from 'vitest';
import { cartaoDoPainel, contagemPorCor, ordenarPorRisco, riscoDoAtendimento } from './quadro-cor.js';

const linhas = [
  {
    id: 1,
    cor: 'verde' as const,
    classificadoEm: '2026-10-23T10:00:00',
    tempoAlvoMin: 120,
    motivo: 'inicial' as const,
  },
  {
    id: 2,
    cor: 'amarelo' as const,
    classificadoEm: '2026-10-23T10:40:00',
    tempoAlvoMin: 60,
    motivo: 'mudanca_quadro' as const,
  },
];

describe('quadro com cor', () => {
  it('o risco do cartão: a vigente, o nome escrito, o prazo e as reclassificações', () => {
    expect(riscoDoAtendimento(linhas, '2026-10-23T11:00:00', null)).toEqual({
      cor: 'amarelo',
      nomeCor: 'Urgente',
      prioridade: 3,
      classificadoEm: '2026-10-23T10:40:00',
      prazoEm: '2026-10-23T11:40:00.000Z',
      minutosRestantes: 40,
      estourado: false,
      reclassificar: false,
      reclassificacoes: 1,
    });
    expect(riscoDoAtendimento(linhas, '2026-10-23T11:45:00', null)).toMatchObject({
      estourado: true,
      reclassificar: true,
      minutosRestantes: -5,
    });
    expect(riscoDoAtendimento(linhas, '2026-10-23T11:45:00', '2026-10-23T11:50:00')).toMatchObject({
      estourado: true,
      reclassificar: false,
    });
    expect(riscoDoAtendimento([], '2026-10-23T11:00:00', null)).toBeNull();
  });

  it('a ordem: classificados pela cor e pelo prazo; os sem classificação depois, pela prioridade legal e chegada', () => {
    const r = (prioridade: number, prazoEm: string) => ({ prioridade, prazoEm });
    const itens = [
      { reg: 1, prioridade: '2' as const, chegada: '2026-10-23T09:00:00', risco: null },
      {
        reg: 2,
        prioridade: '2' as const,
        chegada: '2026-10-23T09:30:00',
        risco: r(4, '2026-10-23T12:00:00'),
      },
      { reg: 3, prioridade: '0' as const, chegada: '2026-10-23T09:40:00', risco: null },
      {
        reg: 4,
        prioridade: '2' as const,
        chegada: '2026-10-23T09:50:00',
        risco: r(2, '2026-10-23T10:10:00'),
      },
      {
        reg: 5,
        prioridade: '2' as const,
        chegada: '2026-10-23T09:55:00',
        risco: r(4, '2026-10-23T11:00:00'),
      },
    ];
    expect(ordenarPorRisco(itens).map((i) => i.reg)).toEqual([4, 5, 2, 3, 1]);
  });

  it('contagem por cor com os estourados e os sem classificação', () => {
    const c = contagemPorCor([{ cor: 'verde', estourado: true }, { cor: 'verde', estourado: false }, null]);
    expect(c.find((x) => x.cor === 'verde')).toEqual({ cor: 'verde', total: 2, estourados: 1 });
    expect(c.find((x) => x.cor === 'semClassificacao')).toEqual({
      cor: 'semClassificacao',
      total: 1,
      estourados: 0,
    });
    expect(c).toHaveLength(6);
  });

  it('o painel de TV mostra só senha ou iniciais, a cor com o nome e a espera', () => {
    expect(
      cartaoDoPainel({
        senha: 'PA012',
        iniciais: 'M. A. S.',
        risco: { cor: 'laranja', nomeCor: 'Muito urgente' },
        minutosTotal: 12,
      }),
    ).toEqual({ rotulo: 'PA012', cor: 'laranja', nomeCor: 'Muito urgente', minutos: 12 });
    expect(cartaoDoPainel({ senha: ' ', iniciais: 'J. S.', risco: null, minutosTotal: 3 })).toEqual({
      rotulo: 'J. S.',
      cor: null,
      nomeCor: null,
      minutos: 3,
    });
  });
});
