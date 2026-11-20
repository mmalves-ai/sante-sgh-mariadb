// Tipos da tabela paginada no servidor (SanteTabela).
export interface ColunaTabela {
  readonly campo: string;
  readonly rotulo: string;
  readonly ordenavel?: boolean;
}
export interface ConsultaTabela {
  /** Página a partir de 0. */
  readonly pagina: number;
  /** Tamanho da página, nunca acima do teto. */
  readonly tamanho: number;
  readonly ordem: { readonly campo: string; readonly direcao: 'asc' | 'desc' } | null;
  readonly filtro: string;
}
export interface PaginaTabela<L> {
  readonly itens: readonly L[];
  readonly total: number;
}

/** Teto de página padrão (cap-10 §10.11: toda leitura tem teto). */
export const TETO_PAGINA_PADRAO = 100;
