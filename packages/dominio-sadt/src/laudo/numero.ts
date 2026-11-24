// Número do laudo (F3.5, 05-SADT linha 16): sequencial, único por estabelecimento e sem lacuna, gerado na emissão pela
// numeração de negócio do estabelecimento (travada na mesma transação; desfeita a emissão, o número volta). O código de
// autenticação continua ao lado: o número identifica a emissão para a recepção e o arquivo; o código confere a
// autenticidade em público. A regra do formato mora aqui (sem gatilho no banco).

/** O tipo da numeração do laudo no estabelecimento. */
export const SEQUENCIA_NUMERO_LAUDO = 'laudo_exame';

/** O prefixo da numeração do laudo do estabelecimento (criado na primeira emissão, se ainda não houver). */
export function prefixoDoNumeroLaudo(estabelecimento: number): string {
  if (!Number.isSafeInteger(estabelecimento) || estabelecimento <= 0)
    throw new Error('Estabelecimento inválido para a numeração do laudo.');
  return `LAU${estabelecimento}-`;
}

/** Confere o número gerado (inteiro positivo, com o texto que termina nele) e devolve o texto gravado. */
export function numeroDoLaudo(n: { readonly valor: number; readonly formatado: string }): string {
  if (!Number.isSafeInteger(n.valor) || n.valor <= 0)
    throw new Error('O número do laudo precisa ser um inteiro positivo.');
  const f = n.formatado.trim();
  if (f.length === 0 || f.length > 30 || !f.endsWith(String(n.valor)))
    throw new Error('O número do laudo formatado não corresponde ao valor gerado.');
  return f;
}

/** A frase da emissão para a tela: o número, a via e o código de autenticação. */
export function fraseDaEmissao(e: {
  readonly numero: string;
  readonly segundaVia: boolean;
  readonly codigo: string;
}): string {
  return e.segundaVia
    ? `2ª via do laudo emitida: número ${e.numero} (autenticação ${e.codigo}).`
    : `Laudo emitido: número ${e.numero} (autenticação ${e.codigo}).`;
}
