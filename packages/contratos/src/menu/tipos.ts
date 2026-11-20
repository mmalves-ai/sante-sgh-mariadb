// Item do menu gerado da árvore (cap-04 §4.1; regra 12 do M07). O arquivo arvore.ts é GERADO por
// `pnpm nx run matriz:gerar-menu` a partir de planejamento/fonte-pdf/arvore-menus.txt: não editar à mão.
export type SeloMenu = 'M' | 'P' | 'N';
export type FaseMenu = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface ItemMenu {
  /** Id estável: caminho em minúsculas, sem acento, palavras com hífen, níveis com ponto. */
  readonly id: string;
  /** Área (título em caixa alta entre as linhas "=====") e grupo ("-- Agenda --"), quando houver. */
  readonly area: string;
  readonly grupo: string | null;
  /** Caminho completo, da raiz ao item. */
  readonly caminho: readonly string[];
  readonly titulo: string;
  /** M = já existe no legado; P = parcial; N = novo. */
  readonly selo: SeloMenu;
  readonly fase: FaseMenu;
  /** Rota da tela, quando já existe. Item sem rota não aparece no menu. */
  readonly rota: string | null;
  /** Permissão de leitura da tela, quando já existe. Item sem permissão não aparece no menu. */
  readonly permissao: string | null;
}

/** Contagens do cabeçalho da árvore ("Itens: 408 (M 189, P 57, N 162)"). */
export interface ContagemMenu {
  readonly total: number;
  readonly M: number;
  readonly P: number;
  readonly N: number;
}
