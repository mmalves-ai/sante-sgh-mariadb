// Regra 9 (ficha do M54; cap-16 §16.3.4, DP-39; cap-06a §6.4): o custo do material é o da saída pelo preço médio que os
// gatilhos do banco gravam na linha (média ponderada móvel por item e empresa). O Sante não recalcula o preço médio nem
// grava nada no estoque; o custo por local (DP-39) só existirá em SGH_ quando a controladoria decidir: até lá, o
// contorno da ficha (custo médio por item e empresa, dos gatilhos).
//
// A linha de valor atípico (quantidade × preço médio acima do limite, em geral código de barras digitado na
// quantidade) fica fora do custo direto, contada e somada à parte: a apuração imprime as duas parcelas.

/** Política do custo de estoque em vigor (DP-39 sem decisão: a média por item e empresa dos gatilhos). */
export const POLITICA_CUSTO_ESTOQUE = {
  base: 'preco-medio-dos-gatilhos',
  porLocal: false,
  decisao: 'DP-39',
} as const;

const centavosDe = (v: number | string | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/**
 * O valor de uma linha de saída em centavos: quantidade (NUMERIC(15,3)) × preço médio (NUMERIC(15,2)), em milésimos ×
 * centavos e arredondado no fim (o mesmo cálculo da contabilização, para os dois caminhos darem o mesmo total).
 */
export function valorSaidaCentavos(
  quantidade: number | string | null | undefined,
  precoMedio: number | string | null | undefined,
): number {
  const qtdMil = Math.round(Number(quantidade ?? 0) * 1000);
  if (!Number.isFinite(qtdMil)) return 0;
  const medio = centavosDe(precoMedio);
  const bruto = qtdMil * medio;
  return Math.sign(bruto) * Math.round(Math.abs(bruto) / 1000);
}

/** A linha é atípica quando o valor passa do limite (centavos). */
export function saidaAtipica(valorCentavos: number, limiteCentavos: number): boolean {
  return Math.abs(valorCentavos) > limiteCentavos;
}

/** Valor agregado no banco (reais com fração) para centavos. */
export function reaisParaCentavos(v: number | string | null | undefined): number {
  return centavosDe(v);
}
