// Colunas catalogadas como UTF-8 (cap-10 §10.2 e §10.7). Todo o resto do banco (charset NONE) é CP1252.
// Coluna nova só entra aqui com evidência do perfil (M03) e registro em docs/modulos/<modulo>.md.

/** `TABELA.COLUNA` em maiúsculas. */
export const COLUNAS_UTF8: ReadonlySet<string> = new Set([
  'PRCONTEVOL.EVOLUCAO_XML',
  // Descrições da matriz GUT: 11 de 15 linhas com sequências UTF-8 (C3 A7…), as demais só ASCII; varredura de
  // 24/10/2026 nas 1.183 colunas de texto das tabelas de cadastro (até 100 mil linhas): única coluna afetada.
  'RPMATRIZ_GUT_DESCRICAO.NOME',
]);

export function colunaUtf8(tabela: string, coluna: string): boolean {
  return COLUNAS_UTF8.has(`${tabela.trim().toUpperCase()}.${coluna.trim().toUpperCase()}`);
}
