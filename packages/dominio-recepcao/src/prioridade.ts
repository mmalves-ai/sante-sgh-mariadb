// Prioridade legal da senha (M19; ficha, regra 3; Anexo A §A.1): o legado grava 0 (acima de 80 anos), 1 (demais
// prioridades) ou 2 (normal) — 97,9% das senhas são 2. Os grupos detalhados (60 a 79 anos, gestante, lactante, pessoa
// com deficiência, criança de colo, TEA, obesidade) gravam 1 e o grupo fica no novo até a conferência de que o outro
// sistema chama na ordem certa as senhas dos 7 grupos nunca usados (grupos de prioridade legal 3 a 9).
import { GRUPOS_PRIORIDADE, type PrioridadeSenha, prioritaria } from '@sgh/contratos';

export { prioritaria };

export interface PrioridadeResolvida {
  readonly prioridade: PrioridadeSenha;
  /** Grupo legal detalhado (0 a 9), ou null quando é a normal sem grupo. */
  readonly grupo: number | null;
}

/** A prioridade 0/1/2 de um grupo legal (grupo inexistente: normal). */
export function prioridadeDoGrupo(grupo: number | null | undefined): PrioridadeSenha {
  if (grupo === null || grupo === undefined) return '2';
  return GRUPOS_PRIORIDADE.find((g) => g.grupo === grupo)?.prioridade ?? '2';
}

/** Idade em anos completos na data (AAAA-MM-DD). */
export function idadeEm(nascimento: string, hoje: string): number {
  const [an, mn, dn] = nascimento.split('-').map(Number) as [number, number, number];
  const [ah, mh, dh] = hoje.split('-').map(Number) as [number, number, number];
  let idade = ah - an;
  if (mh < mn || (mh === mn && dh < dn)) idade--;
  return idade;
}

/**
 * Prioridade pela idade (quando o cadastro a informa) e pelo grupo declarado no totem ou no balcão: acima de 80 anos
 * é sempre 0 (a lei dá preferência dentro da preferência); 60 a 79 é o grupo 3 (1); o grupo declarado vale quando
 * não há idade que o supere.
 */
export function resolverPrioridade(e: {
  readonly grupo?: number | null;
  readonly nascimento?: string | null;
  readonly hoje?: string;
}): PrioridadeResolvida {
  if (
    e.nascimento &&
    e.hoje &&
    /^\d{4}-\d{2}-\d{2}$/.test(e.nascimento) &&
    e.nascimento.slice(0, 4) !== '1899'
  ) {
    const idade = idadeEm(e.nascimento, e.hoje);
    if (idade >= 80) return { prioridade: '0', grupo: 0 };
    if (idade >= 60 && (e.grupo === null || e.grupo === undefined || e.grupo === 2))
      return { prioridade: '1', grupo: 3 };
  }
  if (e.grupo === null || e.grupo === undefined) return { prioridade: '2', grupo: null };
  return { prioridade: prioridadeDoGrupo(e.grupo), grupo: e.grupo === 2 ? null : e.grupo };
}
