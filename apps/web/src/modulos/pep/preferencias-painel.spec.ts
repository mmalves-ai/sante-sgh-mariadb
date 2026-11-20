// Preferências do painel por dono (rede, estabelecimento e login): o próximo usuário do navegador não herda os
// favoritos; sem sessão nada é lido nem guardado; valor estragado volta ao padrão.
import { COLUNAS_PAINEL } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { chavePainel, gravarPreferenciasPainel, lerPreferenciasPainel } from './preferencias-painel.js';

function armazenamento() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('preferências do painel (M23, D-PAINEL-1)', () => {
  it('a chave separa rede, estabelecimento e login; sem sessão, nenhuma', () => {
    expect(chavePainel({ rede: 'r', estabelecimento: 'pc', login: 'A' })).toBe('sgh.pep.painel:r:pc:A');
    expect(chavePainel(null)).toBeNull();
    expect(chavePainel({ rede: 'r', estabelecimento: '', login: 'A' })).toBeNull();
  });

  it('o próximo usuário do mesmo navegador não herda os favoritos de quem saiu', () => {
    const a = armazenamento();
    a.m.set('sgh.pep.painel', JSON.stringify({ favoritos: [9] }));
    const doA = chavePainel({ rede: 'r', estabelecimento: 'pc', login: 'A' });
    const doB = chavePainel({ rede: 'r', estabelecimento: 'pc', login: 'B' });
    const noOutro = chavePainel({ rede: 'r', estabelecimento: 'hs', login: 'A' });
    gravarPreferenciasPainel(doA, { favoritos: [1001], colunas: ['leito', 'paciente'], unidade: 3 }, a);
    expect(lerPreferenciasPainel(doA, a)).toEqual({
      favoritos: [1001],
      colunas: ['leito', 'paciente'],
      unidade: 3,
    });
    expect(lerPreferenciasPainel(doB, a).favoritos).toEqual([]);
    expect(lerPreferenciasPainel(noOutro, a).favoritos).toEqual([]);
    expect(a.m.has('sgh.pep.painel')).toBe(false);
  });

  it('sem chave ou com valor estragado: o padrão; colunas desconhecidas ficam de fora', () => {
    const a = armazenamento();
    expect(lerPreferenciasPainel(null, a).colunas).toEqual([...COLUNAS_PAINEL]);
    a.m.set('k', '{estragado');
    expect(lerPreferenciasPainel('k', a).favoritos).toEqual([]);
    a.m.set('k', JSON.stringify({ colunas: ['leito', 'x'], favoritos: ['1', 2] }));
    expect(lerPreferenciasPainel('k', a)).toEqual({
      favoritos: [2],
      colunas: [...COLUNAS_PAINEL],
      unidade: null,
    });
    gravarPreferenciasPainel(null, { favoritos: [], colunas: [], unidade: null }, a);
    expect(a.m.size).toBe(1);
  });
});
