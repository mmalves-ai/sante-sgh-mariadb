import type { CoresDaMarca } from '../tokens/cores.js';
import { folhaDeTokens } from './css.js';

export const ID_FOLHA_TOKENS = 'sgh-tokens';

/** Injeta (ou troca) a folha de variáveis dos tokens no documento. */
export function injetarTokens(documento: Document, marca: CoresDaMarca): HTMLStyleElement {
  let el = documento.getElementById(ID_FOLHA_TOKENS) as HTMLStyleElement | null;
  if (!el) {
    el = documento.createElement('style');
    el.id = ID_FOLHA_TOKENS;
    documento.head.appendChild(el);
  }
  el.textContent = folhaDeTokens(marca);
  return el;
}
