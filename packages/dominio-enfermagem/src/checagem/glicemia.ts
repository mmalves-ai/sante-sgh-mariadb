// Glicemia pela escala (ficha do M25, regra 12; cap-05b §5.7; cap-11 §11.2): a glicemia checada registra o valor nos
// sinais vitais e indica a dose da faixa da escala prescrita (as faixas do item de glicemia da prescrição).
import type { FaixaGlicemiaLida } from '@sgh/contratos';

/** Regra 12: a faixa da escala em que o valor cai (limites inclusivos), ou null fora de todas. */
export function faixaDaGlicemia(
  valor: number,
  faixas: readonly FaixaGlicemiaLida[],
): FaixaGlicemiaLida | null {
  return faixas.find((f) => valor >= f.de && valor <= f.ate) ?? null;
}

/** Regra 12: a dose indicada para o valor (null: fora da escala ou faixa sem dose). */
export function doseDaGlicemia(
  valor: number,
  faixas: readonly FaixaGlicemiaLida[],
): {
  readonly dose: number | null;
  readonly unidade: string | null;
  readonly faixa: FaixaGlicemiaLida | null;
} {
  const f = faixaDaGlicemia(valor, faixas);
  return { dose: f?.dose ?? null, unidade: f?.unidade ?? null, faixa: f };
}
