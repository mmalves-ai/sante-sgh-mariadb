// CNS — Cartão Nacional de Saúde (ficha do M11, regra 3; DP-47.12): opcional, validado pelo algoritmo do
// Ministério da Saúde. Definitivo começa em 1 ou 2 (os 11 primeiros dígitos são a base do PIS, com o dígito
// e o "000"/"001"); provisório começa em 7, 8 ou 9 (soma ponderada de 15 a 1 múltipla de 11). O CPF é o
// identificador principal; o CNS, o secundário. Sem credencial do CADSUS em dev: só o algoritmo. O algoritmo mora em
// @sgh/contratos desde o M57 (o pareamento da Rede usa o mesmo).
import { cnsValido, somenteDigitos, tipoCns, type TipoCns } from '@sgh/contratos';

export { cnsValido, tipoCns, type TipoCns };

/** O CNS do legado (texto livre; '0' é o "não informado" das inclusões): null quando não há número. */
export function cnsDoLegado(valor: unknown): string | null {
  const d = somenteDigitos(String(valor ?? ''));
  return d.length === 0 || /^0+$/.test(d) ? null : d;
}

/** Máscara de lista: os 4 últimos dígitos. */
export function mascararCns(cns: string | null): string | null {
  if (!cns) return null;
  const d = somenteDigitos(cns);
  return `${'*'.repeat(Math.max(0, d.length - 4))}${d.slice(-4)}`;
}
