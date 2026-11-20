// Regra 3 do M33: versão de regra com vigência; só vale aprovada (por outra pessoa); regra usada não muda.
import { describe, expect, it } from 'vitest';
import { podeAlterarRegra, transicaoVersaoRegra, type VersaoRegra } from './versao-regra.js';

const v = (estado: VersaoRegra['estado']): VersaoRegra => ({ estado, autor: 'ana', vigencia: '2026-11-01' });
const ana = { usuario: 'ana', hoje: '2026-10-23' };
const bia = { usuario: 'bia', hoje: '2026-10-23' };

describe('transicaoVersaoRegra', () => {
  it('rascunho → simulada → aprovada (outra pessoa) → incluída', () => {
    expect(transicaoVersaoRegra(v('rascunho'), 'simular', ana)).toEqual({ ok: true, estado: 'simulada' });
    expect(transicaoVersaoRegra(v('simulada'), 'aprovar', bia)).toEqual({ ok: true, estado: 'aprovada' });
    expect(transicaoVersaoRegra(v('aprovada'), 'incluir', bia)).toEqual({ ok: true, estado: 'incluida' });
  });

  it('quem propôs não aprova nem recusa; sem simular não aprova', () => {
    expect(transicaoVersaoRegra(v('simulada'), 'aprovar', ana).ok).toBe(false);
    expect(transicaoVersaoRegra(v('rascunho'), 'aprovar', bia).ok).toBe(false);
    expect(transicaoVersaoRegra(v('simulada'), 'recusar', ana).ok).toBe(false);
    expect(transicaoVersaoRegra(v('simulada'), 'recusar', bia)).toEqual({ ok: true, estado: 'recusada' });
  });

  it('edição só do rascunho e só por quem propôs; editar a simulada volta a rascunho', () => {
    expect(transicaoVersaoRegra(v('simulada'), 'editar', ana)).toEqual({ ok: true, estado: 'rascunho' });
    expect(transicaoVersaoRegra(v('rascunho'), 'editar', bia).ok).toBe(false);
    expect(transicaoVersaoRegra(v('aprovada'), 'editar', ana).ok).toBe(false);
  });

  it('aprovada, incluída e recusada não voltam; vigência vencida não é incluída', () => {
    expect(transicaoVersaoRegra(v('aprovada'), 'simular', ana).ok).toBe(false);
    expect(transicaoVersaoRegra(v('incluida'), 'recusar', bia).ok).toBe(false);
    expect(transicaoVersaoRegra(v('rascunho'), 'incluir', bia).ok).toBe(false);
    expect(transicaoVersaoRegra({ ...v('aprovada'), vigencia: '2026-10-01' }, 'incluir', bia)).toEqual({
      ok: false,
      motivo: 'A vigência já passou: proponha de novo com vigência futura.',
    });
  });
});

describe('podeAlterarRegra', () => {
  it('regra usada não muda', () => {
    expect(podeAlterarRegra(10, new Set([10]))).toBe(false);
    expect(podeAlterarRegra(11, new Set([10]))).toBe(true);
  });
});
