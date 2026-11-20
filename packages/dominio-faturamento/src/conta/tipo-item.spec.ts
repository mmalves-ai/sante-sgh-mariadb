// Regra 6 (ficha do M30): FCLANEXT.TIPO é o único separador confiável; a meta de liberação por grupo.
import { describe, expect, it } from 'vitest';
import {
  ehTipoItem,
  grupoAtingeMeta,
  grupoDoItem,
  META_REPRODUCAO,
  origemDoItem,
  ROTULO_GRUPO,
} from '../index.js';

describe('grupo do item (regra 6)', () => {
  it('1 diárias e taxas, 2 honorários, 3 SADT, 4 mat/med', () => {
    expect(grupoDoItem(1)).toBe('diarias-taxas');
    expect(grupoDoItem(2)).toBe('honorarios');
    expect(grupoDoItem(3)).toBe('sadt');
    expect(grupoDoItem(4)).toBe('matmed');
    expect(grupoDoItem(5)).toBeNull();
    expect(grupoDoItem(null)).toBeNull();
    expect(ehTipoItem('3')).toBe(false);
    expect(ROTULO_GRUPO.sadt).toContain('SADT');
  });
  it('metas: 99% SADT e diárias, 98% mat/med, 97% honorários', () => {
    expect(META_REPRODUCAO).toEqual({ 'diarias-taxas': 0.99, honorarios: 0.97, sadt: 0.99, matmed: 0.98 });
    expect(grupoAtingeMeta('sadt', 99, 100)).toBe(true);
    expect(grupoAtingeMeta('sadt', 98, 100)).toBe(false);
    expect(grupoAtingeMeta('honorarios', 97, 100)).toBe(true);
    expect(grupoAtingeMeta('matmed', 0, 0)).toBe(false);
  });
  it('origem: os valores vistos com legenda; B, P, D e desconhecidos "a confirmar"', () => {
    expect(origemDoItem('C')).toEqual({ rotulo: 'Lançamento manual na conta', aConfirmar: false });
    expect(origemDoItem('b').aConfirmar).toBe(true);
    expect(origemDoItem('Z')).toEqual({ rotulo: 'Origem Z (a confirmar)', aConfirmar: true });
    expect(origemDoItem(null).rotulo).toBe('Sem origem');
  });
});

describe('liberação do lançamento manual pela reprodução', () => {
  it('só o grupo na meta da rodada', async () => {
    const { grupoLiberadoPelaReproducao, GRUPOS_NA_META } = await import('../index.js');
    expect(Array.isArray(GRUPOS_NA_META)).toBe(true);
    expect(grupoLiberadoPelaReproducao('sadt', ['sadt'])).toBe(true);
    expect(grupoLiberadoPelaReproducao('matmed', ['sadt'])).toBe(false);
    expect(grupoLiberadoPelaReproducao('matmed')).toBe(GRUPOS_NA_META.includes('matmed'));
  });
});
