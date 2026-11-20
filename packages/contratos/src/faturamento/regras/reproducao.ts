// Os grupos de item aptos à liberação do lançamento manual (ficha do M30, campo 5, `faturamento.lancarItem`; cap-06b
// §6.5, Decisão): só os que o teste de reprodução (`pnpm faturamento:reproduzir`, relatório agregado em
// docs/marcos/M30/reproducao.md) pôs na meta (99% SADT e diárias e taxas, 98% mat/med, 97% honorários). Atualizado à mão
// depois de cada rodada da reprodução sobre a cópia real (DP-41); o grupo fora da lista segue no outro sistema, na mesma
// conta, mesmo com a chave do lançamento manual ligada.
import type { GrupoItem } from './tipo-item.js';

export const GRUPOS_NA_META: readonly GrupoItem[] = [];

export const RODADA_REPRODUCAO = { data: null as string | null, relatorio: 'docs/marcos/M30/reproducao.md' };

export function grupoLiberadoPelaReproducao(
  grupo: GrupoItem,
  aptos: readonly GrupoItem[] = GRUPOS_NA_META,
): boolean {
  return aptos.includes(grupo);
}
