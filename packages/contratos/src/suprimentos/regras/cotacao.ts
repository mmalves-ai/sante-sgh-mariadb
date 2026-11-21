// Pedido e cotação (ficha do M28, regra 11; ref 01 §2.5 e §3.12): por item, a linha mestre tem `FORN=0` e cada
// proposta de fornecedor é uma linha `FORN>0`. O vencedor é marcado nominalmente: `VENCEDOR='T'` na escolhida e `'F'` em
// cada uma das outras, uma a uma (nunca "todas menos esta"); nunca na linha mestre. `VENCEDOR` vazio é legítimo (não é
// falso) e o rateio com mais de um vencedor por item também. `COMPRADA` independe de `VENCEDOR`.
import { recusa, reais, type RecusaSuprimentos } from './recusa.js';

export interface PropostaCotacao {
  /** O id do item da proposta. */
  readonly id: number;
  readonly item: number;
  readonly seq: number;
  readonly fornecedor: number;
  readonly valorUnitario: number;
  readonly quantidade: number;
  /** 'T', 'F' ou '' (vazio é legítimo). */
  readonly vencedor: string;
}

export interface MarcaVencedor {
  readonly id: number;
  readonly vencedor: 'T' | 'F';
}

/** A linha mestre nunca recebe vencedor (o gatilho dela propaga e apaga as propostas). */
export const ehMestre = (p: { fornecedor: number }): boolean => p.fornecedor === 0;

/**
 * As marcas nominais do vencedor de um item (rateio: mais de uma escolhida). Só muda o que precisa mudar: a escolhida
 * que já é 'T' e a outra que já é 'F' ficam como estão; a vazia que não foi escolhida vai a 'F' (a escolha é explícita).
 */
export function planejarVencedor(
  propostas: readonly PropostaCotacao[],
  item: { item: number; seq: number },
  escolhidas: readonly number[],
): { marcas: MarcaVencedor[]; recusas: RecusaSuprimentos[] } {
  const doItem = propostas.filter((p) => p.item === item.item && p.seq === item.seq);
  const recusas: RecusaSuprimentos[] = [];
  if (escolhidas.length === 0)
    recusas.push(recusa('sem-vencedor', 'Escolha ao menos uma proposta vencedora.'));
  for (const id of escolhidas) {
    const p = doItem.find((x) => x.id === id);
    if (!p) recusas.push(recusa('proposta-de-outro-item', 'A proposta escolhida não é deste item.'));
    else if (ehMestre(p))
      recusas.push(recusa('linha-mestre', 'A linha do pedido não é proposta de fornecedor.'));
  }
  if (recusas.length) return { marcas: [], recusas };
  const marcas: MarcaVencedor[] = [];
  for (const p of doItem.filter((x) => !ehMestre(x)).sort((a, b) => a.id - b.id)) {
    const quer: 'T' | 'F' = escolhidas.includes(p.id) ? 'T' : 'F';
    if (p.vencedor !== quer) marcas.push({ id: p.id, vencedor: quer });
  }
  return { marcas, recusas };
}

/** Os vencedores de um item (rateio legítimo); vazio não é vencedor nem perdedor. */
export function vencedoresDoItem(
  propostas: readonly PropostaCotacao[],
  item: number,
  seq: number,
): PropostaCotacao[] {
  return propostas.filter((p) => p.item === item && p.seq === seq && !ehMestre(p) && p.vencedor === 'T');
}

/** A menor proposta do item (sugestão do mapa; a escolha é de quem decide, com justificativa se não for a menor). */
export function menorProposta(
  propostas: readonly PropostaCotacao[],
  item: number,
  seq: number,
): PropostaCotacao | null {
  const ps = propostas.filter((p) => p.item === item && p.seq === seq && !ehMestre(p) && p.valorUnitario > 0);
  return ps.length
    ? ps.reduce((a, b) =>
        b.valorUnitario < a.valorUnitario || (b.valorUnitario === a.valorUnitario && b.id < a.id) ? b : a,
      )
    : null;
}

/** A escolha que não é a menor exige justificativa (registro de quem escolheu, que o outro sistema não guarda). */
export function exigeJustificativa(
  propostas: readonly PropostaCotacao[],
  item: number,
  seq: number,
  escolhidas: readonly number[],
): boolean {
  const m = menorProposta(propostas, item, seq);
  return m !== null && !escolhidas.includes(m.id);
}

/** Valor do pedido pelas propostas vencedoras (as parcelas: quantidade × unitário de cada vencedora). */
export function valorPelosVencedores(propostas: readonly PropostaCotacao[]): {
  total: number;
  parcelas: number[];
} {
  const parcelas = propostas
    .filter((p) => !ehMestre(p) && p.vencedor === 'T')
    .map((p) => reais(p.quantidade * p.valorUnitario));
  return { total: reais(parcelas.reduce((s, v) => s + v, 0)), parcelas };
}

/** Itens do pedido novo: item e quantidade positivos, sem item repetido. */
export function conferirItensPedido(
  itens: readonly { item: number; quantidade: number }[],
): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (itens.length === 0) r.push(recusa('pedido-sem-itens', 'Inclua ao menos um item no pedido.', ['itens']));
  const vistos = new Set<number>();
  for (const i of itens) {
    if (!(i.quantidade > 0))
      r.push(recusa('quantidade-invalida', 'A quantidade tem de ser maior que zero.', ['itens']));
    if (vistos.has(i.item))
      r.push(recusa('item-repetido', 'O mesmo item aparece duas vezes no pedido.', ['itens']));
    vistos.add(i.item);
  }
  return r;
}
