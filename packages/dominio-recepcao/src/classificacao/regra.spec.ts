// M44, regra 3: as regras dos discriminadores em JSON Logic (subconjunto do editor; dados SINTÉTICOS).
import { describe, expect, it } from 'vitest';
import { ErroRegraClassificacao, problemasDaRegra, regraSatisfeita } from './regra.js';

describe('regras dos discriminadores', () => {
  it('comparações, and/or/!, in e missing sobre as variáveis da classificação', () => {
    const v = { saturacao: 88, fc: 120, dor: 6, temperatura: 38.2 };
    expect(regraSatisfeita({ '<': [{ var: 'saturacao' }, 90] }, v)).toBe(true);
    expect(regraSatisfeita({ '>=': [{ var: 'temperatura' }, 39] }, v)).toBe(false);
    expect(regraSatisfeita({ and: [{ '>': [{ var: 'fc' }, 100] }, { '<=': [{ var: 'dor' }, 7] }] }, v)).toBe(
      true,
    );
    expect(regraSatisfeita({ or: [{ '==': [{ var: 'dor' }, 10] }, { '!=': [{ var: 'fc' }, 120] }] }, v)).toBe(
      false,
    );
    expect(regraSatisfeita({ '!': { '<': [{ var: 'fc' }, 50] } }, v)).toBe(true);
    expect(regraSatisfeita({ in: [{ var: 'dor' }, [6, 7]] }, v)).toBe(true);
    expect(regraSatisfeita({ missing: ['glicemia'] }, v)).toBe(true);
    expect(regraSatisfeita({ missing: ['fc'] }, v)).toBe(false);
    expect(regraSatisfeita({ '!': { missing: ['fc', 'dor'] } }, v)).toBe(true);
  });

  it('sinal não medido nunca satisfaz comparação (o enfermeiro marca à mão)', () => {
    expect(regraSatisfeita({ '<': [{ var: 'saturacao' }, 90] }, {})).toBe(false);
    expect(regraSatisfeita({ '>=': [{ var: 'glicemia' }, 0] }, { glicemia: null })).toBe(false);
    expect(regraSatisfeita({ '!=': [{ var: 'fc' }, 80] }, {})).toBe(false);
  });

  it('operação, variável, aridade e profundidade fora do permitido são erro de publicação', () => {
    expect(problemasDaRegra({ '+': [1, 2] })).toEqual(['operação não permitida: +']);
    expect(problemasDaRegra({ var: 'nomePaciente' })).toEqual(['variável desconhecida: nomePaciente']);
    expect(problemasDaRegra({ '<': [{ var: 'fc' }] })).toEqual(['< compara dois valores']);
    expect(problemasDaRegra({ in: [{ var: 'dor' }, 3] })).toEqual(['in compara um valor com uma lista']);
    expect(problemasDaRegra({ '<': [1, 2], '>': [1, 2] })).toEqual(['cada nó da regra tem uma operação só']);
    expect(problemasDaRegra({ '!': [1, 2] })).toEqual(['! nega um valor']);
    expect(problemasDaRegra({ and: [] })).toEqual(['and sem termos']);
    expect(problemasDaRegra({ var: [] })).toEqual(['var sem variável']);
    let fundo: unknown = { var: 'fc' };
    for (let i = 0; i < 14; i++) fundo = { '!': fundo };
    expect(problemasDaRegra(fundo)).toEqual(['regra profunda demais']);
    expect(problemasDaRegra(() => 1)).toEqual(['valor inválido na regra']);
    expect(() => regraSatisfeita({ '+': [1, 2] }, {})).toThrow(ErroRegraClassificacao);
    expect(problemasDaRegra(true)).toEqual([]);
    expect(regraSatisfeita(true, {})).toBe(true);
  });
});
