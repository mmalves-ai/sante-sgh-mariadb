/**
 * Permissão por procedimento do SUS no escopo da conta (01-ADM L59, C2-051; decisão registrada em
 * docs/obra/decisoes-tomadas.md, prática de mercado).
 *
 * A conta recebe grupos, subgrupos ou formas de organização da tabela unificada (códigos de 2, 4 ou 6 dígitos). Sem
 * nenhuma concessão vigente, a conta não tem restrição própria: vale só a compatibilidade do procedimento com a
 * ocupação (CBO), que a tabela unificada já traz. Com concessões, a conta só lança procedimentos cujo código de 10
 * dígitos começa por um dos códigos concedidos.
 */

const CODIGO_HIERARQUIA = /^(\d{2}|\d{4}|\d{6})$/;
const CODIGO_PROCEDIMENTO = /^\d{10}$/;

/** Código de grupo (2), subgrupo (4) ou forma de organização (6) válido para concessão. */
export function codigoHierarquiaSusValido(codigo: string): boolean {
  return CODIGO_HIERARQUIA.test(codigo);
}

/** O procedimento (código de 10 dígitos) está liberado para a conta com estas concessões? */
export function procedimentoSusLiberado(codigoProcedimento: string, concedidos: readonly string[]): boolean {
  const validos = concedidos.filter(codigoHierarquiaSusValido);
  if (validos.length === 0) return true;
  if (!CODIGO_PROCEDIMENTO.test(codigoProcedimento)) return false;
  return validos.some((c) => codigoProcedimento.startsWith(c));
}

/** Os procedimentos da lista que a conta não pode lançar (vazio = todos liberados). */
export function procedimentosSusForaDoEscopo(
  codigosProcedimento: readonly string[],
  concedidos: readonly string[],
): string[] {
  return [...new Set(codigosProcedimento.filter((c) => !procedimentoSusLiberado(c, concedidos)))];
}
