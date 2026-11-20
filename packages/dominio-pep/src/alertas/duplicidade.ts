// Duplicidade (regra 4 da ficha do M24): o critério do legado (validação de duplicidade: 1 por medicamento, 2 por
// princípio ativo, os dois ativos na cópia) com o parâmetro que manda consistir; bloqueio com justificativa, como hoje.
// Compara o item com os do próprio rascunho e com os ativos de outras prescrições do atendimento no período.
import type { AlertaGerado, ContextoAlertas, ItemAvaliado } from './tipos.js';

export function alertasDuplicidade(
  item: ItemAvaliado,
  rascunho: readonly ItemAvaliado[],
  ctx: ContextoAlertas,
): AlertaGerado[] {
  if (!ctx.duplicidade.consistir) return [];
  const outros = [...rascunho.filter((x) => x.chave !== item.chave), ...ctx.ativos];
  const r: AlertaGerado[] = [];
  for (const { produto } of item.produtos) {
    for (const o of outros) {
      for (const { produto: q } of o.produtos) {
        const mesmo = ctx.duplicidade.porMedicamento && q.produto === produto.produto;
        const principio =
          ctx.duplicidade.porPrincipio &&
          q.principiosAtivos.some((p) => produto.principiosAtivos.includes(p));
        if (!mesmo && !principio) continue;
        const id = `duplicidade:${produto.produto}:${o.existente ? 'ativo' : 'rascunho'}:${q.produto}`;
        if (r.some((x) => x.id === id)) continue;
        r.push({
          id,
          item: item.chave,
          tipo: 'duplicidade',
          titulo: mesmo ? 'Medicamento em duplicidade' : 'Princípio ativo em duplicidade',
          detalhe: mesmo
            ? `${produto.nome} já está ${o.existente ? 'em outra prescrição ativa no período' : 'nesta prescrição'}.`
            : `${produto.nome} tem o mesmo princípio ativo de ${q.nome}${o.existente ? ', em outra prescrição ativa no período' : ''}.`,
        });
      }
    }
  }
  return r;
}
