// Recusa de negócio do financeiro (M32): o código estável (vai ao Problem Details e à tela) e a mensagem em português
// que o usuário lê, com os campos da tela que a causaram. Dinheiro: o legado guarda DOUBLE nos títulos e no movimento;
// as contas do novo arredondam em centavos para comparar e exibir, nunca para gravar (a coluna recebe o valor digitado).
export interface RecusaFinanceiro {
  readonly codigo: string;
  readonly mensagem: string;
  readonly campos?: readonly string[];
}

export const recusaFin = (codigo: string, mensagem: string, campos?: readonly string[]): RecusaFinanceiro =>
  campos ? { codigo, mensagem, campos } : { codigo, mensagem };

/** Arredonda para 2 casas (exibição e comparação de dinheiro). */
export const centavos = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Meio centavo: a tolerância ao comparar DOUBLE do legado com a soma em centavos. */
export const TOLERANCIA = 0.005;

export const iguaisEmCentavos = (a: number, b: number): boolean =>
  Math.abs(centavos(a) - centavos(b)) < TOLERANCIA;

/** Moeda brasileira para as mensagens (R$ 1.234,56). */
export const reais = (n: number): string =>
  `R$ ${centavos(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A sentinela de data do legado (TDateTime zero do Delphi): título em aberto, autorização não preenchida. */
export const SENTINELA_DATA = '1899-12-30';

/** A data (AAAA-MM-DD) é a sentinela ou vazia? */
export const dataVazia = (d: string | null | undefined): boolean =>
  d === null || d === undefined || d.trim() === '' || d.slice(0, 10) === SENTINELA_DATA;

/** Soma dias a uma data AAAA-MM-DD (UTC, sem fuso). */
export function somarDias(data: string, dias: number): string {
  const d = new Date(`${data.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Dias entre duas datas AAAA-MM-DD (b − a). */
export function diasEntre(a: string, b: string): number {
  const x = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const y = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round((y - x) / 86_400_000);
}

/** Dia da semana (0 = domingo) de uma data AAAA-MM-DD. */
export const diaDaSemana = (data: string): number => new Date(`${data.slice(0, 10)}T12:00:00Z`).getUTCDay();

/** Login comparável (o login pode chegar com caixa diferente; para a segregação, pessoa é pessoa). */
export const mesmaPessoa = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && a.trim().toUpperCase() === b.trim().toUpperCase();
