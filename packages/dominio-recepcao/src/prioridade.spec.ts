import { describe, expect, it } from 'vitest';
import { idadeEm, prioridadeDoGrupo, prioritaria, resolverPrioridade } from './prioridade.js';

describe('prioridade legal (regra 3: grava 0/1/2; grupo detalhado no novo)', () => {
  it('grupo → 0/1/2', () => {
    expect(prioridadeDoGrupo(0)).toBe('0');
    expect(prioridadeDoGrupo(1)).toBe('1');
    expect(prioridadeDoGrupo(2)).toBe('2');
    for (const g of [3, 4, 5, 6, 7, 8, 9]) expect(prioridadeDoGrupo(g)).toBe('1');
    expect(prioridadeDoGrupo(null)).toBe('2');
    expect(prioridadeDoGrupo(42)).toBe('2');
  });

  it('idade em anos completos', () => {
    expect(idadeEm('1946-10-21', '2026-10-21')).toBe(80);
    expect(idadeEm('1946-10-22', '2026-10-21')).toBe(79);
    expect(idadeEm('1946-11-01', '2026-10-21')).toBe(79);
  });

  it('acima de 80 anos é sempre 0; 60 a 79 sem grupo vira o grupo 3', () => {
    expect(resolverPrioridade({ nascimento: '1940-01-01', hoje: '2026-10-21', grupo: 4 })).toEqual({
      prioridade: '0',
      grupo: 0,
    });
    expect(resolverPrioridade({ nascimento: '1960-01-01', hoje: '2026-10-21' })).toEqual({
      prioridade: '1',
      grupo: 3,
    });
    expect(resolverPrioridade({ nascimento: '1960-01-01', hoje: '2026-10-21', grupo: 6 })).toEqual({
      prioridade: '1',
      grupo: 6,
    });
    expect(resolverPrioridade({ nascimento: '1990-01-01', hoje: '2026-10-21' })).toEqual({
      prioridade: '2',
      grupo: null,
    });
  });

  it('sem nascimento (ou a data vazia do legado): vale o grupo declarado', () => {
    expect(resolverPrioridade({ grupo: 4 })).toEqual({ prioridade: '1', grupo: 4 });
    expect(resolverPrioridade({ grupo: 2 })).toEqual({ prioridade: '2', grupo: null });
    expect(resolverPrioridade({ nascimento: '1899-12-30', hoje: '2026-10-21', grupo: 0 })).toEqual({
      prioridade: '0',
      grupo: 0,
    });
    expect(resolverPrioridade({})).toEqual({ prioridade: '2', grupo: null });
  });

  it('prioritária = 0 ou 1', () => {
    expect(prioritaria('0')).toBe(true);
    expect(prioritaria('1 ')).toBe(true);
    expect(prioritaria('2')).toBe(false);
  });
});
