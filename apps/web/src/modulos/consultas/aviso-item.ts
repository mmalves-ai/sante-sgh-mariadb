// O aviso da consulta de um item do menu (M14; correção do M45.6): o item que ainda não tem tela de trabalho mostra o
// aviso "tela completa na Fase N"; o item que já tem a tela própria (a rota do menu fora de /consultas/item) mostra que
// estas são as tabelas de apoio, somente leitura, com o caminho para a tela de trabalho.
import type { ItemMenu } from '@sgh/contratos';

export type AvisoItemConsulta =
  { readonly tipo: 'fase'; readonly fase: number } | { readonly tipo: 'apoio'; readonly rota: string } | null;

export function avisoDoItem(menu: Pick<ItemMenu, 'fase' | 'rota'> | null): AvisoItemConsulta {
  if (!menu) return null;
  if (menu.rota && !menu.rota.startsWith('/consultas/item')) return { tipo: 'apoio', rota: menu.rota };
  return menu.fase > 1 ? { tipo: 'fase', fase: menu.fase } : null;
}
