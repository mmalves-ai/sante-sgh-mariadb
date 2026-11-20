// Parecer e interconsulta (ficha do M23, regra 10; cap-05b §5.6; cap-11 §11.1): a solicitação e a resposta continuam
// nos modelos de registro clínico (pedido e resposta de parecer, que o outro sistema mostra); a fila, a prioridade, o
// prazo e a situação ficam no novo. Aceitar cria vínculo assistencial (quem aceita passa a atender o paciente). O
// histórico do legado (pedidos, respostas e encaminhamentos) aparece na linha do tempo sem entrar na fila; o pedido
// feito no outro sistema entra na fila pela leitura incremental dos registros.
import type { PrioridadeParecer, SituacaoParecer } from '@sgh/contratos';

/** Prazo padrão de resposta por prioridade, em horas (DP de processo: confirmar com a diretoria clínica). */
export const PRAZO_PADRAO_HORAS: Readonly<Record<PrioridadeParecer, number>> = {
  urgente: 2,
  prioritario: 12,
  rotina: 48,
};

export type AcaoParecer = 'aceitar' | 'responder' | 'cancelar';

const TRANSICOES: Readonly<Record<SituacaoParecer, Partial<Record<AcaoParecer, SituacaoParecer>>>> = {
  solicitado: { aceitar: 'aceito', responder: 'respondido', cancelar: 'cancelado' },
  aceito: { responder: 'respondido', cancelar: 'cancelado' },
  respondido: {},
  cancelado: {},
};

export interface TransicaoParecer {
  readonly ok: boolean;
  readonly situacao: SituacaoParecer;
  readonly motivo: string | null;
}

/** A máquina de situação do parecer: só as transições válidas; o resto é recusado com o motivo. */
export function transicaoParecer(atual: SituacaoParecer, acao: AcaoParecer): TransicaoParecer {
  const nova = TRANSICOES[atual][acao];
  if (!nova)
    return {
      ok: false,
      situacao: atual,
      motivo:
        atual === 'respondido'
          ? 'O parecer já foi respondido.'
          : atual === 'cancelado'
            ? 'O parecer foi cancelado.'
            : `Não é possível ${acao} um parecer ${atual}.`,
    };
  return { ok: true, situacao: nova, motivo: null };
}

/** Prazo do parecer: o pedido + horas (as informadas ou o padrão da prioridade). */
export function prazoDoParecer(pedidoEm: Date, prioridade: PrioridadeParecer, horas?: number): Date {
  return new Date(pedidoEm.getTime() + (horas ?? PRAZO_PADRAO_HORAS[prioridade]) * 3_600_000);
}

/** Atrasado: ainda pendente (solicitado ou aceito) depois do prazo. */
export function parecerAtrasado(situacao: SituacaoParecer, prazo: Date | null, agora: Date): boolean {
  return (situacao === 'solicitado' || situacao === 'aceito') && prazo !== null && agora > prazo;
}

/** Ordem da fila: urgente primeiro, depois prioritário e rotina; dentro de cada, o prazo mais próximo. */
export function ordenarFila<
  T extends { prioridade: PrioridadeParecer; prazo: string | null; pedidoEm: string },
>(itens: readonly T[]): T[] {
  const peso: Record<PrioridadeParecer, number> = { urgente: 0, prioritario: 1, rotina: 2 };
  return [...itens].sort(
    (a, b) =>
      peso[a.prioridade] - peso[b.prioridade] ||
      (a.prazo ?? '9999').localeCompare(b.prazo ?? '9999') ||
      a.pedidoEm.localeCompare(b.pedidoEm),
  );
}

/** Quem pode responder: a especialidade pedida (pelo CBO do profissional) ou a categoria pedida. */
export function podeResponder(
  pedido: { readonly especialidade: number | null; readonly categoria: string | null },
  profissional: { readonly especialidades: readonly number[]; readonly categoria: string | null },
): boolean {
  if (pedido.especialidade !== null) return profissional.especialidades.includes(pedido.especialidade);
  if (pedido.categoria !== null) return profissional.categoria === pedido.categoria;
  return false;
}
