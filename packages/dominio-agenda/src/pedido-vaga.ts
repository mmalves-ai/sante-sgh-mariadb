// 02-AGE linha 53: pedido de marcação que nasce do médico (no prontuário) ou da regulação e aguarda vaga na lista de
// espera, com os procedimentos pedidos. Regra pura: quem pede (o profissional ou o pedido da central, nunca nenhum),
// o alvo da fila (especialidade, agenda ou o primeiro item agendável), os itens (um alvo cada, sem repetir, quantidade
// inteira de 1 a 99, no máximo 20) e o prazo limite, que não pode ficar no passado. A gravação usa o resultado
// (`itemPrincipal`) para preencher o alvo da fila quando o médico só pediu procedimentos.

export const MAXIMO_ITENS_PEDIDO_VAGA = 20;
export const MAXIMO_QUANTIDADE_ITEM_PEDIDO_VAGA = 99;

export interface ItemPedidoVaga {
  /** Item da agenda (consulta, exame, procedimento, sessão). */
  readonly itemAgendavel: number | null;
  /** Procedimento faturável, quando não há item agendável correspondente. */
  readonly itemFaturavel: number | null;
  readonly quantidade: number;
}

export interface EntradaPedidoVaga {
  /** Profissional que pediu (o médico no prontuário). */
  readonly solicitante: number | null;
  /** Pedido da central de regulação que originou a espera. */
  readonly regulacao: number | null;
  readonly especialidade: number | null;
  readonly agenda: number | null;
  readonly itens: readonly ItemPedidoVaga[];
  /** AAAA-MM-DD: data até a qual o atendimento tem de acontecer. */
  readonly prazoLimite: string | null;
  /** AAAA-MM-DD: hoje no fuso do estabelecimento. */
  readonly hoje: string;
}

export interface ProblemaPedidoVaga {
  readonly campo: string;
  readonly mensagem: string;
}

export type ResultadoPedidoVaga =
  | { readonly ok: true; readonly itemPrincipal: number | null }
  | { readonly ok: false; readonly problemas: readonly ProblemaPedidoVaga[] };

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export function validarPedidoVaga(e: EntradaPedidoVaga): ResultadoPedidoVaga {
  const problemas: ProblemaPedidoVaga[] = [];
  if (e.solicitante === null && e.regulacao === null)
    problemas.push({
      campo: 'solicitante',
      mensagem: 'O pedido de vaga nasce do profissional que pede ou de um pedido da central de regulação.',
    });
  if (e.itens.length > MAXIMO_ITENS_PEDIDO_VAGA)
    problemas.push({
      campo: 'itens',
      mensagem: `No máximo ${MAXIMO_ITENS_PEDIDO_VAGA} procedimentos por pedido.`,
    });
  const vistos = new Set<string>();
  e.itens.forEach((x, i) => {
    const campo = `itens.${i}`;
    if ((x.itemAgendavel === null) === (x.itemFaturavel === null))
      problemas.push({
        campo,
        mensagem: 'Cada procedimento pedido é um item da agenda ou um procedimento faturável.',
      });
    if (
      !Number.isInteger(x.quantidade) ||
      x.quantidade < 1 ||
      x.quantidade > MAXIMO_QUANTIDADE_ITEM_PEDIDO_VAGA
    )
      problemas.push({
        campo: `${campo}.quantidade`,
        mensagem: `A quantidade é um número inteiro de 1 a ${MAXIMO_QUANTIDADE_ITEM_PEDIDO_VAGA}.`,
      });
    const chave = x.itemAgendavel !== null ? `a${x.itemAgendavel}` : `f${String(x.itemFaturavel)}`;
    if (vistos.has(chave))
      problemas.push({ campo, mensagem: 'O mesmo procedimento aparece duas vezes no pedido.' });
    vistos.add(chave);
  });
  const itemPrincipal = e.itens.find((x) => x.itemAgendavel !== null)?.itemAgendavel ?? null;
  if (e.especialidade === null && e.agenda === null && itemPrincipal === null)
    problemas.push({
      campo: 'especialidade',
      mensagem:
        'Informe a especialidade, a agenda ou ao menos um item da agenda para o pedido entrar na fila.',
    });
  if (e.prazoLimite !== null) {
    if (!DATA.test(e.prazoLimite))
      problemas.push({ campo: 'prazoLimite', mensagem: 'Prazo limite no formato AAAA-MM-DD.' });
    else if (e.prazoLimite < e.hoje)
      problemas.push({ campo: 'prazoLimite', mensagem: 'O prazo limite não pode ficar no passado.' });
  }
  return problemas.length > 0 ? { ok: false, problemas } : { ok: true, itemPrincipal };
}

/** Situação de um item pedido (lista_espera_item). */
export type SituacaoItemPedidoVaga = 'aguardando' | 'marcado' | 'cancelado';

/**
 * O que acontece com os itens ainda aguardando quando a fila encerra o pedido: marcado (o pedido virou marcação) leva
 * cada item a 'marcado' com a marcação; cancelado leva a 'cancelado'; a devolução à fila ('aguardando') não mexe nos
 * itens. Atendido sem marcação no sistema também não mexe: o item marcado exige a marcação, e cancelar diria o
 * contrário do que houve. O item já marcado ou cancelado antes fica como está (histórico nunca reescrito).
 */
export function itensNoEncerramentoDaEspera(
  situacaoEspera: 'atendido' | 'cancelado' | 'aguardando',
  marcacao: number | null,
): {
  readonly situacao: Exclude<SituacaoItemPedidoVaga, 'aguardando'>;
  readonly marcacao: number | null;
} | null {
  if (situacaoEspera === 'cancelado') return { situacao: 'cancelado', marcacao: null };
  if (situacaoEspera === 'atendido' && marcacao !== null) return { situacao: 'marcado', marcacao };
  return null;
}
