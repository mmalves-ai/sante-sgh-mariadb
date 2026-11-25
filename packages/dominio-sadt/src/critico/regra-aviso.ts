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

/** Um aviso de valor crítico já gravado do resultado (o que a porta leu). */
export interface AvisoCriticoGravado {
  readonly id: number;
  /** null: aviso do exame, sem analito. */
  readonly resultadoAnalito: number | null;
  readonly situacao: string;
}

/**
 * Os alvos que já têm aviso valendo (para não repetir): o aviso cancelado não conta, de modo que o valor que volta a
 * ser crítico depois de uma correção ganha aviso novo.
 */
export function alvosJaAvisados(avisos: readonly AvisoCriticoGravado[]): Set<number | null> {
  return new Set(avisos.filter((a) => a.situacao !== 'cancelado').map((a) => a.resultadoAnalito));
}

/**
 * Os avisos que a correção do valor superou: o analito deixou de ser crítico (ou o exame, no aviso sem analito) e
 * ninguém começou o contato. Só o aviso ainda pendente é cancelado (fica gravado, com a situação); o que já está em
 * contato, comunicado ou escalonado segue o curso dele, porque alguém já foi acionado pelo valor anterior.
 */
export function avisosSuperados(
  avisos: readonly AvisoCriticoGravado[],
  criticosAgora: ReadonlySet<number>,
  exameCritico: boolean,
): number[] {
  return avisos
    .filter((a) => a.situacao === 'pendente')
    .filter((a) => (a.resultadoAnalito === null ? !exameCritico : !criticosAgora.has(a.resultadoAnalito)))
    .map((a) => a.id);
}

/**
 * Quem é avisado da retificação de um resultado liberado: cada usuário que abriu o resultado antes da retificação, uma
 * vez só, menos quem retifica (ele já sabe). Sem leitura anterior, ninguém é avisado.
 */
export function destinatariosDaRetificacao(
  leituras: readonly { readonly usuario: number; readonly vistoEm: Date }[],
  retificadoPor: number | null,
  retificadoEm: Date,
): number[] {
  const vistos = new Set<number>();
  for (const l of leituras)
    if (l.usuario !== retificadoPor && l.vistoEm.getTime() <= retificadoEm.getTime()) vistos.add(l.usuario);
  return [...vistos].sort((a, b) => a - b);
}
