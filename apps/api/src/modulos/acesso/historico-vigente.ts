// Regras puras sobre históricos só de inclusão (cada mudança é uma linha nova): a linha mais recente de cada chave é a
// que vale. Usadas pela rotina das contas dormentes (exceções justificadas) e pela conferência do conselho.
// Melhoria: genéricas sobre o tipo de negócio (sem tipo do sistema de origem); pedido do lote 02-01: levar ao
// @sgh/dominio-acesso quando a gestão de acessos for migrada.

/** As exceções de dormência vigentes: a última linha de cada login, quando ela está "vigente"; em ordem de login. */
export function excecoesDormenciaVigentes<T extends { readonly id: number | string; readonly login: string; readonly situacao: string }>(
  historico: readonly T[],
): T[] {
  const visto = new Set<string>();
  const r: T[] = [];
  for (const x of [...historico].sort((a, b) => Number(b.id) - Number(a.id))) {
    if (visto.has(x.login)) continue;
    visto.add(x.login);
    if (x.situacao === 'vigente') r.push(x);
  }
  return r.sort((a, b) => a.login.localeCompare(b.login));
}

/** A conferência vigente de cada registro no conselho: a linha mais recente por registro. */
export function conferenciasConselhoVigentes<T extends { readonly id: number | string; readonly registro: number }>(
  historico: readonly T[],
): Map<number, T> {
  const r = new Map<number, T>();
  for (const x of [...historico].sort((a, b) => Number(b.id) - Number(a.id))) if (!r.has(x.registro)) r.set(x.registro, x);
  return r;
}
