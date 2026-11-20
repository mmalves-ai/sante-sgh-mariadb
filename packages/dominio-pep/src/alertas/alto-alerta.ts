// Alta vigilância (regra 7 da ficha do M24): item marcado potencialmente perigoso no cadastro ou na lista do hospital
// (lista ISMP; parâmetro do novo): aviso ao prescritor e marca para a dupla checagem na administração (M25).
import type { AlertaGerado, ContextoAlertas, ItemAvaliado } from './tipos.js';

export function ehAltaVigilancia(
  produto: number,
  cadastro: boolean,
  ctx: Pick<ContextoAlertas, 'altaVigilancia'>,
) {
  return cadastro || ctx.altaVigilancia.has(produto);
}

export function alertasAltoAlerta(item: ItemAvaliado, ctx: ContextoAlertas): AlertaGerado[] {
  return item.produtos
    .filter(({ produto }) => ehAltaVigilancia(produto.produto, produto.altoAlerta, ctx))
    .map(({ produto }) => ({
      id: `alto-alerta:${produto.produto}`,
      item: item.chave,
      tipo: 'alto-alerta' as const,
      titulo: 'Medicamento de alta vigilância',
      detalhe: `${produto.nome} é de alta vigilância: confira dose, via e velocidade; a administração pede dupla checagem.`,
    }));
}
