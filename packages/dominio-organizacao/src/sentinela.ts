// Linhas sentinela "não informado" (ficha do M10, regra 17; ref 02 §3; cap-06a §6.1): o legado guarda uma linha
// de código 0 (ou com a descrição "não informado/a") em vários cadastros da estrutura, que outras tabelas usam
// como valor padrão. A linha continua no banco (nunca é apagada nem inativada pelo novo) e NÃO aparece como
// opção nas listas de escolha; na consulta do cadastro, aparece marcada como "não informado".

/** Texto sem acento, minúsculo e com espaços simples (comparação da descrição). */
export function normalizarDescricao(texto: string | null | undefined): string {
  return (texto ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const DESCRICOES_SENTINELA = new Set([
  'nao informado',
  'nao informada',
  'nao informados',
  'nao informadas',
  'nao definido',
  'nao definida',
  'nenhum',
  'nenhuma',
]);

export interface ItemComCodigo {
  readonly codigo: string | number | null;
  readonly descricao?: string | null;
}

/** A linha é a sentinela "não informado": código 0 (ou vazio) ou a descrição de sentinela. */
export function ehSentinela(item: ItemComCodigo): boolean {
  const c = item.codigo === null ? '' : String(item.codigo).trim();
  if (c === '' || c === '0') return true;
  return DESCRICOES_SENTINELA.has(normalizarDescricao(item.descricao));
}

/** Opções de uma lista de escolha: sem as sentinelas (elas continuam no banco). */
export function opcoesSemSentinela<T extends ItemComCodigo>(itens: readonly T[]): T[] {
  return itens.filter((i) => !ehSentinela(i));
}

/** Rótulo de uma linha na consulta: a sentinela aparece como "não informado". */
export function rotuloNaConsulta(item: ItemComCodigo, padrao = 'Não informado'): string {
  if (ehSentinela(item)) return padrao;
  return (item.descricao ?? '').trim() || String(item.codigo ?? '');
}
