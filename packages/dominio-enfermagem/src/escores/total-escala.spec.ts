// Regra 3 do M45: no formulário novo e na tela o total é sempre calculado; no formulário em uso é proposto e confirmado
// (o confirmado diferente do proposto exige a justificativa).
import { describe, expect, it } from 'vitest';
import { conferirTotalConfirmado, propostaDeTotal, totalSempreCalculado } from './total-escala.js';

describe('total das escalas', () => {
  it('proposto pela soma dos itens; sem todos os itens, não há proposta', () => {
    expect(
      propostaDeTotal([
        { codigo: 'a', pontos: 2 },
        { codigo: 'b', pontos: 3 },
      ]),
    ).toEqual({ proposto: 5, faltam: [] });
    expect(
      propostaDeTotal([
        { codigo: 'a', pontos: 2 },
        { codigo: 'b', pontos: null },
      ]),
    ).toEqual({
      proposto: null,
      faltam: ['b'],
    });
    expect(propostaDeTotal([])).toEqual({ proposto: null, faltam: [] });
  });
  it('o confirmado igual ao proposto vale; diferente exige justificativa; sem confirmação, recusa', () => {
    const p = propostaDeTotal([
      { codigo: 'a', pontos: 2 },
      { codigo: 'b', pontos: 3 },
    ]);
    expect(conferirTotalConfirmado({ proposta: p, confirmado: 5 })).toEqual({
      ok: true,
      total: 5,
      divergente: false,
    });
    expect(conferirTotalConfirmado({ proposta: p, confirmado: 6 })).toMatchObject({
      ok: false,
      codigo: 'total-divergente-sem-justificativa',
    });
    expect(
      conferirTotalConfirmado({
        proposta: p,
        confirmado: 6,
        justificativa: 'Item reavaliado à beira do leito',
      }),
    ).toEqual({ ok: true, total: 6, divergente: true });
    expect(conferirTotalConfirmado({ proposta: p, confirmado: null })).toMatchObject({
      ok: false,
      codigo: 'total-sem-confirmacao',
    });
    const semTudo = propostaDeTotal([{ codigo: 'a', pontos: null }]);
    expect(conferirTotalConfirmado({ proposta: semTudo, confirmado: 4 })).toMatchObject({
      ok: false,
      mensagem: expect.stringMatching(/Faltam itens/),
    });
  });
  it('na tela e no formulário novo, o digitado é ignorado: o total é a soma', () => {
    expect(totalSempreCalculado({ a: 1, b: 2 })).toBe(3);
  });
});
