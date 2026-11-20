import { describe, expect, it } from 'vitest';
import { conferirEdicao } from './vigencia.js';

// Regra 4: edição passada nunca é sobrescrita (SIGTAP por competência, Brasíndice por edição, TISS por versão);
// regra 11: versão TISS que o banco não tem não entra (DP-37).
describe('edição, competência e versão', () => {
  it('sem edição no catálogo', () => {
    expect(conferirEdicao({ tipo: 'nenhuma', nova: null, ultimaNoBanco: null })).toEqual({ ok: true });
  });
  it('competência', () => {
    expect(conferirEdicao({ tipo: 'competencia', nova: '201312', ultimaNoBanco: '201311' })).toEqual({
      ok: true,
    });
    expect(conferirEdicao({ tipo: 'competencia', nova: '201311', ultimaNoBanco: '201311' })).toEqual({
      ok: true,
    });
    expect(conferirEdicao({ tipo: 'competencia', nova: '201310', ultimaNoBanco: '201311' })).toMatchObject({
      ok: false,
      codigo: 'edicao-passada',
    });
    expect(conferirEdicao({ tipo: 'competencia', nova: '2013', ultimaNoBanco: null })).toMatchObject({
      codigo: 'edicao-invalida',
    });
    expect(conferirEdicao({ tipo: 'competencia', nova: null, ultimaNoBanco: null })).toMatchObject({
      codigo: 'edicao-ausente',
    });
  });
  it('edição', () => {
    expect(conferirEdicao({ tipo: 'edicao', nova: '1096', ultimaNoBanco: '1095' })).toEqual({ ok: true });
    expect(conferirEdicao({ tipo: 'edicao', nova: '999', ultimaNoBanco: '1095' })).toMatchObject({
      codigo: 'edicao-passada',
    });
    expect(conferirEdicao({ tipo: 'edicao', nova: 'x', ultimaNoBanco: null })).toMatchObject({
      codigo: 'edicao-invalida',
    });
  });
  it('versão TISS existente e inexistente', () => {
    const versoesTiss = ['4.01.00', '4.02.00'];
    expect(
      conferirEdicao({ tipo: 'versao-tiss', nova: '4.02.00', ultimaNoBanco: null, versoesTiss }),
    ).toEqual({ ok: true });
    expect(
      conferirEdicao({ tipo: 'versao-tiss', nova: '4.03.00', ultimaNoBanco: null, versoesTiss }),
    ).toMatchObject({ codigo: 'versao-inexistente' });
    expect(conferirEdicao({ tipo: 'versao-tiss', nova: '4.3', ultimaNoBanco: null })).toMatchObject({
      codigo: 'edicao-invalida',
    });
  });
});
