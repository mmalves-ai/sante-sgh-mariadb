// Regra 6 (cap-07 §7.2, Nota): a exportação ao contador (M32) e a contabilidade própria usam o MESMO de-para.
// O de-para do banco (TBINTCRC, chave EMPRESA + CONV + TIPO_CONTA + TIPO_LANC + TIPO_ATO + SUBTIPO_DIARIA →
// CTA_CONTABIL inteiro; RPINTEVE para o repasse; TBINTIMP para os impostos) fala de "conta contábil do escritório", um
// inteiro. O plano próprio liga cada conta a esse inteiro por `contaExportacao`. A regra de contabilização com conta
// `dePara` pega a chave de um campo do fato e chega ao código do plano por esse vínculo.
//
// Achado do preparo (cópia pc, 24/10/2026): as 2.422 linhas de TBINTCRC estão SEM conta contábil (CTA_CONTABIL nulo ou
// zero) e nenhum dos 99 centros de custo tem a conta contábil (TBCENCUS.CONTABIL). Sem de-para preenchido, o fato fica
// "semConta" (nunca uma conta inventada) e a tela mostra a lista para o cadastro.
import type { ContaPlano } from '@sgh/contratos';

export interface ItemDePara {
  /** Chave canônica do de-para (montada por `chaveDePara`). */
  readonly chave: string;
  /** Conta do escritório (TBINTCRC.CTA_CONTABIL); null ou 0 = sem conta. */
  readonly contaExportacao: number | null;
}

/** Chave canônica a partir das partes (na ordem da chave do banco); nulo vira vazio. */
export function chaveDePara(partes: readonly (string | number | null | undefined)[]): string {
  return partes.map((p) => (p === null || p === undefined ? '' : String(p).trim())).join('|');
}

export interface ResolucaoDePara {
  readonly conta: string | null;
  readonly motivo: 'ok' | 'semItem' | 'semContaExportacao' | 'semContaNoPlano' | 'padrao';
}

/**
 * Conta do plano para a chave: o item do de-para → a conta do escritório → a conta do plano ligada a ela. Sem item ou
 * sem conta, usa a conta padrão da partida, se houver (motivo `padrao`), senão devolve null com o motivo.
 */
export function resolverDePara(
  chave: string,
  itens: ReadonlyMap<string, ItemDePara>,
  plano: readonly ContaPlano[],
  contaPadrao: string | null,
): ResolucaoDePara {
  const item = itens.get(chave);
  const falha = (motivo: ResolucaoDePara['motivo']): ResolucaoDePara =>
    contaPadrao ? { conta: contaPadrao, motivo: 'padrao' } : { conta: null, motivo };
  if (!item) return falha('semItem');
  if (!item.contaExportacao) return falha('semContaExportacao');
  const conta = plano.find(
    (c) => c.contaExportacao === item.contaExportacao && c.ativa && c.tipo === 'analitica',
  );
  if (!conta) return falha('semContaNoPlano');
  return { conta: conta.codigo, motivo: 'ok' };
}

/** Itens do de-para sem conta (para a lista "sem de-para" da tela, como no M32). */
export function itensSemConta(itens: Iterable<ItemDePara>): ItemDePara[] {
  return [...itens].filter((i) => !i.contaExportacao).sort((a, b) => a.chave.localeCompare(b.chave));
}
