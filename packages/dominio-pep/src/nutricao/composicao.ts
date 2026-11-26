// Composição nutricional dos alimentos (F8, 04-HOT linha 142): a tabela de composição (TACO 4ª ed., catálogo público;
// TBCA só com licença) traz a quantidade de cada nutriente em 100 g; a consulta mostra a porção que a nutricionista
// informa. Regra pura, sem banco: a escala pela porção, o arredondamento pela unidade e a validação da porção.

export interface NutrienteDoAlimento {
  readonly codigo: string;
  readonly descricao: string;
  readonly tipo: 'energia' | 'macronutriente' | 'micronutriente' | 'outro';
  readonly unidade: string;
  /** Quantidade em 100 g do alimento. */
  readonly quantidade100g: number;
}

export interface NutrienteDaPorcao extends NutrienteDoAlimento {
  /** Quantidade na porção informada, arredondada pela unidade. */
  readonly quantidadePorcao: number;
}

/** Porção aceita na consulta (g): de 1 g a 5 kg. */
export const PORCAO_MINIMA_G = 1;
export const PORCAO_MAXIMA_G = 5000;

/** Casas decimais pela unidade: energia sem casa, g com uma, mg com duas, mcg sem casa. */
export function casasDaUnidade(unidade: string): number {
  const u = unidade.trim().toLowerCase();
  if (u === 'kcal' || u === 'kj' || u === 'mcg' || u === 'µg') return 0;
  if (u === 'mg') return 2;
  return 1;
}

export function validarPorcao(gramas: number): string | null {
  if (!Number.isFinite(gramas)) return 'Informe a porção em gramas.';
  if (gramas < PORCAO_MINIMA_G || gramas > PORCAO_MAXIMA_G)
    return `A porção vai de ${PORCAO_MINIMA_G} g a ${PORCAO_MAXIMA_G} g.`;
  return null;
}

/** A composição da porção (em g) a partir dos valores por 100 g; recusa porção fora da faixa. */
export function composicaoDaPorcao(
  nutrientes: readonly NutrienteDoAlimento[],
  gramas: number,
): NutrienteDaPorcao[] {
  const erro = validarPorcao(gramas);
  if (erro) throw new RangeError(erro);
  return nutrientes.map((n) => {
    const f = 10 ** casasDaUnidade(n.unidade);
    return { ...n, quantidadePorcao: Math.round((n.quantidade100g * gramas * f) / 100) / f };
  });
}
