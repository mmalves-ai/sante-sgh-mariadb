import { describe, expect, it } from 'vitest';

import { estabelecimentoPadraoDoPortal } from './estabelecimento-padrao-portal.js';

describe('estabelecimento padrão do portal', () => {
  it('no banco, o primeiro estabelecimento ativo, e não a lista do ambiente', () => {
    expect(estabelecimentoPadraoDoPortal(['pc', 'hs'], false, { ESTABELECIMENTOS: 'xx' })).toBe('pc');
    expect(estabelecimentoPadraoDoPortal(['hs'], true, { ESTABELECIMENTOS: 'pc' })).toBe('hs');
  });

  it('no banco sem estabelecimento ativo, nenhum (o ambiente não substitui o cadastro)', () => {
    expect(estabelecimentoPadraoDoPortal([], false, { ESTABELECIMENTOS: 'pc,hs' })).toBeNull();
  });

  it('na memória, o primeiro código válido de ESTABELECIMENTOS', () => {
    expect(estabelecimentoPadraoDoPortal([], true, { ESTABELECIMENTOS: ' pc , hs' })).toBe('pc');
    expect(estabelecimentoPadraoDoPortal([], true, { ESTABELECIMENTOS: 'PC-1,hs' })).toBe('hs');
  });

  it('na memória sem configuração, nenhum', () => {
    expect(estabelecimentoPadraoDoPortal([], true, {})).toBeNull();
    expect(estabelecimentoPadraoDoPortal([], true, { ESTABELECIMENTOS: '' })).toBeNull();
  });
});
