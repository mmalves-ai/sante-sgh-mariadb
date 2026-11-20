// CPF do colaborador (ficha, seção 4: "CPF só como filtro exato, nunca exibido inteiro em lista"; cap-08 §8.13).
// No outro sistema o CPF do profissional está em TBPROFIS.CNPJ_CPF (869 de 871 no pc; TBPROFIS.CPF está vazio) e o
// do usuário em TBUSERS.CPF (1.080 de 1.087), ambos numéricos: 0 e nulo são "sem CPF".
import { cpfValido, somenteDigitos } from '@sgh/contratos';

/** O valor numérico do outro sistema como 11 dígitos; null quando não há CPF (0, vazio, nulo, fora da faixa). */
export function cpfDoLegado(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = typeof valor === 'bigint' ? Number(valor) : Number(somenteDigitos(String(valor)));
  if (!Number.isFinite(n) || n <= 0 || n > 99_999_999_999) return null;
  return String(Math.trunc(n)).padStart(11, '0');
}

/** Máscara (os 5 últimos dígitos): "***.***.789-09". */
export function mascararCpf(cpf: string | null): string | null {
  if (!cpf) return null;
  const d = somenteDigitos(cpf).padStart(11, '0').slice(-11);
  return `***.***.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** O número para o filtro exato na consulta (as colunas do outro sistema são numéricas). Recusa o inválido. */
export function cpfParaFiltro(cpf: string): number {
  if (!cpfValido(cpf)) throw new Error('CPF inválido.');
  return Number(somenteDigitos(cpf));
}
