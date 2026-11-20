// Cobertura do convênio (regra 7 da ficha do M24): item que o convênio do atendimento não cobre gera aviso (a conta
// continua pela saída de estoque; DP-34). Sem informação de cobertura, nenhum alerta.
import type { AlertaGerado, ContextoAlertas, ItemAvaliado } from './tipos.js';

export function alertasCobertura(item: ItemAvaliado, ctx: ContextoAlertas): AlertaGerado[] {
  const c = ctx.cobertura;
  if (!c) return [];
  return item.produtos
    .filter(({ produto }) => c.get(produto.produto) === false)
    .map(({ produto }) => ({
      id: `cobertura:${produto.produto}`,
      item: item.chave,
      tipo: 'cobertura' as const,
      titulo: 'Item sem cobertura do convênio',
      detalhe: `${produto.nome} não é coberto pelo convênio do atendimento; avalie a alternativa padronizada.`,
    }));
}
