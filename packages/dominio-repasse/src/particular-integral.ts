// ADR 0009: a marca da origem "consulta particular vai inteira ao médico" vira REGRA DE REPASSE (regra_repasse_item
// com a fonte particular, o item ou o grupo da consulta e 100%), separada do preço: o repasse incide sobre o valor
// COBRADO (o que a regra de preço particular ou a tabela deu), nunca sobre um valor próprio do médico.

export interface RegraRepasseParticularIntegral {
  readonly fontePagadoraId: number;
  readonly profissionalId: number | null;
  readonly itemFaturavelId: number | null;
  readonly grupoFaturamentoId: number | null;
  readonly percentual: 100;
  readonly descricao: string;
}

/** A regra de repasse 100% da consulta particular (um alvo: item ou grupo da consulta). */
export function regraRepasseParticularIntegral(e: {
  readonly fontePagadoraId: number;
  readonly profissionalId?: number | null;
  readonly itemFaturavelId?: number | null;
  readonly grupoFaturamentoId?: number | null;
}): RegraRepasseParticularIntegral {
  const item = e.itemFaturavelId ?? null;
  const grupo = e.grupoFaturamentoId ?? null;
  if ((item === null) === (grupo === null))
    throw new Error(
      'A regra de repasse integral precisa de exatamente um alvo: o item ou o grupo da consulta.',
    );
  return {
    fontePagadoraId: e.fontePagadoraId,
    profissionalId: e.profissionalId ?? null,
    itemFaturavelId: item,
    grupoFaturamentoId: grupo,
    percentual: 100,
    descricao: 'Consulta particular: repasse integral ao médico, sobre o valor cobrado.',
  };
}

/** O repasse da consulta particular integral: o valor cobrado inteiro, em centavos exatos. */
export function repasseParticularIntegral(valorCobrado: number): number {
  if (!Number.isFinite(valorCobrado) || valorCobrado < 0) throw new Error('Valor cobrado inválido.');
  return Math.round(valorCobrado * 100) / 100;
}

/** A regra vale para o item lançado? Mesma fonte, mesmo profissional (ou qualquer) e o item ou o grupo dele. */
export function repasseIntegralVale(
  r: RegraRepasseParticularIntegral,
  i: {
    readonly fontePagadoraId: number;
    readonly profissionalId: number | null;
    readonly itemFaturavelId: number;
    readonly grupoFaturamentoId: number | null;
  },
): boolean {
  return (
    r.fontePagadoraId === i.fontePagadoraId &&
    (r.profissionalId === null || r.profissionalId === i.profissionalId) &&
    (r.itemFaturavelId !== null
      ? r.itemFaturavelId === i.itemFaturavelId
      : r.grupoFaturamentoId !== null && r.grupoFaturamentoId === i.grupoFaturamentoId)
  );
}
