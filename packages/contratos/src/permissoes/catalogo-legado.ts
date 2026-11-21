// Catálogo de permissões GERADO da árvore de opções do legado (menu de origem; ficha do M06, regra 2): os dados
// ficam em catalogo-legado.json, escrito por `pnpm permissoes:verificar -- --atualizar` a partir do retrato
// versionado (tools/verificadores/dados/acesso-legado.<cod>.json) e conferido pelo mesmo comando no CI.
// Fora do índice de @sgh/contratos (importe de '@sgh/contratos/catalogo-legado'): não entra no pacote da tela.
import dados from './catalogo-legado.json' with { type: 'json' };
import type { DeclaracaoPermissao } from './tipos.js';

export const CATALOGO_LEGADO_ORIGEM: {
  readonly estabelecimento: string;
  readonly opcoes: number;
  readonly ativas: number;
  readonly porNivel: readonly number[];
  readonly modulos: number;
  readonly permissoes: number;
  readonly exclusoes: number;
} = dados.origem;

export const CATALOGO_LEGADO: readonly DeclaracaoPermissao[] =
  dados.permissoes as readonly DeclaracaoPermissao[];
