// CNS — Cartão Nacional de Saúde (ficha do M11, regra 3; DP-47.12): validado pelo algoritmo do Ministério da Saúde.
// Definitivo começa em 1 ou 2 (os 11 primeiros dígitos são a base do PIS, com o dígito e o "000"/"001");
// provisório começa em 7, 8 ou 9 (soma ponderada de 15 a 1 múltipla de 11). Mora nos contratos (como o CPF) desde o
// M57: o pareamento da Rede (@sgh/dominio-rede) e o cadastro (@sgh/dominio-cadastro) usam a mesma regra.
import { somenteDigitos } from './cpf.js';

export type TipoCns = 'definitivo' | 'provisorio';

function somaPonderada(d: string, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += Number(d[i]) * (15 - i);
  return s;
}

/** Tipo do CNS válido, ou null quando o número não passa no algoritmo. */
export function tipoCns(valor: string | null | undefined): TipoCns | null {
  const d = somenteDigitos(String(valor ?? ''));
  if (!/^\d{15}$/.test(d) || /^(\d)\1{14}$/.test(d)) return null;
  const primeiro = d[0] as string;
  if (primeiro === '1' || primeiro === '2') {
    const pis = d.slice(0, 11);
    let soma = somaPonderada(pis, 11);
    let dv = 11 - (soma % 11);
    if (dv === 11) dv = 0;
    let esperado: string;
    if (dv === 10) {
      soma += 2;
      dv = 11 - (soma % 11);
      esperado = `${pis}001${dv}`;
    } else esperado = `${pis}000${dv}`;
    return esperado === d ? 'definitivo' : null;
  }
  if (primeiro === '7' || primeiro === '8' || primeiro === '9')
    return somaPonderada(d, 15) % 11 === 0 ? 'provisorio' : null;
  return null;
}

export function cnsValido(valor: string | null | undefined): boolean {
  return tipoCns(valor) !== null;
}
