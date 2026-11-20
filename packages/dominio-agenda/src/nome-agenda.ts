// Nome da agenda e contato (ficha do M17, regras 10 e 11; ref 01 §2.1 e §4.4). O nome da agenda é CHAVE (até
// 40 caracteres, hífen com espaçamento irregular proposital, 5 nomes truncados): a leitura casa o texto sem
// UPPER/TRIM na coluna (o índice se perde) e a separação corta no PRIMEIRO hífen (procedimento - profissional).
// Telefone: comparado pelos 8 últimos dígitos; '0' ou '' = sem telefone.

export const TAMANHO_NOME_AGENDA = 40;

export function partesDoNome(nome: string): { procedimento: string; profissional: string | null } {
  const raw = nome.trim();
  const i = raw.indexOf('-');
  if (i === -1) return { procedimento: raw, profissional: null };
  const procedimento = raw.slice(0, i).trim();
  const profissional = raw.slice(i + 1).trim() || null;
  return { procedimento: procedimento || raw, profissional };
}

/** Nome novo de agenda: "PROCEDIMENTO - PROFISSIONAL", até 40 caracteres, em maiúsculas (como o cadastro). */
export function nomeDaAgenda(procedimento: string, profissional: string): string {
  const n = `${procedimento.trim()} - ${profissional.trim()}`.toUpperCase().replace(/\s+/g, ' ');
  return n.slice(0, TAMANHO_NOME_AGENDA).trimEnd();
}

export function somenteDigitos(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '');
}

/** '0', '' ou nulo = sem telefone. */
export function semTelefone(v: string | null | undefined): boolean {
  const s = (v ?? '').trim();
  return s === '' || s === '0' || somenteDigitos(s) === '';
}

/** Mesmo telefone pelos 8 últimos dígitos (com ou sem DDD, com ou sem máscara). */
export function mesmoTelefone(a: string | null | undefined, b: string | null | undefined): boolean {
  if (semTelefone(a) || semTelefone(b)) return false;
  return somenteDigitos(a).slice(-8) === somenteDigitos(b).slice(-8);
}

/** Telefone mascarado para listas: só os 4 últimos dígitos. */
export function telefoneMascarado(v: string | null | undefined): string {
  if (semTelefone(v)) return '';
  const d = somenteDigitos(v);
  return `•••• ${d.slice(-4)}`;
}

/** Nome mascarado para listas (iniciais + primeiro nome): "MARIA S. O." */
export function nomeMascarado(v: string | null | undefined): string {
  const partes = (v ?? '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '';
  const [primeiro, ...resto] = partes as [string, ...string[]];
  return [primeiro, ...resto.filter((p) => p.length > 2).map((p) => `${p[0]}.`)].join(' ');
}
