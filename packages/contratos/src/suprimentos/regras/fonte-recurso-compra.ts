// C2-017 (09-AREA linha 81): a fonte de recurso da solicitação de compra pública. Lei 14.133/2021, art. 72, IV, e
// art. 150: nenhuma contratação sem a indicação dos créditos orçamentários; Lei 4.320/1964, art. 60. Cada item da
// solicitação diz qual fonte (origem do recurso) custeia quanto dele, por quantidade ou por percentual, nunca os dois no
// mesmo item; a soma fecha o item inteiro (100% ou a quantidade solicitada). A fonte principal da solicitação é a que
// custeia o maior valor estimado (na falta de valor, a maior quantidade); no empate, a primeira informada.
import { qtd4 } from './ata-empenho.js';
import { type RecusaSuprimentos, recusa } from './recusa.js';

export interface ParcelaFonteRecurso {
  readonly origem: number;
  readonly quantidade: number | null;
  readonly percentual: number | null;
}

export interface ItemComFonte {
  readonly quantidadeSolicitada: number;
  readonly valorUnitarioEstimado: number | null;
  readonly fontes: readonly ParcelaFonteRecurso[];
}

/** A parte do item (de 0 a 1) custeada pela parcela. */
export function fracaoDaParcela(item: ItemComFonte, p: ParcelaFonteRecurso): number {
  if (p.percentual !== null) return p.percentual / 100;
  if (p.quantidade !== null && item.quantidadeSolicitada > 0) return p.quantidade / item.quantidadeSolicitada;
  return 0;
}

/** Confere as fontes de cada item; `origensAtivas` são as origens de recurso ativas no cadastro. */
export function conferirFontesSolicitacao(
  itens: readonly ItemComFonte[],
  origensAtivas: ReadonlySet<number>,
): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (itens.length === 0) r.push(recusa('solicitacao-sem-item', 'Informe ao menos um item.', ['itens']));
  itens.forEach((item, i) => {
    const campo = `itens.${i}.fontes`;
    if (item.fontes.length === 0) {
      r.push(
        recusa(
          'item-sem-fonte',
          `Informe a fonte de recurso do item ${i + 1} (Lei 14.133, art. 150: crédito orçamentário indicado).`,
          [campo],
        ),
      );
      return;
    }
    const vistas = new Set<number>();
    for (const p of item.fontes) {
      if (vistas.has(p.origem))
        r.push(recusa('fonte-repetida', `A mesma fonte aparece duas vezes no item ${i + 1}.`, [campo]));
      vistas.add(p.origem);
      if (!origensAtivas.has(p.origem))
        r.push(
          recusa('fonte-inativa', `A fonte de recurso do item ${i + 1} não está ativa no cadastro.`, [campo]),
        );
      if ((p.quantidade === null) === (p.percentual === null))
        r.push(
          recusa('fonte-parcela-invalida', `Cada fonte do item ${i + 1} leva a quantidade ou o percentual.`, [
            campo,
          ]),
        );
    }
    const porPercentual = item.fontes.some((p) => p.percentual !== null);
    const porQuantidade = item.fontes.some((p) => p.quantidade !== null);
    if (porPercentual && porQuantidade) {
      r.push(
        recusa(
          'fonte-criterio-misto',
          `No item ${i + 1}, as fontes vão todas por quantidade ou todas por percentual.`,
          [campo],
        ),
      );
      return;
    }
    if (porPercentual) {
      const soma = qtd4(item.fontes.reduce((s, p) => s + (p.percentual ?? 0), 0));
      if (soma !== 100)
        r.push(
          recusa(
            'fonte-soma-percentual',
            `As fontes do item ${i + 1} somam ${soma}%: a soma tem de ser 100%.`,
            [campo],
          ),
        );
    } else if (porQuantidade) {
      const soma = qtd4(item.fontes.reduce((s, p) => s + (p.quantidade ?? 0), 0));
      if (soma !== qtd4(item.quantidadeSolicitada))
        r.push(
          recusa(
            'fonte-soma-quantidade',
            `As fontes do item ${i + 1} somam ${soma}: a soma tem de ser a quantidade solicitada (${qtd4(item.quantidadeSolicitada)}).`,
            [campo],
          ),
        );
    }
  });
  return r;
}

/** A fonte principal: a que custeia o maior valor estimado (sem valor, a maior quantidade); empate, a primeira. */
export function fontePrincipal(itens: readonly ItemComFonte[]): number | null {
  const comValor = itens.some((i) => (i.valorUnitarioEstimado ?? 0) > 0);
  const peso = new Map<number, number>();
  const ordem: number[] = [];
  for (const item of itens) {
    const base = item.quantidadeSolicitada * (comValor ? (item.valorUnitarioEstimado ?? 0) : 1);
    for (const p of item.fontes) {
      if (!peso.has(p.origem)) ordem.push(p.origem);
      peso.set(p.origem, (peso.get(p.origem) ?? 0) + base * fracaoDaParcela(item, p));
    }
  }
  let melhor: number | null = null;
  for (const o of ordem) if (melhor === null || (peso.get(o) ?? 0) > (peso.get(melhor) ?? 0)) melhor = o;
  return melhor;
}
