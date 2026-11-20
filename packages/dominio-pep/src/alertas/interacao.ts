// Interação medicamentosa (regra 8 da ficha do M24): só com a base de terceiros carregada nos pares do novo; o legado
// tem os domínios de interação e nenhum par. Sem a base (DP-24), a tela informa "base de interações não contratada" e
// nenhum alerta de interação é inventado.
import type { AlertaGerado, ContextoAlertas, ItemAvaliado } from './tipos.js';

export function alertasInteracao(
  item: ItemAvaliado,
  rascunho: readonly ItemAvaliado[],
  ctx: ContextoAlertas,
): AlertaGerado[] {
  if (ctx.interacoes === null) return [];
  const outros = [...rascunho.filter((x) => x.chave !== item.chave), ...ctx.ativos];
  const r: AlertaGerado[] = [];
  for (const { produto } of item.produtos)
    for (const o of outros)
      for (const { produto: q } of o.produtos)
        for (const par of ctx.interacoes) {
          const casa =
            (produto.principiosAtivos.includes(par.a) && q.principiosAtivos.includes(par.b)) ||
            (produto.principiosAtivos.includes(par.b) && q.principiosAtivos.includes(par.a));
          if (!casa) continue;
          const id = `interacao:${Math.min(par.a, par.b)}-${Math.max(par.a, par.b)}:${q.produto}`;
          if (r.some((x) => x.id === id)) continue;
          r.push({
            id,
            item: item.chave,
            tipo: 'interacao',
            titulo: `Interação ${par.gravidade === 'contraindicada' ? 'contraindicada' : par.gravidade}`,
            detalhe: `${produto.nome} × ${q.nome}: ${par.efeito}`,
            gravidade: par.gravidade,
          });
        }
  return r;
}
