// D-PPP-525: os períodos de atribuição pelo histórico funcional e o mapa de riscos que valeu em cada um.
import { describe, expect, it } from 'vitest';
import { chaveFuncao } from './epi.js';
import { linhasNoPeriodo, periodosDeAtribuicao } from './ppp.js';

const v = {
  admissao: '2024-03-01',
  desligamento: null,
  cargo: 'Técnico de enfermagem',
  funcao: 'Instrumentador',
};

describe('PPP: períodos de atribuição', () => {
  it('sem mudança, um período desde a admissão com a função atual (ou o cargo sem função)', () => {
    expect(periodosDeAtribuicao(v, [])).toEqual([
      { inicio: '2024-03-01', fim: null, funcao: 'Instrumentador' },
    ]);
    expect(periodosDeAtribuicao({ ...v, funcao: null }, [])[0]?.funcao).toBe('Técnico de enfermagem');
  });
  it('cada mudança de função fecha o período na véspera; a que não muda a função efetiva não abre período', () => {
    const h = [
      { tipo: 'funcao', vigencia: '2025-06-01', antes: null, depois: 'Instrumentador' },
      { tipo: 'jornada', vigencia: '2025-07-01', antes: '36', depois: '40' },
      {
        tipo: 'cargo',
        vigencia: '2025-08-01',
        antes: 'Técnico de enfermagem',
        depois: 'Técnico de enfermagem',
      },
    ];
    expect(periodosDeAtribuicao({ ...v, desligamento: '2026-09-30' }, h)).toEqual([
      { inicio: '2024-03-01', fim: '2025-05-31', funcao: 'Técnico de enfermagem' },
      { inicio: '2025-06-01', fim: '2026-09-30', funcao: 'Instrumentador' },
    ]);
  });
});

describe('PPP: o mapa de riscos que valeu no período', () => {
  const l = (
    id: number,
    funcao: string,
    inicio: string,
    fim: string | null,
    unidade: number | null = null,
  ) => ({
    id,
    unidade,
    funcaoChave: chaveFuncao(funcao),
    tipo: 'risco' as const,
    epi: null,
    inicio,
    fim,
  });
  const mapa = [
    l(1, 'Técnico de enfermagem', '2020-01-01', '2024-12-31'),
    l(2, 'Técnico de enfermagem', '2025-05-01', null),
    l(3, 'Instrumentador', '2025-01-01', null),
    l(4, 'Técnico de enfermagem', '2024-01-01', null, 9),
    l(5, 'Técnico de enfermagem', '2019-01-01', '2023-12-31'),
  ];
  it('recorta a vigência ao período; outra unidade e linha encerrada antes do período ficam fora', () => {
    const p = { inicio: '2024-03-01', fim: '2025-05-31', funcao: 'Técnico de Enfermagem' };
    expect(linhasNoPeriodo(mapa, p, 1, '2026-10-26').map((x) => [x.id, x.vigenteDe, x.vigenteAte])).toEqual([
      [1, '2024-03-01', '2024-12-31'],
      [2, '2025-05-01', '2025-05-31'],
    ]);
    const atual = { inicio: '2025-06-01', fim: null, funcao: 'Instrumentador' };
    expect(
      linhasNoPeriodo(mapa, atual, 1, '2026-10-26').map((x) => [x.id, x.vigenteDe, x.vigenteAte]),
    ).toEqual([[3, '2025-06-01', null]]);
  });
});
