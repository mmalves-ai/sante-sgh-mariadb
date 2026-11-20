import { afterEach, describe, expect, it } from 'vitest';
import { CORES_REDE_SANTE } from '../tokens/marcas.js';
import { tokensDoTema } from '../tokens/cores.js';
import { CLASSE_ESCURO, folhaDeTokens } from './css.js';
import { protegerImpressao } from './impressao.js';

describe('impresso sempre claro (regra 4)', () => {
  afterEach(() => document.documentElement.classList.remove(CLASSE_ESCURO));

  it('a folha tem @media print com os tokens claros, inclusive sob .modo-escuro', () => {
    const css = folhaDeTokens(CORES_REDE_SANTE);
    const impressao = css.slice(css.indexOf('@media print'));
    const claro = tokensDoTema(CORES_REDE_SANTE).claro;
    expect(impressao).toContain(`:root.${CLASSE_ESCURO}`);
    expect(impressao).toContain(`--sgh-fundo: ${claro.fundo};`);
    expect(impressao).toContain(`--sgh-texto: ${claro.texto};`);
    expect(impressao).toContain('color-scheme: light');
  });

  it('durante a impressão a classe do modo escuro sai e volta depois', () => {
    const soltar = protegerImpressao(window);
    document.documentElement.classList.add(CLASSE_ESCURO);
    window.dispatchEvent(new Event('beforeprint'));
    expect(document.documentElement.classList.contains(CLASSE_ESCURO)).toBe(false);
    window.dispatchEvent(new Event('afterprint'));
    expect(document.documentElement.classList.contains(CLASSE_ESCURO)).toBe(true);
    soltar();
  });

  it('no tema claro, nada muda ao imprimir', () => {
    const soltar = protegerImpressao(window);
    window.dispatchEvent(new Event('beforeprint'));
    window.dispatchEvent(new Event('afterprint'));
    expect(document.documentElement.classList.contains(CLASSE_ESCURO)).toBe(false);
    soltar();
  });
});
