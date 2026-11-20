// Busca por nome (ficha do M11, regra 5; cap-10 §10.7; ref 01 §4.4; sante-api, src/utils/busca.js e
// fonetica.js): por PALAVRA, sem acento e sem caixa, conjuntiva (todas as palavras do termo têm de estar no
// nome); a palavra de uma letra é inicial; a palavra do termo pode ser PREFIXO da do cadastro (nome
// truncado, digitação incompleta) só a partir de 4 letras. A chave fonética em português (do contrato de
// SGH_BUSCA_NOME, @sgh/contratos) só SUGERE — "talvez seja X, confirme" — e nunca passa de 5 sugestões.
import {
  chaveFonetica,
  chaveTelefone,
  palavrasDoCadastro,
  palavrasDoTermo,
  TETO_SUGESTOES_FONETICAS,
} from '@sgh/contratos';

export { chaveFonetica, chaveTelefone, palavrasDoCadastro, palavrasDoTermo };

/** Prefixo mínimo do casamento tolerante (abaixo disso o prefixo casa qualquer coisa). */
export const PREFIXO_MINIMO = 4;

/** O termo identifica alguém? Sem palavra de duas letras ou mais, `every` seria verdade vacuosa. */
export function termoIdentifica(palavras: readonly string[]): boolean {
  return palavras.length > 0 && !palavras.every((p) => p.length === 1);
}

/**
 * Todas as palavras do termo estão no nome cadastrado? Inicial exige palavra começando por ela; palavra de 4
 * letras ou mais aceita ser prefixo ("SIQUEIR" acha "SIQUEIRA").
 */
export function casaPalavras(termo: readonly string[], nome: readonly string[]): boolean {
  if (!termoIdentifica(termo)) return false;
  return termo.every((p) =>
    p.length === 1
      ? nome.some((w) => w[0] === p)
      : nome.includes(p) || (p.length >= PREFIXO_MINIMO && nome.some((w) => w.startsWith(p))),
  );
}

/** Todas as palavras do termo têm equivalente FONÉTICO no nome? (inicial compara com a palavra crua). */
export function casaFoneticamente(termo: readonly string[], nome: readonly string[]): boolean {
  if (!termoIdentifica(termo)) return false;
  const chaves = nome.map(chaveFonetica);
  return termo.every((p) =>
    p.length === 1 ? nome.some((w) => w[0] === p) : chaves.includes(chaveFonetica(p)),
  );
}

/**
 * Sugestões fonéticas: candidatos (já filtrados pelo índice) que casam foneticamente e NÃO casam por palavra,
 * na ordem dada, até 5 (regra 5: teto de 5 sugestões).
 */
export function sugerirFoneticos<T>(
  termo: string,
  candidatos: readonly T[],
  nomeDe: (c: T) => string,
  teto = TETO_SUGESTOES_FONETICAS,
): T[] {
  const p = palavrasDoTermo(termo);
  if (!termoIdentifica(p)) return [];
  const r: T[] = [];
  for (const c of candidatos) {
    const n = palavrasDoCadastro(nomeDe(c));
    if (!casaPalavras(p, n) && casaFoneticamente(p, n)) r.push(c);
    if (r.length >= teto) break;
  }
  return r;
}

/** A palavra do termo para consultar o índice: a mais longa (mais seletiva), e sua chave fonética. */
export function palavraMaisSeletiva(termo: readonly string[]): string | null {
  const candidatas = termo.filter((p) => p.length > 1);
  if (candidatas.length === 0) return null;
  return [...candidatas].sort((a, b) => b.length - a.length || a.localeCompare(b))[0] ?? null;
}

/** Telefone do termo: os 8 últimos dígitos, se houver 8 ou mais. */
export function telefoneDoTermo(termo: string): string | null {
  return chaveTelefone(termo);
}
