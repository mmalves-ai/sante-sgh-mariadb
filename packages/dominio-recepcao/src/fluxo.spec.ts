import { describe, expect, it } from 'vitest';
import { destinosDe, motivoGeradorSemEmissao, podeEncaminhar, regraDoGerador } from './fluxo.js';

// Pares do cadastro de encaminhamentos do pc (12 ↔ 13, 23 → 13): só identificadores de estrutura.
const pares = [
  { de: 12, para: 13 },
  { de: 13, para: 12 },
  { de: 23, para: 13 },
];

describe('encaminhamento entre locais (regra 4)', () => {
  it('só para os locais permitidos, nunca para si', () => {
    expect(podeEncaminhar(12, 13, pares)).toBe(true);
    expect(podeEncaminhar(13, 12, pares)).toBe(true);
    expect(podeEncaminhar(13, 23, pares)).toBe(false);
    expect(podeEncaminhar(12, 12, [{ de: 12, para: 12 }])).toBe(false);
    expect(podeEncaminhar(2, 3, pares)).toBe(false);
  });

  it('destinos de um local', () => {
    expect(destinosDe(12, pares)).toEqual([13]);
    expect(destinosDe(2, pares)).toEqual([]);
  });
});

describe('tipos de gerador (regra 5)', () => {
  it('0 abre atendimento, 5 termina no guichê, 1 a 4 não usados', () => {
    expect(regraDoGerador('0')).toEqual({ usado: true, abreAtendimento: true, terminaNoGuiche: false });
    expect(regraDoGerador('5')).toEqual({ usado: true, abreAtendimento: false, terminaNoGuiche: true });
    for (const t of ['1', '2', '3', '4', '', null]) expect(regraDoGerador(t).usado).toBe(false);
  });

  it('gerador inativo ou de tipo não usado não emite', () => {
    expect(motivoGeradorSemEmissao({ tipo: '5', ativo: true })).toBeNull();
    expect(motivoGeradorSemEmissao({ tipo: '0', ativo: false })).toMatch(/inativo/);
    expect(motivoGeradorSemEmissao({ tipo: '3', ativo: true })).toMatch(/não é usado/);
  });
});
