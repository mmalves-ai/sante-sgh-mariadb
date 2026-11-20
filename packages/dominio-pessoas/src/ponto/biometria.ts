// Biometria no ponto, regra 15 do M52 (cap-07 §7.1.3; cap-08 §8.13; LGPD-09; DP-45): só com a base legal registrada
// pelo DPO. Sem a decisão, o ponto vem do relógio de mercado (sem biometria no Sante SGH) e o login é por senha. O
// parâmetro `pessoas.ponto.biometria` nasce desligado; só o valor booleano verdadeiro, gravado de propósito, liga.
export function biometriaNoPonto(valor: unknown): boolean {
  return valor === true || valor === 'true' || valor === 'sim';
}
