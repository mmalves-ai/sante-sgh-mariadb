// Via × forma (regra 7 da ficha do M24): a via escolhida tem de estar entre as vias do cadastro do item; cadastro sem
// via não restringe.
import type { AlertaGerado, ItemAvaliado } from './tipos.js';

export function alertasViaForma(item: ItemAvaliado): AlertaGerado[] {
  if (!item.via) return [];
  const via = item.via.trim().toUpperCase();
  const r: AlertaGerado[] = [];
  for (const { produto } of item.produtos) {
    const vias = produto.viasPermitidas.map((v) => v.trim().toUpperCase());
    if (vias.length === 0 || vias.includes(via)) continue;
    r.push({
      id: `via-forma:${produto.produto}:${via}`,
      item: item.chave,
      tipo: 'via-forma',
      titulo: 'Via não aceita para o item',
      detalhe: `${produto.nome} não é administrado pela via ${via} (vias do cadastro: ${vias.join(', ')}).`,
    });
  }
  return r;
}
