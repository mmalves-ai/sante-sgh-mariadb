// Bloqueio da porta do novo por tentativas (ficha do M05, regra 5): limite de
// TBCFGLOGIN.QTDE_TENTATIVA_INVALIDA_BLOQ, no máximo 10; o novo bloqueia só a própria porta (contador no
// Valkey) e não grava no legado enquanto acesso.bloquearPorTentativas não estiver verde.
export const LIMITE_MAXIMO_TENTATIVAS = 10;
/** Padrão da coluna no legado (DEFAULT 3) quando vazia. */
export const LIMITE_PADRAO_TENTATIVAS = 3;
/** Prazo do bloqueio da porta (POL-1: padrão de mercado; parâmetro ACESSO_BLOQUEIO_PORTA_MINUTOS). */
export const BLOQUEIO_PORTA_PADRAO_MINUTOS = 15;

export function limiteTentativas(doLegado: number | null): number {
  if (doLegado === null || !Number.isFinite(doLegado) || doLegado < 1) return LIMITE_PADRAO_TENTATIVAS;
  return Math.min(Math.floor(doLegado), LIMITE_MAXIMO_TENTATIVAS);
}

/** Com `falhas` já contadas, a porta está fechada para este login. */
export function portaFechada(falhas: number, limite: number): boolean {
  return falhas >= limite;
}
