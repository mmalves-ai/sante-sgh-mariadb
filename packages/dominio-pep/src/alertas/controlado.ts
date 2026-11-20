// Controlados (regra 7 e 15 da ficha do M24; Portaria 344/98, art. 36 §6º): internado usa só a prescrição diária;
// na alta e no ambulatório, o item vira receita no receituário certo (impressa e assinada à mão até a DP-23). O
// alerta informa a lista e o que muda; não bloqueia.
import type { AlertaGerado, ContextoAlertas, ItemAvaliado } from './tipos.js';

/** Receituário da lista da Portaria 344/98. */
export function receituarioDaLista(lista: string): string {
  const l = lista.trim().toUpperCase();
  if (/^A[123]$/.test(l)) return 'Notificação de receita A (amarela)';
  if (/^B[12]$/.test(l)) return 'Notificação de receita B (azul)';
  if (/^C[25]$/.test(l)) return 'Notificação de receita especial (branca)';
  if (/^C[134]$/.test(l)) return 'Receita de controle especial em duas vias';
  return 'Receita de controle especial';
}

export function alertasControlado(item: ItemAvaliado, ctx: ContextoAlertas): AlertaGerado[] {
  const internado = ctx.tipoAtendimento === 'I' && !ctx.alta;
  return item.produtos
    .filter(({ produto }) => produto.controlado !== null)
    .map(({ produto }) => {
      const lista = produto.controlado === '' ? 'controle especial' : `lista ${produto.controlado}`;
      return {
        id: `controlado:${produto.produto}`,
        item: item.chave,
        tipo: 'controlado' as const,
        titulo: `Medicamento controlado (${lista})`,
        detalhe: internado
          ? `${produto.nome}: na internação vale a prescrição diária; a receita é exigida na alta.`
          : `${produto.nome}: ${receituarioDaLista(produto.controlado ?? '')}, impressa e assinada à mão.`,
      };
    });
}
