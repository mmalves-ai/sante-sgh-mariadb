// Reativação e alteração da alergia do paciente (03-PEP L100; segurança na medicação, ONA/JCI). A alergia retirada
// por engano volta à lista ativa com motivo; a alergia ativa tem a gravidade, a reação, a origem da informação, a
// observação e as manifestações corrigidas sem perder o histórico (o evento de cada mudança fica em
// alergia-historico.ts). O agente nunca muda numa alteração: agente diferente é outra alergia.
// Regra pura: sem banco nem I/O; a porta própria grava o que estas funções devolvem.

/** O que a regra precisa saber da alergia (lida da linha travada). */
export interface AlergiaParaMudanca {
  readonly id: number;
  readonly ativa: boolean;
  readonly agente: number | null;
  readonly descricaoLivre: string | null;
  readonly gravidade: string | null;
  readonly reacao: string | null;
  readonly fonte: string | null;
  readonly observacao: string | null;
  readonly manifestacoes: readonly number[];
}

/** A outra alergia ativa do paciente (para a duplicidade da reativação). */
export interface AlergiaAtivaParaReativar {
  readonly id: number;
  readonly agente: number | null;
  readonly descricaoLivre: string | null;
}

/** O pedido de alteração: o estado completo dos campos editáveis (nulo apaga o campo). */
export interface PedidoAlteracaoAlergia {
  readonly gravidade: string | null;
  readonly reacao: string | null;
  readonly fonte: string | null;
  readonly observacao: string | null;
  readonly manifestacoes: readonly number[];
}

export interface AlteracaoAlergia {
  /** Colunas que mudam, com o valor novo (só as que mudaram). */
  readonly campos: Readonly<
    Record<'gravidade' | 'reacao' | 'fonte_informacao' | 'observacao', string | null>
  >;
  readonly incluir: readonly number[];
  readonly retirar: readonly number[];
  readonly manifestacoes: readonly number[];
}

export class RecusaMudancaAlergia extends Error {
  constructor(
    readonly codigo: 'ja-ativa' | 'ja-retirada' | 'duplicada' | 'sem-mudanca',
    mensagem: string,
  ) {
    super(mensagem);
  }
}

/** Descrição livre comparável: sem acento, minúscula, espaços colapsados (a mesma duplicidade do registro). */
export function descricaoComparavel(t: string | null): string | null {
  if (t === null) return null;
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const mesmoAgente = (
  a: AlergiaAtivaParaReativar,
  b: { agente: number | null; descricaoLivre: string | null },
): boolean =>
  a.agente !== null
    ? a.agente === b.agente
    : b.agente === null && descricaoComparavel(a.descricaoLivre) === descricaoComparavel(b.descricaoLivre);

/**
 * A reativação vale? Recusa: a alergia já ativa; o mesmo agente (catálogo ou descrição livre) já ativo em outra
 * alergia do paciente (a lista nunca tem o agente duas vezes).
 */
export function conferirReativacao(
  alvo: AlergiaParaMudanca,
  ativas: readonly AlergiaAtivaParaReativar[],
): void {
  if (alvo.ativa) throw new RecusaMudancaAlergia('ja-ativa', 'A alergia já está na lista ativa.');
  if (ativas.some((a) => a.id !== alvo.id && mesmoAgente(a, alvo)))
    throw new RecusaMudancaAlergia(
      'duplicada',
      'O agente já está na lista ativa em outra alergia: altere aquela em vez de reativar esta.',
    );
}

const ordenados = (ids: readonly number[]): number[] => [...new Set(ids)].sort((a, b) => a - b);
const limpo = (t: string | null): string | null => (t?.trim() ? t.trim() : null);

/**
 * O que muda na alteração. Recusa: a alergia retirada (reative antes); nada mudou (o evento sem mudança só polui o
 * histórico).
 */
export function alteracaoDaAlergia(
  alvo: AlergiaParaMudanca,
  pedido: PedidoAlteracaoAlergia,
): AlteracaoAlergia {
  if (!alvo.ativa)
    throw new RecusaMudancaAlergia(
      'ja-retirada',
      'A alergia foi retirada da lista: reative-a antes de alterar.',
    );
  const novo = {
    gravidade: pedido.gravidade,
    reacao: limpo(pedido.reacao),
    fonte_informacao: pedido.fonte,
    observacao: limpo(pedido.observacao),
  };
  const antigo = {
    gravidade: alvo.gravidade,
    reacao: alvo.reacao,
    fonte_informacao: alvo.fonte,
    observacao: alvo.observacao,
  };
  const campos: Record<string, string | null> = {};
  for (const k of Object.keys(novo) as (keyof typeof novo)[]) if (novo[k] !== antigo[k]) campos[k] = novo[k];
  const antes = new Set(alvo.manifestacoes);
  const depois = ordenados(pedido.manifestacoes);
  const incluir = depois.filter((m) => !antes.has(m));
  const retirar = ordenados(alvo.manifestacoes).filter((m) => !depois.includes(m));
  if (Object.keys(campos).length === 0 && incluir.length === 0 && retirar.length === 0)
    throw new RecusaMudancaAlergia('sem-mudanca', 'Nada mudou na alergia.');
  return { campos: campos as AlteracaoAlergia['campos'], incluir, retirar, manifestacoes: depois };
}
