import { describe, expect, it } from 'vitest';
import {
  ambienteSintetico,
  devGravaCopia,
  fonteAcessoEfetiva,
  fonteDevDaCopia,
  fontesSinteticas,
  recusaDoAcesso,
} from './montar.js';

// F2-L: a fonte do login é a PRÓPRIA (banco do cliente); a sintética só vale em dev/ci.
describe('fonte de acesso (ACESSO_FONTE_DEV)', () => {
  it('sem declaração: ci sintética; dev própria com o núcleo (senão sintética); demais, sempre a própria', () => {
    expect(fonteAcessoEfetiva({ AMBIENTE: 'ci' }, true)).toBe('sintetica');
    expect(fonteAcessoEfetiva({ AMBIENTE: 'dev' }, true)).toBe('propria');
    expect(fonteAcessoEfetiva({ AMBIENTE: 'dev' }, false)).toBe('sintetica');
    for (const AMBIENTE of ['homolog', 'treino', 'producao'])
      expect(fonteAcessoEfetiva({ AMBIENTE }, false)).toBe('propria');
  });

  it('a declarada vale: propria em dev/ci, sintetica só em dev/ci', () => {
    expect(fonteAcessoEfetiva({ AMBIENTE: 'ci', ACESSO_FONTE_DEV: 'propria' }, true)).toBe('propria');
    expect(fonteAcessoEfetiva({ AMBIENTE: 'dev', ACESSO_FONTE_DEV: 'sintetica' }, true)).toBe('sintetica');
    expect(recusaDoAcesso({ AMBIENTE: 'dev', ACESSO_FONTE_DEV: 'propria' })).toBeNull();
    expect(recusaDoAcesso({ AMBIENTE: 'dev', ACESSO_FONTE_DEV: 'sintetica' })).toBeNull();
    expect(recusaDoAcesso({ AMBIENTE: 'producao', ACESSO_FONTE_DEV: 'sintetica' })).toMatch(/só vale/);
    expect(recusaDoAcesso({ AMBIENTE: 'homolog', ACESSO_FONTE_DEV: 'propria' })).toBeNull();
  });

  it('recusa a partida: AMBIENTE ausente ou desconhecido, valor inválido e a antiga fonte da cópia', () => {
    expect(recusaDoAcesso({})).toMatch(/AMBIENTE/);
    expect(recusaDoAcesso({ AMBIENTE: 'teste' })).toMatch(/AMBIENTE/);
    expect(recusaDoAcesso({ AMBIENTE: 'dev', ACESSO_FONTE_DEV: 'outra' })).toMatch(/inválido/);
    expect(recusaDoAcesso({ AMBIENTE: 'dev', ACESSO_FONTE_DEV: 'copia' })).toMatch(/não existe mais/);
    // Sem combinação de cifra antiga: produção sobe só com AMBIENTE.
    expect(recusaDoAcesso({ AMBIENTE: 'producao' })).toBeNull();
  });

  it('fontes em memória só em dev/ci com a fonte sintética; a cópia não existe mais', () => {
    expect(fontesSinteticas({ AMBIENTE: 'ci' })).toBe(true);
    expect(fontesSinteticas({ AMBIENTE: 'dev' }, true)).toBe(false);
    expect(fontesSinteticas({ AMBIENTE: 'dev', ACESSO_FONTE_DEV: 'sintetica' }, true)).toBe(true);
    expect(fontesSinteticas({ AMBIENTE: 'producao', ACESSO_FONTE_DEV: 'sintetica' })).toBe(false);
    expect(ambienteSintetico({ AMBIENTE: 'dev' })).toBe(true);
    const copia = { AMBIENTE: 'dev', ACESSO_FONTE_DEV: 'copia', DEV_GRAVA_COPIA: 'sim' };
    expect(fonteDevDaCopia(copia)).toBe(false);
    expect(devGravaCopia(copia)).toBe(false);
  });
});
