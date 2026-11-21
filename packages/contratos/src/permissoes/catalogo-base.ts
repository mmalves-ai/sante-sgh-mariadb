// Catálogo-base de permissões do produto (ADR 0007, item 8): as permissões de cada tela, em `modulo.recurso.acao`,
// nos dados de catalogo-base.json. É dado próprio do produto: a correspondência com o menu de origem não fica aqui,
// vive só no mapa do conector (conector/mapa/permissoes.tsv).
// Fora do índice de @sgh/contratos (importe de '@sgh/contratos/catalogo-base'): não entra no pacote da tela.
import dados from './catalogo-base.json' with { type: 'json' };
import type { DeclaracaoPermissao } from './tipos.js';

export const CATALOGO_BASE_ORIGEM: { readonly descricao: string; readonly permissoes: number } = dados.origem;

export const CATALOGO_BASE: readonly DeclaracaoPermissao[] =
  dados.permissoes as readonly DeclaracaoPermissao[];
