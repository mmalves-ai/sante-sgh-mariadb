// F3.8, 07-FIN linha 98: reclassificação gerencial de um lançamento já gravado (título a pagar, título a receber ou
// movimento bancário). Regra pura, sem banco.
// Desenho: quem corrige escolhe a nova natureza e o novo rateio por centro de custo numa tela só, vendo o antes ao
// lado; o motivo é obrigatório. O lançamento original não se apaga: as linhas de rateio anteriores ficam no registro
// (marcadas como substituídas) e o antes e o depois vão à trilha. Não se reclassifica lançamento cancelado nem com
// data numa competência financeira fechada (a correção de um mês fechado pede a reabertura, com justificativa).
import {
  calcularRateio,
  type LinhaRateio,
  type RecusaFinanceiro,
  recusaFin,
} from '@sgh/contratos/regras-financeiro';

/** O motivo mínimo da reclassificação: o porquê tem de ficar claro no registro. */
export const MOTIVO_RECLASSIFICACAO_MINIMO = 10;

export interface RateioGravado {
  readonly centroCusto: number;
  readonly percentual: number;
  readonly valor: number;
}

/** A classificação gerencial de um lançamento: a natureza e o rateio por centro. */
export interface ClassificacaoDoLancamento {
  readonly natureza: number;
  readonly rateio: readonly RateioGravado[];
}

export interface PedidoReclassificacao {
  /** O lançamento está cancelado, estornado ou excluído. */
  readonly cancelado: boolean;
  /** A data do lançamento cai numa competência financeira fechada. */
  readonly competenciaFechada: boolean;
  /** O valor do lançamento (base do rateio), em reais. */
  readonly valor: number;
  readonly antes: ClassificacaoDoLancamento;
  readonly natureza: number;
  readonly rateio: readonly LinhaRateio[];
  readonly motivo: string;
  /** O tipo (receita, despesa, transferência) da natureza atual e da nova: uma despesa não vira receita. */
  readonly tipoNaturezaAntes?: string | null;
  readonly tipoNaturezaNova?: string | null;
}

export type PlanoReclassificacao =
  | {
      readonly ok: true;
      readonly depois: ClassificacaoDoLancamento;
      /** O centro de maior percentual (o primeiro no empate): vai ao cabeçalho do lançamento. */
      readonly centroPrincipal: number;
      readonly mudouNatureza: boolean;
      readonly mudouRateio: boolean;
    }
  | { readonly ok: false; readonly recusa: RecusaFinanceiro };

const chaveRateio = (r: readonly { centroCusto: number; percentual: number }[]): string =>
  [...r]
    .map((x) => `${x.centroCusto}:${Math.round(x.percentual * 10_000)}`)
    .sort()
    .join('|');

/** Confere o pedido e calcula o novo rateio (em centavos, a última linha leva a diferença). */
export function planejarReclassificacao(p: PedidoReclassificacao): PlanoReclassificacao {
  const falha = (codigo: string, mensagem: string, campos: string[]) => ({
    ok: false as const,
    recusa: recusaFin(codigo, mensagem, campos),
  });
  if (p.cancelado)
    return falha('reclassificacao-cancelado', 'O lançamento está cancelado: não se reclassifica.', []);
  if (p.competenciaFechada)
    return falha(
      'reclassificacao-periodo-fechado',
      'A competência do lançamento está fechada: reabra o período, com justificativa, para reclassificar.',
      [],
    );
  if (p.motivo.trim().length < MOTIVO_RECLASSIFICACAO_MINIMO)
    return falha(
      'reclassificacao-sem-motivo',
      `Diga o motivo da reclassificação (ao menos ${MOTIVO_RECLASSIFICACAO_MINIMO} letras).`,
      ['motivo'],
    );
  if (p.tipoNaturezaAntes && p.tipoNaturezaNova && p.tipoNaturezaAntes !== p.tipoNaturezaNova)
    return falha(
      'reclassificacao-tipo-trocado',
      `A natureza nova é de ${p.tipoNaturezaNova} e o lançamento é de ${p.tipoNaturezaAntes}: escolha uma do mesmo tipo.`,
      ['classificacao'],
    );
  if (p.rateio.length === 0)
    return falha('reclassificacao-sem-centro', 'Informe ao menos um centro de custo (100%).', ['rateio']);
  const r = calcularRateio(p.rateio, p.valor);
  if (!r.ok) return { ok: false, recusa: r.recusa };
  const mudouNatureza = p.natureza !== p.antes.natureza;
  const mudouRateio = chaveRateio(r.rateio) !== chaveRateio(p.antes.rateio);
  if (!mudouNatureza && !mudouRateio)
    return falha(
      'reclassificacao-sem-mudanca',
      'A nova classificação é igual à atual: nada a reclassificar.',
      ['classificacao', 'rateio'],
    );
  let principal = r.rateio[0]!;
  for (const x of r.rateio) if (x.percentual > principal.percentual) principal = x;
  return {
    ok: true,
    depois: { natureza: p.natureza, rateio: r.rateio },
    centroPrincipal: principal.centroCusto,
    mudouNatureza,
    mudouRateio,
  };
}
