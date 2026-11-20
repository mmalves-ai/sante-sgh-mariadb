// Escore de duplicidade (ficha do M11, regra 6; cap-06a §6.1): a fila compara pares de cadastros pela chave
// fonética do nome, nascimento, nome da mãe, CPF e telefone. O CPF válido igual em dois prontuários (14 na
// cópia do pc) entra primeiro; ninguém unifica sem comparar lado a lado (a unificação segue especificada).
// Pesos: CPF 60; nome (todas as palavras com a mesma chave fonética) 30, ou 15 com a primeira e a última;
// nascimento 20; mãe 15; telefone 10; teto 100. Entra na fila com 50 ou mais (o nome sozinho não basta).
import type { CriterioDuplicidade } from '@sgh/contratos';
import { cpfValido } from '../documento/cpf.js';
import { chaveFonetica, chaveTelefone, palavrasDoCadastro } from '../busca/fonetica.js';

export const LIMIAR_FILA = 50;

export interface CadastroComparavel {
  readonly id: number;
  readonly nome: string | null;
  readonly nascimento: string | null;
  readonly mae: string | null;
  /** 11 dígitos, ou null. */
  readonly cpf: string | null;
  readonly telefones: readonly (string | null)[];
}

export interface Escore {
  readonly escore: number;
  readonly criterios: readonly CriterioDuplicidade[];
}

/** Chaves fonéticas das palavras de um nome, sem conectivos de duas letras ou menos. */
export function chavesDoNome(nome: string | null): string[] {
  return palavrasDoCadastro(nome)
    .filter((p) => p.length > 2)
    .map(chaveFonetica);
}

function mesmaFonetica(a: string | null, b: string | null): 'todas' | 'pontas' | null {
  const x = chavesDoNome(a);
  const y = chavesDoNome(b);
  if (x.length === 0 || y.length === 0) return null;
  if (x.length === y.length && x.every((k, i) => k === y[i])) return 'todas';
  return x[0] === y[0] && x[x.length - 1] === y[y.length - 1] ? 'pontas' : null;
}

export function escoreDuplicidade(a: CadastroComparavel, b: CadastroComparavel): Escore {
  const criterios: CriterioDuplicidade[] = [];
  let pontos = 0;
  if (a.cpf && b.cpf && a.cpf === b.cpf && cpfValido(a.cpf)) {
    pontos += 60;
    criterios.push('cpf');
  }
  const f = mesmaFonetica(a.nome, b.nome);
  if (f) {
    pontos += f === 'todas' ? 30 : 15;
    criterios.push('fonetica');
  }
  if (a.nascimento && b.nascimento && a.nascimento === b.nascimento) {
    pontos += 20;
    criterios.push('nascimento');
  }
  if (mesmaFonetica(a.mae, b.mae) === 'todas') {
    pontos += 15;
    criterios.push('mae');
  }
  const ta = new Set(a.telefones.map(chaveTelefone).filter(Boolean));
  if (b.telefones.map(chaveTelefone).some((t) => t && ta.has(t))) {
    pontos += 10;
    criterios.push('telefone');
  }
  return { escore: Math.min(100, pontos), criterios };
}

/** O par vai à fila? CPF igual sempre; senão, o escore mínimo. */
export function entraNaFila(e: Escore): boolean {
  return e.criterios.includes('cpf') || e.escore >= LIMIAR_FILA;
}

/** Ordem da fila: CPF primeiro, depois o escore, depois o par (estável). */
export function ordemDaFila<T extends Escore & { readonly a: number; readonly b: number }>(
  pares: readonly T[],
): T[] {
  return [...pares].sort(
    (x, y) =>
      Number(y.criterios.includes('cpf')) - Number(x.criterios.includes('cpf')) ||
      y.escore - x.escore ||
      x.a - y.a ||
      x.b - y.b,
  );
}

/** Par normalizado (menor ID primeiro): a fila nunca tem o mesmo par duas vezes. */
export function parOrdenado(a: number, b: number): readonly [number, number] {
  return a < b ? [a, b] : [b, a];
}
