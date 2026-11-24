// Alergia (regra 5 da ficha do M24): alergia ativa a um princípio do item (ou à classe, pelo cadastro de alergias ×
// princípios) bloqueia; libera só com a justificativa do prescritor, gravada na coluna de justificativa de item
// alérgico do detalhe do medicamento (como o legado) e no registro de decisão do novo.
// Reação adversa prévia (03-PEP L103) entra como alergia: pelo princípio ativo do medicamento suspeito; sem princípio
// no cadastro, pelo próprio item; informado só pelo nome, pelo nome do produto (sem acento, sem caixa).
import type { AlergiaAtiva, AlertaGerado, ContextoAlertas, ItemAvaliado, ProdutoAlerta } from './tipos.js';

/** Texto comparável: sem acento, minúsculo, só letras e números separados por um espaço. */
export function nomeComparavel(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * O nome informado cruza com o produto quando um contém o outro, ou quando a primeira palavra do produto (o fármaco,
 * com 4 letras ou mais) aparece no nome informado. Nome informado com menos de 4 letras não cruza (evita ruído).
 */
export function nomeCruza(informado: string, produto: string): boolean {
  const i = nomeComparavel(informado);
  const p = nomeComparavel(produto);
  if (i.length < 4 || p.length < 4) return false;
  if (p.includes(i) || i.includes(p)) return true;
  const primeira = p.split(' ')[0] ?? '';
  return primeira.length >= 4 && ` ${i} `.includes(` ${primeira} `);
}

function motivo(a: AlergiaAtiva, produto: ProdutoAlerta): string | null {
  if (produto.principiosAtivos.some((p) => a.principios.includes(p)))
    return `${produto.nome} tem princípio ativo ligado à alergia ativa do paciente (${a.nome}).`;
  if (a.produtos?.includes(produto.produto))
    return `${produto.nome} é o mesmo item do cadastro da reação registrada (${a.nome}).`;
  if (a.nomesInformados?.some((n) => nomeCruza(n, produto.nome)))
    return `${produto.nome} confere com o medicamento informado pelo nome na reação registrada (${a.nome}); confira.`;
  return null;
}

export function alertasAlergia(item: ItemAvaliado, ctx: ContextoAlertas): AlertaGerado[] {
  const r: AlertaGerado[] = [];
  for (const { produto } of item.produtos) {
    for (const a of ctx.alergias) {
      const detalhe = motivo(a, produto);
      if (!detalhe) continue;
      r.push({
        id: `alergia:${produto.produto}:${a.alergia}`,
        item: item.chave,
        tipo: 'alergia',
        titulo: `Alergia registrada: ${a.nome}`,
        detalhe,
      });
    }
  }
  return r;
}
