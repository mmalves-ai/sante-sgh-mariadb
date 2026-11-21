// Aviso de valor crítico: quais alvos de um resultado liberado ganham aviso e qual regra vale para cada um.
// A precedência é do laboratório: a regra da unidade vale antes da regra da rede, e a regra do analito antes da regra do
// exame (cultura ou qualitativo sem analito). Sem regra vigente, o aviso nasce assim mesmo, com o prazo padrão: o
// resultado crítico nunca fica sem aviso. Regra pura, sem banco (a porta lê as candidatas vigentes e grava).

/** Prazo de comunicação, em minutos, quando nenhuma regra vigente cobre o alvo (o padrão da regra cadastrada). */
export const PRAZO_PADRAO_AVISO_CRITICO_MINUTOS = 30;

export interface RegraCriticoCandidata {
  readonly id: number;
  /** null: vale para todas as unidades (regra da rede). */
  readonly estabelecimento: number | null;
  readonly analito: number | null;
  readonly exame: number | null;
  readonly prazoMinutos: number | null;
}

export interface AlvoDoAviso {
  /** null: aviso do exame (o crítico não tem analito, como a cultura). */
  readonly analito: number | null;
  readonly resultadoAnalito: number | null;
}

/**
 * Os alvos que ganham aviso: um por analito crítico; sem analito crítico, um do exame quando o resultado é crítico.
 * O alvo que já tem aviso não se repete.
 */
export function alvosDoAviso(
  criticos: readonly { readonly analito: number | null; readonly resultadoAnalito: number }[],
  exameCritico: boolean,
  jaAvisados: ReadonlySet<number | null>,
): AlvoDoAviso[] {
  const todos: AlvoDoAviso[] = criticos.length
    ? criticos.map((c) => ({ analito: c.analito, resultadoAnalito: c.resultadoAnalito }))
    : exameCritico
      ? [{ analito: null, resultadoAnalito: null }]
      : [];
  return todos.filter((a) => !jaAvisados.has(a.resultadoAnalito));
}

/** A regra que vale para o alvo, entre as candidatas vigentes (unidade antes da rede, analito antes do exame). */
export function escolherRegraCritico(
  candidatas: readonly RegraCriticoCandidata[],
  alvo: { readonly estabelecimento: number; readonly exame: number; readonly analito: number | null },
): RegraCriticoCandidata | null {
  const cabe = (r: RegraCriticoCandidata) =>
    (r.estabelecimento === null || r.estabelecimento === alvo.estabelecimento) &&
    (alvo.analito !== null && r.analito === alvo.analito
      ? true
      : r.analito === null && r.exame === alvo.exame);
  const peso = (r: RegraCriticoCandidata) =>
    (r.estabelecimento !== null ? 2 : 0) + (r.analito !== null ? 1 : 0);
  let melhor: RegraCriticoCandidata | null = null;
  for (const r of candidatas) {
    if (!cabe(r)) continue;
    if (!melhor || peso(r) > peso(melhor) || (peso(r) === peso(melhor) && r.id > melhor.id)) melhor = r;
  }
  return melhor;
}

/** O prazo do aviso, em minutos: o da regra, ou o padrão quando não há regra (ou a regra não traz prazo válido). */
export function prazoDoAviso(regra: RegraCriticoCandidata | null): number {
  const p = regra?.prazoMinutos ?? null;
  return p !== null && p > 0 ? p : PRAZO_PADRAO_AVISO_CRITICO_MINUTOS;
}

/** O aviso de um alvo: a regra escolhida, o prazo e o instante-limite da comunicação. */
export function avisoDoAlvo(
  candidatas: readonly RegraCriticoCandidata[],
  alvo: { readonly estabelecimento: number; readonly exame: number; readonly analito: number | null },
  geradoEm: Date,
): { regra: number | null; prazoMinutos: number; prazoEm: Date } {
  const regra = escolherRegraCritico(candidatas, alvo);
  const prazoMinutos = prazoDoAviso(regra);
  return {
    regra: regra?.id ?? null,
    prazoMinutos,
    prazoEm: new Date(geradoEm.getTime() + prazoMinutos * 60_000),
  };
}
