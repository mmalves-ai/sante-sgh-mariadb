// Antimicrobiano (regra 7 da ficha do M24): o item antimicrobiano exige a ficha (indicação, sítio, empírico ou
// dirigido, cultura colhida e dia de tratamento), registrada só no novo; sem a ficha, o alerta pede o preenchimento.
import type { AlertaGerado, ItemAvaliado } from './tipos.js';

export function alertasAntimicrobiano(item: ItemAvaliado): AlertaGerado[] {
  if (item.fichaAntimicrobiano) return [];
  return item.produtos
    .filter(({ produto }) => produto.antimicrobiano)
    .map(({ produto }) => ({
      id: `antimicrobiano:${produto.produto}`,
      item: item.chave,
      tipo: 'antimicrobiano' as const,
      titulo: 'Antimicrobiano sem ficha',
      detalhe: `${produto.nome}: preencha a indicação, o sítio, se é empírico ou dirigido, se a cultura foi colhida e o dia de tratamento.`,
    }));
}
