// Numeração SNCR da receita eletrônica de controle especial e de antimicrobiano (M49; regra 10; DP-47.2: RDC Anvisa
// 1.000/2025 e 1.028/2026; exigida na receita ELETRÔNICA desde 2026-10-30; o papel segue válido). A numeração tem 16
// dígitos e uma receita leva vários medicamentos. Construída e DESLIGADA pela chave `receita.sncr` até a DP-23 e o
// credenciamento (POL-3). Aqui: o formato do número, a montagem da solicitação a partir da receita e a transição da
// solicitação (log em SGH_DOC_SNCR_SOLICITACAO). Os campos da API pública da Anvisa ficam para o adaptador do construtor
// (a especificação ainda não foi lida: ver preparo-e1.md, riscos).

export const FORMATO_NUMERO_SNCR = /^\d{16}$/;
export const numeroSncrValido = (n: string) => FORMATO_NUMERO_SNCR.test(n);

export const TIPOS_RECEITA_SNCR = ['controle-especial', 'antimicrobiano'] as const;
export type TipoReceitaSncr = (typeof TIPOS_RECEITA_SNCR)[number];

export interface ItemReceitaSncr {
  /** Código do medicamento no catálogo (M13). */
  readonly medicamento: number;
  readonly quantidade: number;
  readonly unidade: string;
}

export interface SolicitacaoSncr {
  readonly receita: number;
  readonly tipo: TipoReceitaSncr;
  readonly itens: readonly ItemReceitaSncr[];
}

/** Vários medicamentos na mesma receita: um item por medicamento (somadas as quantidades repetidas). */
export function montarSolicitacaoSncr(
  receita: number,
  tipo: TipoReceitaSncr,
  linhas: readonly ItemReceitaSncr[],
): SolicitacaoSncr {
  if (linhas.length === 0) throw new Error('Receita sem medicamento.');
  const por = new Map<string, ItemReceitaSncr>();
  for (const l of linhas) {
    if (!(l.quantidade > 0)) throw new Error('Quantidade do medicamento tem de ser positiva.');
    const k = `${l.medicamento}|${l.unidade}`;
    const a = por.get(k);
    por.set(k, a ? { ...a, quantidade: a.quantidade + l.quantidade } : l);
  }
  return { receita, tipo, itens: [...por.values()] };
}

export const SITUACOES_SNCR = ['pendente', 'numerada', 'recusada', 'erro'] as const;
export type SituacaoSncr = (typeof SITUACOES_SNCR)[number];

export interface EstadoSolicitacaoSncr {
  readonly situacao: SituacaoSncr;
  readonly tentativas: number;
  readonly numero: string | null;
}

/** Resposta da API (já traduzida pelo adaptador): numerada só com 16 dígitos; erro técnico tenta de novo até o teto. */
export function aplicarRespostaSncr(
  e: EstadoSolicitacaoSncr,
  r:
    | { readonly tipo: 'numero'; readonly numero: string }
    | { readonly tipo: 'recusa' }
    | { readonly tipo: 'erro' },
  maxTentativas: number,
): EstadoSolicitacaoSncr {
  if (e.situacao === 'numerada' || e.situacao === 'recusada') throw new Error('Solicitação já encerrada.');
  const tentativas = e.tentativas + 1;
  if (r.tipo === 'numero') {
    if (!numeroSncrValido(r.numero)) return { situacao: 'erro', tentativas, numero: null };
    return { situacao: 'numerada', tentativas, numero: r.numero };
  }
  if (r.tipo === 'recusa') return { situacao: 'recusada', tentativas, numero: null };
  return { situacao: tentativas >= maxTentativas ? 'erro' : 'pendente', tentativas, numero: null };
}
