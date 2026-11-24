// Ordem do painel do dia com encaixes (02-AGE linha 49): no mesmo horário, a marcação da grade vem primeiro e os
// encaixes depois, na ordem de `ordenarEncaixes` (prioridade legal de menor peso antes, depois a ordem em que o
// encaixe entrou). Horários diferentes mantêm a ordem recebida (a do início).
import { ordenarEncaixes } from './prioridade-marcacao.js';

export interface ItemPainelOrdem {
  /** Agenda da marcação: o painel de todas as agendas não mistura horários de agendas diferentes. */
  readonly agenda?: number | null;
  readonly data: string;
  readonly hora: string;
  readonly encaixe: boolean;
  /** Peso do grupo de prioridade legal da marcação (nulo: sem grupo). */
  readonly pesoPrioridade: number | null;
}

export function ordenarPainelComEncaixes<T extends ItemPainelOrdem>(itens: readonly T[]): T[] {
  const grupos = new Map<string, { item: T; ordem: number }[]>();
  itens.forEach((item, ordem) => {
    const k = `${item.agenda ?? ''} ${item.data} ${item.hora}`;
    const g = grupos.get(k);
    if (g) g.push({ item, ordem });
    else grupos.set(k, [{ item, ordem }]);
  });
  const saida: T[] = [];
  for (const g of grupos.values()) {
    for (const x of g) if (!x.item.encaixe) saida.push(x.item);
    const enc = g
      .filter((x) => x.item.encaixe)
      .map((x) => ({ item: x.item, ordem: x.ordem, pesoPrioridade: x.item.pesoPrioridade }));
    for (const x of ordenarEncaixes(enc)) saida.push(x.item);
  }
  return saida;
}
