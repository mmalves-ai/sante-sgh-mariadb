import { describe, expect, it } from 'vitest';
import { compararLinhaDeBase, slisForaDaMeta } from './linha-de-base.js';

describe('compararLinhaDeBase', () => {
  const antes = { operacoesChaveP95Ms: { abrirFicha: 400, login: 200 }, folgaOit: 120 };
  it('segue quando nenhuma operação piora acima do limite', () => {
    const r = compararLinhaDeBase(
      antes,
      { operacoesChaveP95Ms: { abrirFicha: 420, login: 190 }, folgaOit: 150 },
      10,
    );
    expect(r.decisao).toBe('segue');
    expect(r.operacoes).toEqual([
      { operacao: 'abrirFicha', antesMs: 400, depoisMs: 420, variacaoPct: 5, acimaDoLimite: false },
      { operacao: 'login', antesMs: 200, depoisMs: 190, variacaoPct: -5, acimaDoLimite: false },
    ]);
    expect(r.folgaOitDepois).toBe(150);
  });
  it('recolhe com piora acima do limite, mesmo com operação sem par', () => {
    const r = compararLinhaDeBase(antes, { operacoesChaveP95Ms: { abrirFicha: 500 }, folgaOit: 100 }, 10);
    expect(r.decisao).toBe('recolher');
    expect(r.semPar).toEqual(['login']);
  });
  it('incompleta sem par ou sem medida; limite inválido é recusado', () => {
    expect(
      compararLinhaDeBase(antes, { operacoesChaveP95Ms: { abrirFicha: 400 }, folgaOit: 1 }, 10).decisao,
    ).toBe('incompleta');
    const vazio = { operacoesChaveP95Ms: {}, folgaOit: 0 };
    expect(compararLinhaDeBase(vazio, vazio, 10).decisao).toBe('incompleta');
    expect(
      compararLinhaDeBase(
        { operacoesChaveP95Ms: { x: 0 }, folgaOit: 0 },
        { operacoesChaveP95Ms: { x: 1 }, folgaOit: 0 },
        10,
      ).semPar,
    ).toEqual(['x']);
    expect(() => compararLinhaDeBase(antes, antes, -1)).toThrow(RangeError);
    expect(() => compararLinhaDeBase(antes, antes, Number.NaN)).toThrow(RangeError);
  });
});

describe('slisForaDaMeta', () => {
  it('lista só os medidos acima da meta', () => {
    expect(slisForaDaMeta({ abrirProntuarioP95Ms: 1600, loginP95Ms: 1900 })).toEqual([
      'abrirProntuarioP95Ms',
    ]);
    expect(slisForaDaMeta({})).toEqual([]);
  });
});
