// A configuração sintética (sessão de dev e testes da API) é a mesma lida na cópia (fixture): nada se afasta sem aviso.
import { describe, expect, it } from 'vitest';
import { CONFIG } from './configuracao-pc.spec-util.js';
import { comImpressao } from './configuracao.js';
import { CONFIGURACAO_INDICES_SINTETICA } from './sintetica.js';

describe('configuração sintética dos índices', () => {
  it('igual à da cópia (mesma impressão)', async () => {
    expect((await comImpressao(CONFIGURACAO_INDICES_SINTETICA)).impressao).toBe(CONFIG.impressao);
  });
});
