// CPF (ficha do M11, regra 2; sante-api, src/utils/sgh.js): dígito verificador; sequências repetidas e
// "00000000000" recusadas nas telas do novo. O legado guarda CPF como NÚMERO (RICADPAC.CPF DOUBLE PRECISION):
// a tela mostra 11 dígitos com zeros à esquerda e grava no tipo numérico; o legado continua aceitando o que
// aceita (zero, CPF antigo inválido): a LEITURA nunca recusa, só mostra "CPF não informado" ou "inválido".
import { cpfValido, somenteDigitos } from '@sgh/contratos';

export { cpfValido, somenteDigitos };

/** O valor do legado (número, texto, nulo) como 11 dígitos; null quando não há CPF (0, vazio, nulo). */
export function cpfDoLegado(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  const n =
    typeof valor === 'number'
      ? Math.trunc(valor)
      : typeof valor === 'bigint'
        ? Number(valor)
        : Number(somenteDigitos(String(valor)));
  if (!Number.isFinite(n) || n <= 0 || n > 99_999_999_999) return null;
  return String(n).padStart(11, '0');
}

/** 000.000.000-00 (com os zeros à esquerda). */
export function formatarCpf(cpf: string): string {
  const d = somenteDigitos(cpf).padStart(11, '0').slice(-11);
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** Máscara de lista (cap-08 §8.13): só os 5 últimos dígitos, "***.***.789-01". */
export function mascararCpf(cpf: string | null): string | null {
  if (!cpf) return null;
  const d = somenteDigitos(cpf).padStart(11, '0').slice(-11);
  return `***.***.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** Para gravar: o número do CPF (RICADPAC.CPF é numérico). Recusa o inválido. */
export function cpfParaGravar(cpf: string): number {
  if (!cpfValido(cpf)) throw new Error('CPF inválido.');
  return Number(somenteDigitos(cpf));
}
