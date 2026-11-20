// "Se necessário" e "a critério médico" (regra 9 da ficha do M24; cap-05b §5.7): exigem condição objetiva (os
// motivos do cadastro: febre, dor, náusea ou vômito, pressão alta, outros) e intervalo mínimo entre doses. Medido na
// cópia: 1.984 itens de 2026 com motivo, a maioria em 6/6 e 8/8 (o intervalo da frequência é o mínimo).
import type { Frequencia } from '@sgh/contratos';
import { NATUREZAS_A_CRITERIO } from './catalogo.js';

export type RecusaSeNecessario = 'motivo-necessario' | 'intervalo-necessario' | 'motivo-desconhecido';

export function conferirSeNecessario(
  f: Frequencia,
  sn: { readonly motivos: readonly number[]; readonly intervaloMinimoHoras: number } | null | undefined,
  motivosCadastro: ReadonlySet<number>,
): RecusaSeNecessario | null {
  const aCriterio = NATUREZAS_A_CRITERIO.includes(f.natureza);
  if (!sn) return aCriterio ? 'motivo-necessario' : null;
  if (sn.motivos.length === 0) return 'motivo-necessario';
  if (sn.motivos.some((m) => !motivosCadastro.has(m))) return 'motivo-desconhecido';
  if (!(sn.intervaloMinimoHoras > 0)) return 'intervalo-necessario';
  return null;
}

/** O intervalo mínimo sugerido: o da frequência (8/8 → 8 h); a critério, 6 h (padrão de mercado). */
export function intervaloSugerido(f: Frequencia): number {
  return f.intervaloHoras ?? 6;
}

export const MENSAGENS_SE_NECESSARIO: Readonly<Record<RecusaSeNecessario, string>> = {
  'motivo-necessario': 'Informe a condição objetiva ("em caso de febre", "em caso de dor"…).',
  'intervalo-necessario': 'Informe o intervalo mínimo entre as doses.',
  'motivo-desconhecido': 'Condição fora do cadastro do estabelecimento.',
};
