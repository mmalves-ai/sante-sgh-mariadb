import { describe, expect, it } from 'vitest';
import { ambienteSintetico, devGravaCopia, fonteDevDaCopia, fontesSinteticas } from './montar.js';

// Pedido do dono (17/11/2026): o dev sobre a cópia grava com DEV_GRAVA_COPIA=sim; nenhum outro ambiente muda.
describe('dev que grava na cópia (DEV_GRAVA_COPIA)', () => {
  const dev = { AMBIENTE: 'dev', ACESSO_FONTE_DEV: 'copia' };

  it('sem a chave, o dev sobre a cópia segue com as fontes em memória', () => {
    expect(fonteDevDaCopia(dev)).toBe(true);
    expect(devGravaCopia(dev)).toBe(false);
    expect(fontesSinteticas(dev)).toBe(true);
  });

  it('com DEV_GRAVA_COPIA=sim, as fontes de produção (o login continua o do dev)', () => {
    const env = { ...dev, DEV_GRAVA_COPIA: 'sim' };
    expect(devGravaCopia(env)).toBe(true);
    expect(fontesSinteticas(env)).toBe(false);
    expect(ambienteSintetico(env)).toBe(true);
  });

  it('a chave não vale sem a fonte da cópia nem fora do dev', () => {
    expect(devGravaCopia({ AMBIENTE: 'dev', DEV_GRAVA_COPIA: 'sim' })).toBe(false);
    expect(fontesSinteticas({ AMBIENTE: 'dev', DEV_GRAVA_COPIA: 'sim' })).toBe(true);
    expect(devGravaCopia({ AMBIENTE: 'ci', ACESSO_FONTE_DEV: 'copia', DEV_GRAVA_COPIA: 'sim' })).toBe(false);
    expect(fontesSinteticas({ AMBIENTE: 'ci', ACESSO_FONTE_DEV: 'copia', DEV_GRAVA_COPIA: 'sim' })).toBe(
      true,
    );
    expect(devGravaCopia({ ...dev, DEV_GRAVA_COPIA: 'nao' })).toBe(false);
  });
});
