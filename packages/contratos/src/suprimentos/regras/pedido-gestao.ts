// Gestão do pedido de compra depois de emitido (F3.6, 05-SUP linha 20): entregas programadas por item, acompanhamento
// do fornecedor e cancelamento justificado do pedido ou do item. Regras puras: a API confere antes de gravar e a tela
// confere na hora, com as mesmas mensagens e os mesmos campos. Nada se apaga: o cancelamento marca quantidade, data e
// motivo, e a entrega que já recebeu algo fica como está.
import { qtd3, recusa, type RecusaSuprimentos } from './recusa.js';

export const SITUACOES_ACOMPANHAMENTO_PEDIDO = [
  'em_dia',
  'atrasado',
  'pendente_fornecedor',
  'pendente_interno',
  'resolvido',
] as const;
export type SituacaoAcompanhamentoPedido = (typeof SITUACOES_ACOMPANHAMENTO_PEDIDO)[number];

/** Situações do pedido em que nada mais chega nem se cancela. */
export const SITUACOES_PEDIDO_FECHADAS = ['cancelado', 'reprovado', 'recebido', 'encerrado'] as const;

const fechado = (s: string) => (SITUACOES_PEDIDO_FECHADAS as readonly string[]).includes(s);

export interface EntregaProgramadaNova {
  readonly dataPrevista: string;
  readonly dataLimite: string | null;
  readonly quantidade: number;
}

export interface ProgramacaoEntregasConferida {
  readonly situacaoPedido: string;
  readonly dataPedido: string;
  /** Quantidade pedida do item menos a cancelada. */
  readonly quantidadeValida: number;
  /** O que já está preso a entregas que receberam algo (ficam como estão). */
  readonly quantidadeFixa: number;
  readonly entregas: readonly EntregaProgramadaNova[];
}

/** Confere a programação das entregas de um item: datas em ordem, sem repetir o dia, sem passar do pedido. */
export function conferirEntregasProgramadas(p: ProgramacaoEntregasConferida): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (fechado(p.situacaoPedido))
    return [recusa('pedido-encerrado', 'O pedido está encerrado: não há entrega a programar.', ['pedido'])];
  if (!p.entregas.length) return [recusa('sem-entrega', 'Informe ao menos uma entrega.', ['entregas'])];
  const dias = new Set<string>();
  p.entregas.forEach((e, i) => {
    if (!(e.quantidade > 0))
      r.push(
        recusa('quantidade-invalida', `A entrega ${i + 1} precisa de quantidade.`, [
          `entregas.${i}.quantidade`,
        ]),
      );
    if (e.dataPrevista < p.dataPedido)
      r.push(
        recusa('entrega-antes-do-pedido', `A entrega ${i + 1} está antes da data do pedido.`, [
          `entregas.${i}.dataPrevista`,
        ]),
      );
    if (e.dataLimite !== null && e.dataLimite < e.dataPrevista)
      r.push(
        recusa('limite-antes-da-previsao', `O limite da entrega ${i + 1} está antes da data prevista.`, [
          `entregas.${i}.dataLimite`,
        ]),
      );
    if (dias.has(e.dataPrevista))
      r.push(
        recusa('entrega-repetida', `A entrega ${i + 1} repete o dia de outra: some as quantidades.`, [
          `entregas.${i}.dataPrevista`,
        ]),
      );
    dias.add(e.dataPrevista);
  });
  const soma = qtd3(p.entregas.reduce((s, e) => s + e.quantidade, 0));
  const livre = qtd3(p.quantidadeValida - p.quantidadeFixa);
  if (soma > livre)
    r.push(
      recusa('entrega-acima-do-pedido', `As entregas somam ${soma}, mas o item tem ${livre} a programar.`, [
        'entregas',
      ]),
    );
  return r;
}

export interface MotivoCancelamentoConferido {
  readonly ativo: boolean;
  readonly aplicaPedido: boolean;
  readonly aplicaItem: boolean;
  readonly exigeJustificativa: boolean;
}

export interface ItemPedidoConferido {
  readonly id: number;
  readonly quantidade: number;
  readonly recebida: number;
  readonly cancelada: number;
}

/** O que falta chegar do item. */
export const pendenteItem = (i: ItemPedidoConferido): number =>
  Math.max(0, qtd3(i.quantidade - i.recebida - i.cancelada));

export interface CancelamentoCompraConferido {
  readonly situacaoPedido: string;
  /** Nulo: o pedido inteiro (tudo o que falta chegar). */
  readonly item: number | null;
  /** Nulo: todo o pendente do item. */
  readonly quantidade: number | null;
  readonly motivo: MotivoCancelamentoConferido | null;
  readonly justificativa: string | null;
  readonly itens: readonly ItemPedidoConferido[];
}

