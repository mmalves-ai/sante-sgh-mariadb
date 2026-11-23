import { z } from 'zod';

/**
 * Id de linha do banco (BIGINT UNSIGNED, ADR 0002 parte 2). O espelho põe os itens próprios do hospital
 * nas tabelas de catálogo a partir de 10^12, então o id não cabe em 32 bits: o teto é o maior inteiro
 * exato do JavaScript (2^53 - 1). Número de negócio, versão, quantidade e contador NÃO usam este esquema.
 */
export const ID_BANCO_MAXIMO = Number.MAX_SAFE_INTEGER;

/** Id de linha: inteiro de 1 a 2^53 - 1. */
export const idBanco = z.number().int().positive().max(ID_BANCO_MAXIMO);

/** Id de linha em que 0 significa "não informado". */
export const idBancoOuZero = z.number().int().min(0).max(ID_BANCO_MAXIMO);

/** Id de linha vindo de texto (consulta, formulário): convertido para número. */
export const idBancoTexto = z.coerce.number().int().positive().max(ID_BANCO_MAXIMO);

/** Id de linha vindo de texto em que 0 significa "não informado" (ou o cursor inicial). */
export const idBancoOuZeroTexto = z.coerce.number().int().min(0).max(ID_BANCO_MAXIMO);

/** Parâmetro de rota ou de consulta com id de linha: até 16 dígitos (2^53 - 1 tem 16). */
export const EXPRESSAO_ID_BANCO = /^\d{1,16}$/;

/** Lê um id de linha de um texto de rota ou de consulta; null quando não é id válido. */
export function lerIdBanco(texto: unknown): number | null {
  if (typeof texto !== 'string' || !EXPRESSAO_ID_BANCO.test(texto)) return null;
  const n = Number(texto);
  return n >= 1 && n <= ID_BANCO_MAXIMO ? n : null;
}
