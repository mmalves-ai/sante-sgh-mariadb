// O plano da gravação da revisão de um prontuário pela comissão (qualidade.revisarProntuario): a partir das respostas
// já avaliadas pelo checklist, dos itens do checklist (peso e se aceitam "não se aplica") e das pendências que a revisão
// anterior deixou, decide o resultado, o percentual de conformidade e o que acontece com cada pendência. Regra pura (o
// banco só executa o plano):
// - "não se aplica" só vale no item que o aceita; no que não aceita, a revisão é recusada (sem isso o item sairia do
//   denominador e inflaria a conformidade);
// - o resultado é não conforme quando há ao menos um item não conforme;
// - o percentual de conformidade é ponderado pelo peso de cada item aplicável (soma dos pesos conformes ÷ soma dos pesos
//   conformes e não conformes × 100, com quatro casas): o item crítico pesa mais. Item sem peso informado pesa 1. Sem
//   peso aplicável, não há percentual;
// - cada item não conforme sem pendência ganha uma pendência nova ao profissional;
// - o item que continua (ou volta a ser) não conforme reabre a pendência cancelada, resolvida ou justificada do mesmo
//   item (nunca se cria outra: o histórico do item é um só; a resolução anterior fica na trilha, na versão anterior da
//   revisão). Assim a correção da revisão que mantém o item não conforme volta a cobrar o profissional, e o aval (que
//   exige nenhuma pendência aberta) não passa com item não conforme sem cobrança;
// - a pendência aberta de um item que deixou de ser não conforme (correção da revisão) é cancelada com o motivo;
// - pendência nova ou reaberta exige o profissional responsável (o médico assistente da internação): sem ele, a revisão
//   com item não conforme é recusada, porque a pendência não teria a quem ser cobrada.
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
  /** As pendências canceladas, resolvidas ou justificadas que voltam a abrir (o item segue ou voltou a ser não conforme). */
  readonly reabrir: readonly number[];
  /** As pendências abertas cujo item deixou de ser não conforme. */
  readonly cancelar: readonly number[];
  /** As pendências abertas depois da gravação (as que ficam, as novas e as reabertas). */
  readonly abertasDepois: number;
}

export type RecusaPlanoRevisao = 'pendencia-sem-responsavel' | 'nao-aplicavel-nao-aceito';

/** O item do checklist como o plano precisa: o código efetivo, o peso e se aceita "não se aplica". */
export interface ItemPlanoRevisao {
  readonly codigo: string;
  readonly peso: number;
  readonly aceitaNaoAplicavel: boolean;
}

/** O código efetivo do item do checklist: o próprio, ou `item<sequência>` quando o item não tem código. */
export const codigoItemChecklist = (codigo: string | null | undefined, sequencia: number): string =>
  codigo?.trim() ? codigo : `item${sequencia}`;

export function planoRevisaoProntuario(
  respostas: readonly RespostaItemRevisao[],
  existentes: readonly PendenciaExistentePlano[],
  temResponsavel: boolean,
  itens: readonly ItemPlanoRevisao[] = [],
): { ok: true; plano: PlanoRevisaoProntuario } | { ok: false; motivo: RecusaPlanoRevisao } {
  const doItem = new Map(itens.map((i) => [i.codigo, i]));
  if (
    respostas.some((r) => r.resultado === 'naoAplicavel' && doItem.get(r.item)?.aceitaNaoAplicavel === false)
  )
    return { ok: false, motivo: 'nao-aplicavel-nao-aceito' };
  const peso = (item: string): number => {
    const p = doItem.get(item)?.peso;
    return p === undefined || !Number.isFinite(p) || p < 0 ? 1 : p;
  };
  const naoConformes = new Set(respostas.filter((r) => r.resultado === 'naoConforme').map((r) => r.item));
  const pesoConforme = respostas
    .filter((r) => r.resultado === 'conforme')
    .reduce((a, r) => a + peso(r.item), 0);
  const pesoAplicavel = pesoConforme + [...naoConformes].reduce((a, i) => a + peso(i), 0);
  const porItem = new Map(existentes.map((p) => [p.item, p]));
  const criar = [...naoConformes].filter((i) => !porItem.has(i));
  const reabrir = existentes
    .filter((p) => p.situacao !== 'aberta' && naoConformes.has(p.item))
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
      percentual:
        pesoAplicavel === 0 ? null : Math.round((pesoConforme / pesoAplicavel) * 1_000_000) / 10_000,
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
