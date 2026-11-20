// Alergia (regra 5 da ficha do M24): alergia ativa a um princípio do item (ou à classe, pelo cadastro de alergias ×
// princípios) bloqueia; libera só com a justificativa do prescritor, gravada na coluna de justificativa de item
// alérgico do detalhe do medicamento (como o legado) e no registro de decisão do novo.
import type { AlertaGerado, ContextoAlertas, ItemAvaliado } from './tipos.js';

export function alertasAlergia(item: ItemAvaliado, ctx: ContextoAlertas): AlertaGerado[] {
  const r: AlertaGerado[] = [];
  for (const { produto } of item.produtos) {
    for (const a of ctx.alergias) {
      const comuns = produto.principiosAtivos.filter((p) => a.principios.includes(p));
      if (comuns.length === 0) continue;
      r.push({
        id: `alergia:${produto.produto}:${a.alergia}`,
        item: item.chave,
        tipo: 'alergia',
        titulo: `Alergia registrada: ${a.nome}`,
        detalhe: `${produto.nome} tem princípio ativo ligado à alergia ativa do paciente (${a.nome}).`,
      });
    }
  }
  return r;
}
