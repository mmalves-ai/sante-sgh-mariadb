// Regra 4 do M33: base explícita por regra. Cobrado: o valor cobrado do item. Recebido: pago + recurso deferido, e só
// depois da conciliação do item (antes, o item fica pendente). Misto: antes da conciliação vale o cobrado; depois, o
// recebido (a diferença vira ajuste no período seguinte pelo estorno). A regra sem base usa o parâmetro
// repasse.basePadrao.
import type { BaseCalculoRepasse, PendenciaApuracao } from '@sgh/contratos';
import { centavos } from './dinheiro.js';
import type { ItemProducao } from './regra.js';

export interface BaseApurada {
  readonly base: BaseCalculoRepasse;
  /** Qual valor do item entrou (para a memória de cálculo). */
  readonly origem: 'cobrado' | 'recebido';
  readonly centavos: number;
}

export type ResultadoBase =
  | { readonly ok: true; readonly valor: BaseApurada }
  | { readonly ok: false; readonly pendencia: PendenciaApuracao };

type ValoresItem = Pick<ItemProducao, 'cobrado' | 'pago' | 'recursoDeferido' | 'conciliado'>;

export function baseDoItem(
  item: ValoresItem,
  base: BaseCalculoRepasse | null,
  padrao: BaseCalculoRepasse,
): ResultadoBase {
  const b = base ?? padrao;
  const recebido = centavos(item.pago) + centavos(item.recursoDeferido);
  if (b === 'cobrado')
    return { ok: true, valor: { base: b, origem: 'cobrado', centavos: centavos(item.cobrado) } };
  if (b === 'recebido') {
    if (!item.conciliado) return { ok: false, pendencia: 'nao-conciliado' };
    return { ok: true, valor: { base: b, origem: 'recebido', centavos: recebido } };
  }
  return item.conciliado
    ? { ok: true, valor: { base: b, origem: 'recebido', centavos: recebido } }
    : { ok: true, valor: { base: b, origem: 'cobrado', centavos: centavos(item.cobrado) } };
}
