// Ajuste renal (regra 7 da ficha do M24): pelo clearance estimado com o dado mais recente; o item com ajuste no
// cadastro (ou na base de terceiros) acima da dose do ajuste gera o alerta. Sem clearance (falta peso, idade ou
// creatinina), nenhum alerta e a tela mostra o que falta.
import type { AlertaGerado, ContextoAlertas, ItemAvaliado } from './tipos.js';

export function alertasRenal(item: ItemAvaliado, ctx: ContextoAlertas): AlertaGerado[] {
  const cl = ctx.paciente.clearance;
  if (cl === null) return [];
  const r: AlertaGerado[] = [];
  for (const { produto, dose } of item.produtos) {
    const aj = produto.ajusteRenal;
    if (!aj || dose === null || cl >= aj.clearanceAbaixoDe || dose <= aj.doseMaxima) continue;
    r.push({
      id: `ajuste-renal:${produto.produto}`,
      item: item.chave,
      tipo: 'ajuste-renal',
      titulo: 'Ajuste renal',
      detalhe: `${produto.nome}: clearance estimado de ${cl} mL/min; com menos de ${aj.clearanceAbaixoDe} mL/min, a dose máxima é ${aj.doseMaxima}.`,
    });
  }
  return r;
}
