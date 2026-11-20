// Regra 7 (ficha do M29; cap-11 §11.2): a tela agrupa os 12 status em 5 situações de leitura fácil, sem mudar o que se
// grava; 2, 3 e 4 nunca vistos.
import { describe, expect, it } from 'vitest';
import {
  GRUPOS_SITUACAO_FARMACIA,
  grupoDaSituacao,
  nomeDaSituacao,
  resumoPorGrupo,
  SITUACOES_FARMACIA,
  SITUACOES_NUNCA_VISTAS,
} from '@sgh/contratos/regras-suprimentos';

describe('agrupamento dos 12 status em 5 situações', () => {
  it('os 12 códigos, cada um num dos 5 grupos', () => {
    expect(SITUACOES_FARMACIA.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(GRUPOS_SITUACAO_FARMACIA).toHaveLength(5);
    const grupos = new Set(GRUPOS_SITUACAO_FARMACIA.map((g) => g.id));
    for (const s of SITUACOES_FARMACIA) expect(grupos.has(s.grupo)).toBe(true);
    expect(SITUACOES_NUNCA_VISTAS).toEqual([2, 3, 4]);
  });
  it('o grupo e o nome de cada código; desconhecido: null e o código cru', () => {
    expect(grupoDaSituacao(5)).toBe('liberado');
    expect(grupoDaSituacao(1)).toBe('a-avaliar');
    expect(grupoDaSituacao(11)).toBe('dispensacao');
    expect(grupoDaSituacao(10)).toBe('interrompido');
    expect(grupoDaSituacao(4)).toBe('pendencia');
    expect(grupoDaSituacao(99)).toBeNull();
    expect(grupoDaSituacao(null)).toBeNull();
    expect(nomeDaSituacao(7)).toBe('Dispensado');
    expect(nomeDaSituacao(42)).toBe('Situação 42');
    expect(nomeDaSituacao(undefined)).toBe('Situação ?');
  });
  it('resumo: sempre os 5 grupos e os desconhecidos em "outros"', () => {
    expect(resumoPorGrupo([5, 5, 11, 6, 1, null, 13])).toEqual({
      'a-avaliar': 1,
      liberado: 2,
      pendencia: 0,
      dispensacao: 1,
      interrompido: 1,
      outros: 2,
    });
  });
});
