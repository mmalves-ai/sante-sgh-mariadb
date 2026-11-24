// O plano da gravação da revisão de um prontuário pela comissão (qualidade.revisarProntuario): a partir das respostas
// já avaliadas pelo checklist e das pendências que a revisão anterior deixou, decide o resultado, o percentual de
// conformidade e o que acontece com cada pendência. Regra pura (o banco só executa o plano):
// - o resultado é não conforme quando há ao menos um item não conforme;
// - o percentual de conformidade conta só os itens aplicáveis (conforme ÷ (conforme + não conforme) × 100, com quatro
//   casas); sem item aplicável, não há percentual;
// - cada item não conforme sem pendência ganha uma pendência nova ao profissional; a pendência cancelada do mesmo item
//   reabre (nunca se cria outra: o histórico do item é um só); a aberta e a resolvida ficam como estão;
// - a pendência aberta de um item que deixou de ser não conforme (correção da revisão) é cancelada com o motivo;
// - pendência nova exige o profissional responsável (o médico assistente da internação): sem ele, a revisão com item
//   não conforme é recusada, porque a pendência não teria a quem ser cobrada.
import type { RespostaItemRevisao } from '@sgh/contratos';

export type SituacaoPendenciaPlano = 'aberta' | 'resolvida' | 'cancelada';

export interface PendenciaExistentePlano {
  readonly id: number;
  readonly item: string;
  readonly situacao: SituacaoPendenciaPlano;
}

export interface PlanoRevisaoProntuario {
  readonly resultado: 'conforme' | 'naoConforme';
  /** Conformidade dos itens aplicáveis (0 a 100, quatro casas); nulo quando nenhum item se aplica. */
  readonly percentual: number | null;
  /** Os itens não conformes que ganham pendência nova. */
  readonly criar: readonly string[];
  /** As pendências canceladas que voltam a abrir (o item voltou a ser não conforme). */
  readonly reabrir: readonly number[];
  /** As pendências abertas cujo item deixou de ser não conforme. */
  readonly cancelar: readonly number[];
  /** As pendências abertas depois da gravação (as que ficam, as novas e as reabertas). */
  readonly abertasDepois: number;
}

export type RecusaPlanoRevisao = 'pendencia-sem-responsavel';

export function planoRevisaoProntuario(
  respostas: readonly RespostaItemRevisao[],
  existentes: readonly PendenciaExistentePlano[],
  temResponsavel: boolean,
): { ok: true; plano: PlanoRevisaoProntuario } | { ok: false; motivo: RecusaPlanoRevisao } {
  const naoConformes = new Set(respostas.filter((r) => r.resultado === 'naoConforme').map((r) => r.item));
  const conformes = respostas.filter((r) => r.resultado === 'conforme').length;
  const aplicaveis = conformes + naoConformes.size;
  const porItem = new Map(existentes.map((p) => [p.item, p]));
  const criar = [...naoConformes].filter((i) => !porItem.has(i));
  const reabrir = existentes
    .filter((p) => p.situacao === 'cancelada' && naoConformes.has(p.item))
    .map((p) => p.id);
  const cancelar = existentes
    .filter((p) => p.situacao === 'aberta' && !naoConformes.has(p.item))
    .map((p) => p.id);
  if ((criar.length > 0 || reabrir.length > 0) && !temResponsavel)
    return { ok: false, motivo: 'pendencia-sem-responsavel' };
  const ficam = existentes.filter((p) => p.situacao === 'aberta' && naoConformes.has(p.item)).length;
  return {
    ok: true,
    plano: {
      resultado: naoConformes.size > 0 ? 'naoConforme' : 'conforme',
      percentual: aplicaveis === 0 ? null : Math.round((conformes / aplicaveis) * 1_000_000) / 10_000,
      criar,
      reabrir,
      cancelar,
      abertasDepois: ficam + criar.length + reabrir.length,
    },
  };
}

/** O motivo gravado na pendência cancelada pela correção da revisão (até 1000 caracteres, como a coluna). */
export function motivoCancelamentoPorCorrecao(justificativa: string | null): string {
  const j = justificativa?.trim();
  return (
    j
      ? `Revisão corrigida: o item deixou de ser não conforme. ${j}`
      : 'Revisão corrigida: o item deixou de ser não conforme.'
  ).slice(0, 1000);
}
