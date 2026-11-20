// Reautenticação recente (cap-08 §8.4 e §8.8): trocar senha, gerir o segundo fator e as operações críticas
// pedem a senha de novo dentro de uma janela curta (padrão de mercado: 5 min; parâmetro).
export const JANELA_REAUTENTICACAO_PADRAO_SEGUNDOS = 5 * 60;

/** Até quando vale a última autenticação (null: nunca autenticou nesta sessão). */
export function reautenticacaoValidaAte(
  autenticadoEmMs: number | null,
  janelaSegundos: number,
): number | null {
  if (autenticadoEmMs === null || janelaSegundos <= 0) return null;
  return autenticadoEmMs + janelaSegundos * 1000;
}

export function reautenticacaoRecente(
  autenticadoEmMs: number | null,
  agoraMs: number,
  janelaSegundos: number,
): boolean {
  const ate = reautenticacaoValidaAte(autenticadoEmMs, janelaSegundos);
  return ate !== null && agoraMs < ate;
}
