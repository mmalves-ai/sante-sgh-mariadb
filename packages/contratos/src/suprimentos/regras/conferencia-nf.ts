// Conferência da nota fiscal (ficha do M28, regra 12): a nota é conferida contra o pedido (quantidade, preço e prazo)
// com as tolerâncias do parâmetro; fora da tolerância, só consolida com a aprovação do comprador registrada. A
// quantidade comprada e o estado P/I/C do item do pedido sobem pelo gatilho da nota consolidada (o novo só mostra a
// previsão). O fator converte a unidade de compra na de estoque.
import { qtd3, recusa, reais, type RecusaSuprimentos } from './recusa.js';

export interface Tolerancias {
  /** Percentuais (ex.: 5 = 5%). */
  readonly quantidadePct: number;
  readonly precoPct: number;
  readonly prazoDias: number;
}

export interface ItemNota {
  readonly item: number;
  readonly quantidade: number;
  readonly valorUnitario: number;
  /** Fator da unidade de compra (0 ou 1: a mesma unidade). */
  readonly fator: number;
}

export interface ItemPedido {
  readonly item: number;
  readonly quantidade: number;
  readonly comprada: number;
  readonly valorUnitario: number;
  /** AAAA-MM-DD ou null. */
  readonly entrega: string | null;
}

export type Divergencia = 'quantidade' | 'preco' | 'prazo' | 'item-fora-do-pedido';

export interface ConferenciaItem {
  readonly item: number;
  readonly divergencias: readonly Divergencia[];
  readonly detalhe: string;
}

/** Quantidade na unidade de estoque (a de compra × fator). */
export const quantidadeEstoque = (i: Pick<ItemNota, 'quantidade' | 'fator'>): number =>
  qtd3(i.quantidade * (i.fator > 0 ? i.fator : 1));

export function conferirNota(
  itens: readonly ItemNota[],
  pedido: readonly ItemPedido[] | null,
  t: Tolerancias,
  recebidaEm: string,
): { itens: ConferenciaItem[]; dentro: boolean } {
  if (!pedido)
    return {
      itens: itens.map((i) => ({ item: i.item, divergencias: [], detalhe: 'sem pedido' })),
      dentro: true,
    };
  const r = itens.map((i): ConferenciaItem => {
    const p = pedido.find((x) => x.item === i.item);
    if (!p) return { item: i.item, divergencias: ['item-fora-do-pedido'], detalhe: 'item fora do pedido' };
    const d: Divergencia[] = [];
    const saldo = qtd3(p.quantidade - p.comprada);
    if (i.quantidade > saldo * (1 + t.quantidadePct / 100) + 1e-9) d.push('quantidade');
    if (p.valorUnitario > 0 && i.valorUnitario > p.valorUnitario * (1 + t.precoPct / 100) + 1e-9)
      d.push('preco');
    if (p.entrega && diasEntre(p.entrega, recebidaEm) > t.prazoDias) d.push('prazo');
    return {
      item: i.item,
      divergencias: d,
      detalhe: `pedido ${saldo} a ${p.valorUnitario}; nota ${i.quantidade} a ${i.valorUnitario}`,
    };
  });
  return { itens: r, dentro: r.every((x) => x.divergencias.length === 0) };
}

/** Regra 12: dentro da tolerância consolida; fora, só com a aprovação do comprador registrada. */
export function podeConsolidarNota(
  c: { dentro: boolean },
  aprovacao: { aprovador: string; motivo: string } | null,
): RecusaSuprimentos | null {
  if (c.dentro) return null;
  if (!aprovacao || !aprovacao.aprovador || aprovacao.motivo.trim().length < 10)
    return recusa(
      'fora-da-tolerancia',
      'A nota está fora da tolerância do pedido: só entra com a aprovação do comprador e o motivo.',
      ['conferencia'],
    );
  return null;
}

/** Previsão do estado do item do pedido depois da nota (o gatilho faz): C completo, I incompleto. */
export function estadoPrevistoDoPedido(
  p: ItemPedido,
  recebida: number,
): { comprada: number; estado: 'C' | 'I' } {
  return {
    comprada: qtd3(p.comprada + recebida),
    estado: qtd3(p.quantidade - p.comprada) <= qtd3(recebida) ? 'C' : 'I',
  };
}

/** Total da nota com as parcelas (quantidade × unitário de cada item, menos o desconto). */
export function totalDaNota(itens: readonly ItemNota[], desconto = 0): { total: number; parcelas: number[] } {
  const parcelas = itens.map((i) => reais(i.quantidade * i.valorUnitario));
  return { total: reais(parcelas.reduce((s, v) => s + v, 0) - desconto), parcelas };
}

function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
}

/** Cabeçalho da nota: fornecedor, número, série e emissão; a emissão não pode ser futura. */
export function conferirCabecalhoNota(
  n: { fornecedor: number; numero: number; serie: string; emissao: string },
  hoje: string,
): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (!(n.fornecedor > 0)) r.push(recusa('sem-fornecedor', 'Escolha o fornecedor da nota.', ['fornecedor']));
  if (!(n.numero > 0)) r.push(recusa('sem-numero', 'Informe o número da nota.', ['numero']));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(n.emissao))
    r.push(recusa('sem-emissao', 'Informe a emissão da nota.', ['emissao']));
  else if (n.emissao > hoje)
    r.push(recusa('emissao-futura', 'A emissão da nota não pode ser futura.', ['emissao']));
  return r;
}
