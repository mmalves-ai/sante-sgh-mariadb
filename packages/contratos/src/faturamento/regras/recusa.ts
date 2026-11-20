// Recusa de negócio da conta do paciente (M30): o código estável (vai ao Problem Details e à tela) e a mensagem em
// português que o usuário lê, com os campos da tela que a causaram.
export interface RecusaFaturamento {
  readonly codigo: string;
  readonly mensagem: string;
  readonly campos?: readonly string[];
}

export const recusaFat = (codigo: string, mensagem: string, campos?: readonly string[]): RecusaFaturamento =>
  campos ? { codigo, mensagem, campos } : { codigo, mensagem };

/** Arredonda para 2 casas (valor do item: NUMERIC(18,2)). */
export const centavos = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Arredonda para 4 casas (o unitário do item: UNIT_C com 4 casas, como o outro sistema grava). */
export const quatroCasas = (n: number): number => Math.round((n + Number.EPSILON) * 10_000) / 10_000;

/** Meio centavo: a tolerância entre o total da conta (DOUBLE) e a soma dos itens (NUMERIC(18,2)). */
export const TOLERANCIA_CENTAVO = 0.005;

/** Moeda brasileira para as mensagens (R$ 1.234,56). */
export const reaisTexto = (n: number): string =>
  `R$ ${centavos(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
