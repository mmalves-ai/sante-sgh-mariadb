// Unificação de solicitante externo duplicado (F3.1, 02-CAD linha 20). O cadastro absorvido NÃO é apagado e os
// registros clínicos (atendimentos, pedidos de exame, autorizações, receitas) NÃO são alterados: continuam a apontar
// para o cadastro que o pedido teve na época. O absorvido fica inativo e guarda o ponteiro para o cadastro que
// continua (o sucessor); quem consulta o histórico segue o ponteiro. Por isso desfazer é seguro: só o ponteiro volta.
// Os códigos do absorvido nas fontes pagadoras passam ao sucessor só onde ele não tem código; onde os dois têm
// códigos diferentes, vale o do sucessor e a diferença é devolvida para a tela mostrar.

export interface SolicitanteNaUnificacao {
  readonly id: number;
  readonly ativo: boolean;
  /** Cadastro em que este já foi unificado, ou null. */
  readonly sucessor: number | null;
}

export interface CodigoFonteSolicitante {
  readonly fonte: number;
  readonly codigo: string;
  readonly ativo: boolean;
}

const motivoCurto = (m: string) => m.replace(/\s+/g, ' ').trim().length < 10;

/** O que impede unificar o absorvido no cadastro que continua. */
export function errosUnificacao(e: {
  mantido: SolicitanteNaUnificacao;
  absorvido: SolicitanteNaUnificacao;
  motivo: string;
}): string[] {
  const erros: string[] = [];
  if (e.mantido.id === e.absorvido.id) return ['mesmo-cadastro'];
  if (e.absorvido.sucessor !== null) erros.push('absorvido-ja-unificado');
  // O cadastro que continua tem de estar vivo: nem inativo, nem ele próprio unificado em outro (sem cadeias).
  if (e.mantido.sucessor !== null) erros.push('mantido-unificado');
  else if (!e.mantido.ativo) erros.push('mantido-inativo');
  if (motivoCurto(e.motivo)) erros.push('motivo-curto');
  return erros;
}

/**
 * Códigos nas fontes pagadoras na unificação: `herdar` são os códigos ativos do absorvido em fontes onde o cadastro
 * que continua não tem linha nenhuma; `divergentes` são as fontes em que os dois têm código ativo diferente (fica o
 * do cadastro que continua).
 */
export function codigosNaUnificacao(
  mantido: readonly CodigoFonteSolicitante[],
  absorvido: readonly CodigoFonteSolicitante[],
): { herdar: CodigoFonteSolicitante[]; divergentes: number[] } {
  const doMantido = new Map(mantido.map((c) => [c.fonte, c]));
  const herdar: CodigoFonteSolicitante[] = [];
  const divergentes: number[] = [];
  for (const c of absorvido) {
    if (!c.ativo) continue;
    const m = doMantido.get(c.fonte);
    if (!m) herdar.push(c);
    else if (m.ativo && m.codigo.trim().toUpperCase() !== c.codigo.trim().toUpperCase())
      divergentes.push(c.fonte);
  }
  return { herdar, divergentes: [...new Set(divergentes)].sort((a, b) => a - b) };
}

/** O que impede desfazer a unificação do absorvido. */
export function errosDesfazerUnificacao(e: { absorvido: SolicitanteNaUnificacao; motivo: string }): string[] {
  const erros: string[] = [];
  if (e.absorvido.sucessor === null) erros.push('nao-unificado');
  if (motivoCurto(e.motivo)) erros.push('motivo-curto');
  return erros;
}

/**
 * Cadastro que responde hoje por um solicitante: segue o ponteiro até o fim. Um ciclo (que o banco não deveria ter)
 * devolve o próprio ponto de partida, em vez de girar.
 */
export function solicitanteVigente(id: number, sucessorDe: ReadonlyMap<number, number | null>): number {
  const vistos = new Set<number>([id]);
  let atual = id;
  for (;;) {
    const prox = sucessorDe.get(atual) ?? null;
    if (prox === null) return atual;
    if (vistos.has(prox)) return id;
    vistos.add(prox);
    atual = prox;
  }
}
