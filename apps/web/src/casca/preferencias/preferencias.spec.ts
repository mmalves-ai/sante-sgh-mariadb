// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import {
  CHAVE_ARMAZENAMENTO,
  PADRAO,
  aplicarPreferencias,
  gravarPreferencias,
  lerPreferencias,
  usarPreferencias,
} from './preferencias.js';

describe('preferências no navegador até o M05', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = '';
  });

  it('padrão: tema igual ao computador, densidade compacta', () => {
    expect(lerPreferencias()).toEqual({ tema: 'sistema', densidade: 'compacta', fonteAmpliada: false });
  });

  it('leitura protegida por try/catch: armazenamento quebrado ou valor estranho → padrão', () => {
    const quebrado = () => {
      throw new Error('bloqueado');
    };
    expect(lerPreferencias(quebrado)).toEqual(PADRAO);
    expect(gravarPreferencias(PADRAO, quebrado)).toBe(false);
    window.localStorage.setItem(
      CHAVE_ARMAZENAMENTO,
      '{"tema":"roxo","densidade":"painel","fonteAmpliada":1}',
    );
    expect(lerPreferencias()).toEqual(PADRAO);
    window.localStorage.setItem(CHAVE_ARMAZENAMENTO, 'não é json');
    expect(lerPreferencias()).toEqual(PADRAO);
  });

  it('aplica classes na raiz: escuro, densidade e fonte ampliada; "sistema" segue o computador', () => {
    const raiz = document.documentElement;
    aplicarPreferencias({ tema: 'escuro', densidade: 'confortavel', fonteAmpliada: true }, raiz, false);
    expect([...raiz.classList].sort()).toEqual(['densidade-confortavel', 'fonte-ampliada', 'modo-escuro']);
    aplicarPreferencias({ tema: 'sistema', densidade: 'compacta', fonteAmpliada: false }, raiz, true);
    expect([...raiz.classList].sort()).toEqual(['densidade-compacta', 'modo-escuro']);
    aplicarPreferencias({ tema: 'sistema', densidade: 'compacta', fonteAmpliada: false }, raiz, false);
    expect([...raiz.classList]).toEqual(['densidade-compacta']);
  });

  it('a loja aplica e grava a cada mudança', async () => {
    setActivePinia(createPinia());
    const p = usarPreferencias();
    p.tema = 'escuro';
    p.densidade = 'confortavel';
    await nextTick();
    expect(document.documentElement.classList.contains('modo-escuro')).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(CHAVE_ARMAZENAMENTO)!)).toEqual({
      tema: 'escuro',
      densidade: 'confortavel',
      fonteAmpliada: false,
    });
  });
});
