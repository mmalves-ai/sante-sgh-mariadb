// Telefone brasileiro conferido pela área de DDD do plano de numeração (02-CAD linha 14). A área vem do catálogo
// (area_ddd, carregado do plano nacional); sem área ativa com o código, o DDD é recusado. O número, sem o DDD, tem
// o comprimento do fixo (começa de 2 a 5) ou do móvel (começa por 9) da área.

export interface AreaDdd {
  readonly ativa: boolean;
  readonly digitosFixo: number;
  readonly digitosMovel: number;
}

export type ClasseNumero = 'fixo' | 'movel';

/** Classe do número pela área (fixo ou móvel), ou null quando não cabe em nenhuma. */
export function classeDoNumero(numero: string, area: AreaDdd): ClasseNumero | null {
  if (!/^\d+$/.test(numero)) return null;
  if (numero.length === area.digitosMovel && numero.startsWith('9')) return 'movel';
  if (numero.length === area.digitosFixo && /^[2-5]/.test(numero)) return 'fixo';
  return null;
}

/**
 * Campos recusados de um telefone do Brasil (DDI 55) pela área de DDD: `ddd` quando a área não existe ou está
 * inativa; `numero` quando o número não tem a forma de fixo nem de móvel da área. Fora do Brasil, nada a conferir.
 */
export function errosTelefoneNaArea(
  t: { readonly ddi: string; readonly ddd: string | null; readonly numero: string },
  area: AreaDdd | null,
): string[] {
  if (t.ddi !== '55') return [];
  if (!area || !area.ativa) return ['ddd'];
  return classeDoNumero(t.numero, area) ? [] : ['numero'];
}
