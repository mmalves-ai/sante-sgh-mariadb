// Recusa de negócio do estoque e das compras: o código estável (vai ao Problem Details e à tela) e a mensagem em
// português que o usuário lê, com os campos da tela que a causaram.
export interface RecusaSuprimentos {
  readonly codigo: string;
  readonly mensagem: string;
  readonly campos?: readonly string[];
}

export const recusa = (codigo: string, mensagem: string, campos?: readonly string[]): RecusaSuprimentos =>
  campos ? { codigo, mensagem, campos } : { codigo, mensagem };

/** Arredonda para 3 casas (quantidade do estoque: NUMERIC(15,3)). */
export const qtd3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Arredonda para 2 casas (valor: NUMERIC(15,2)). */
export const reais = (n: number): number => Math.round(n * 100) / 100;
