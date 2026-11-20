// Contexto que o MenuLateral passa aos níveis (MenuRamo, recursivo).
import type { InjectionKey } from 'vue';
import { normalizar } from './filtro-menu.js';

export interface ContextoMenu {
  aberto(chave: string): boolean;
  alternar(chave: string): void;
  /** Id do item da tela atual (ou null). */
  ativo(): string | null;
  navegou(): void;
}

export const CONTEXTO_MENU: InjectionKey<ContextoMenu> = Symbol('contexto-menu');

/** Id do elemento de um nível (para o `aria-controls` do botão que o abre). */
export function idDoNivel(chave: string): string {
  return `menu-nivel-${normalizar(chave).replace(/[^a-z0-9]+/g, '-')}`;
}