/** Confere o cancelamento do pedido ou do item e devolve as quantidades a cancelar por item. */
export function conferirCancelamentoCompra(c: CancelamentoCompraConferido): {
  readonly recusas: RecusaSuprimentos[];
  readonly cancelar: ReadonlyArray<{ readonly item: number; readonly quantidade: number }>;
} {
  const r: RecusaSuprimentos[] = [];
  const nada = { recusas: r, cancelar: [] };
  if (fechado(c.situacaoPedido)) {
    r.push(recusa('pedido-encerrado', 'O pedido já está encerrado ou cancelado.', ['pedido']));
    return nada;
  }
  const alvo = c.item === null ? 'pedido' : 'item';
  if (!c.motivo || !c.motivo.ativo) r.push(recusa('motivo-invalido', 'Escolha um motivo ativo.', ['motivo']));
  else if (alvo === 'pedido' ? !c.motivo.aplicaPedido : !c.motivo.aplicaItem)
    r.push(
      recusa(
        'motivo-nao-se-aplica',
        alvo === 'pedido'
          ? 'Este motivo não vale para o pedido inteiro.'
          : 'Este motivo não vale para o item.',
        ['motivo'],
      ),
    );
  const just = (c.justificativa ?? '').trim();
  if (c.motivo?.exigeJustificativa && just.length < 10)
    r.push(
      recusa('justificativa-obrigatoria', 'Este motivo exige justificativa (ao menos 10 letras).', [
        'justificativa',
      ]),
    );
  let cancelar: { item: number; quantidade: number }[] = [];
  if (alvo === 'pedido') {
    cancelar = c.itens
      .map((i) => ({ item: i.id, quantidade: pendenteItem(i) }))
      .filter((x) => x.quantidade > 0);
    if (!cancelar.length)
      r.push(recusa('pedido-sem-saldo', 'Nada mais falta chegar neste pedido.', ['pedido']));
  } else {
    const i = c.itens.find((x) => x.id === c.item);
    if (!i) r.push(recusa('item-inexistente', 'O item não é deste pedido.', ['item']));
    else {
      const pend = pendenteItem(i);
      const q = c.quantidade === null ? pend : qtd3(c.quantidade);
      if (pend <= 0) r.push(recusa('item-sem-saldo', 'Nada mais falta chegar deste item.', ['item']));
      else if (!(q > 0) || q > pend)
        r.push(recusa('quantidade-invalida', `Cancele de 0 a ${pend} (o que falta chegar).`, ['quantidade']));
      else cancelar = [{ item: i.id, quantidade: q }];
    }
  }
  return { recusas: r, cancelar: r.length ? [] : cancelar };
}

/** A situação do pedido depois do cancelamento: sem nada a chegar, cancelado (nada veio) ou encerrado (algo veio). */
export function situacaoAposCancelamento(atual: string, itens: readonly ItemPedidoConferido[]): string {
  if (itens.some((i) => pendenteItem(i) > 0)) return atual;
  return itens.some((i) => i.recebida > 0) ? 'encerrado' : 'cancelado';
}

export interface EntregaAberta {
  readonly id: number;
  readonly dataPrevista: string;
  readonly quantidade: number;
  readonly recebida: number;
  readonly cancelada: number;
}

const abertoEntrega = (e: EntregaAberta) => Math.max(0, qtd3(e.quantidade - e.recebida - e.cancelada));

/**
 * Reparte uma quantidade entre as entregas em aberto: o recebimento abate da mais antiga para a mais nova; o
 * cancelamento, da mais nova para a mais antiga (o que estava mais longe de chegar sai primeiro).
 */
export function repartirEntregas(
  entregas: readonly EntregaAberta[],
  quantidade: number,
  sentido: 'recebimento' | 'cancelamento',
): Array<{ readonly id: number; readonly quantidade: number }> {
  const ordem = [...entregas].sort((a, b) =>
    sentido === 'recebimento'
      ? a.dataPrevista.localeCompare(b.dataPrevista)
      : b.dataPrevista.localeCompare(a.dataPrevista),
  );
  const r: Array<{ id: number; quantidade: number }> = [];
  let resta = qtd3(quantidade);
  for (const e of ordem) {
    if (resta <= 0) break;
    const q = Math.min(resta, abertoEntrega(e));
    if (q > 0) {
      r.push({ id: e.id, quantidade: qtd3(q) });
      resta = qtd3(resta - q);
    }
  }
  return r;
}

/** A entrega atrasou: passou o limite (ou o dia previsto, sem limite) e ainda falta algo. */
export const entregaAtrasada = (
  e: EntregaAberta & { readonly dataLimite: string | null },
  hoje: string,
): boolean => abertoEntrega(e) > 0 && (e.dataLimite ?? e.dataPrevista) < hoje;

export interface AcompanhamentoConferido {
  readonly situacaoPedido: string;
  readonly dataPedido: string;
  readonly previsaoEntrega: string | null;
  readonly andamento: string;
}

/** Confere o registro de contato com o fornecedor. */
export function conferirAcompanhamentoPedido(a: AcompanhamentoConferido): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (['cancelado', 'reprovado'].includes(a.situacaoPedido))
    r.push(recusa('pedido-encerrado', 'O pedido está cancelado: não há o que acompanhar.', ['pedido']));
  if (a.andamento.trim().length < 3)
    r.push(recusa('andamento-obrigatorio', 'Conte o que foi tratado.', ['andamento']));
  if (a.previsaoEntrega !== null && a.previsaoEntrega < a.dataPedido)
    r.push(
      recusa('previsao-antes-do-pedido', 'A previsão está antes da data do pedido.', ['previsaoEntrega']),
    );
  return r;
}
