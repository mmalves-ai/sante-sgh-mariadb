// Número do laudo (F3.5, 05-SADT linha 16): sequencial, único por estabelecimento e sem lacuna, gerado na 1ª emissão pela
// numeração de negócio do estabelecimento (semeada na migração e no "criar novo cliente"; travada na mesma transação,
// antes do PDF, para sair impresso e coberto pelo hash; desfeita a emissão, o número volta). A 2ª via é do mesmo laudo:
// repete o número e o código, com o número da via e o motivo. O número identifica o laudo para a recepção e o arquivo;
// o código confere a autenticidade em público. A regra do formato mora aqui (sem gatilho no banco).

/** O tipo da numeração do laudo no estabelecimento. */
export const SEQUENCIA_NUMERO_LAUDO = 'laudo_exame';

/** Confere o número gerado (inteiro positivo, com o texto que termina nele) e devolve o texto gravado. */
export function numeroDoLaudo(n: { readonly valor: number; readonly formatado: string }): string {
  if (!Number.isSafeInteger(n.valor) || n.valor <= 0)
    throw new Error('O número do laudo precisa ser um inteiro positivo.');
  const f = n.formatado.trim();
  if (f.length === 0 || f.length > 30 || !f.endsWith(String(n.valor)))
    throw new Error('O número do laudo formatado não corresponde ao valor gerado.');
  return f;
}

/** A frase da emissão para a tela: o número do laudo, a via e o código de autenticação. */
export function fraseDaEmissao(e: {
  readonly numero: string;
  readonly via: number;
  readonly codigo: string;
}): string {
  if (!Number.isSafeInteger(e.via) || e.via < 1)
    throw new Error('A via do laudo precisa ser um inteiro positivo.');
  return e.via === 1
    ? `Laudo emitido: número ${e.numero} (autenticação ${e.codigo}).`
    : `${e.via}ª via do laudo número ${e.numero} emitida (autenticação ${e.codigo}).`;
}
