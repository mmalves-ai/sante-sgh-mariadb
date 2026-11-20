import { esquemaVersao } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { dadosDoBuild, identificar, marcarCommit, montarVersao } from './versao.js';

describe('versão rastreável (regra 5)', () => {
  it('com git, a identificação leva o commit', () => {
    const v = montarVersao('Produto X', {
      versao: '0.1.0',
      commit: 'abc123def456',
      construidoEm: '2026-10-19T19:30:00.000Z',
    });
    expect(v.identificacao).toBe('0.1.0+abc123def456');
    expect(esquemaVersao.parse(v)).toEqual(v);
  });

  it('sem git, a identificação leva a data do build', () => {
    expect(identificar({ versao: '0.1.0', commit: null, construidoEm: '2026-10-19T19:30:05.000Z' })).toBe(
      '0.1.0+build.20261019193005',
    );
  });

  it('fora do build (testes), usa versão de desenvolvimento e a data informada', () => {
    const agora = new Date('2026-10-19T12:00:00.000Z');
    expect(dadosDoBuild(agora)).toEqual({
      versao: '0.0.0-dev',
      commit: null,
      construidoEm: agora.toISOString(),
    });
  });

  it('build com árvore suja leva -dirty no commit', () => {
    expect(marcarCommit('abc123def456\n', '')).toBe('abc123def456');
    expect(marcarCommit('abc123def456', ' M apps/api/src/main.ts\n')).toBe('abc123def456-dirty');
    expect(marcarCommit('', '')).toBeNull();
    expect(
      identificar({
        versao: '0.1.0',
        commit: 'abc123def456-dirty',
        construidoEm: '2026-10-19T19:30:00.000Z',
      }),
    ).toBe('0.1.0+abc123def456-dirty');
  });
});
