// As linhas de itens das telas de saída e de transferência (o item, a quantidade, os lotes do local e o prescritor do
// controlado) e a forma da entrada da operação.
import type { LoteSaldo } from '@sgh/contratos';
import { numero } from '../usar-suprimentos.js';

export interface LinhaItem {
  item: number;
  nome: string;
  rastreavel: boolean;
  controlado: boolean;
  quantidade: string;
  disponiveis: LoteSaldo[];
  lotes: Record<number, string>;
  prescritor: string;
}

/** As linhas na forma da entrada da operação (itens com os lotes escolhidos e o prescritor do controlado). */
export function itensDaEntrada(ls: readonly LinhaItem[]) {
  return ls.map((l) => ({
    item: l.item,
    quantidade: numero(l.quantidade),
    lotes: l.disponiveis
      .filter((d) => numero(l.lotes[d.id] ?? '') > 0)
      .map((d) => ({ lote: d.lote, validade: d.validade, quantidade: numero(l.lotes[d.id] ?? '') })),
    ...(l.controlado && numero(l.prescritor) > 0 ? { prescritorControlado: numero(l.prescritor) } : {}),
  }));
}
