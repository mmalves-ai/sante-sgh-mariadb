// Declaração de óbito (03-PEP L126): as causas em linhas (parte I, cadeia de a até d; parte II, condições que
// contribuíram) e o cancelamento com motivo, que é obrigação do fluxo oficial do Ministério da Saúde. A declaração
// cancelada nunca é apagada: fica com a data, o motivo e o evento; a pessoa pode então receber uma nova declaração.

export type SituacaoDeclaracaoObito = 'rascunho' | 'emitida' | 'cancelada';

export interface CausasDeclaradas {
  readonly a: string;
  readonly b?: string | undefined;
  readonly c?: string | undefined;
  readonly d?: string | undefined;
  readonly parteII?: string | undefined;
}

export interface LinhaCausaObito {
  readonly sequencia: number;
  readonly parte: 'I' | 'II';
  readonly linha: 'a' | 'b' | 'c' | 'd' | null;
  readonly descricao: string;
}

/** Tamanho máximo da descrição de uma causa, como o médico a escreveu. */
export const MAX_DESCRICAO_CAUSA = 500;
export const MIN_MOTIVO_CANCELAMENTO_OBITO = 10;
export const MAX_MOTIVO_CANCELAMENTO_OBITO = 2000;

/**
 * As causas em linhas ordenadas: a parte I na ordem a, b, c, d (a causa imediata primeiro) e a parte II por último.
 * Linha vazia fica de fora. Sem a causa imediata (linha a) não há declaração.
 */
export function linhasDaCausa(c: CausasDeclaradas): LinhaCausaObito[] {
  const limpo = (s: string | undefined) => (s ?? '').trim();
  if (!limpo(c.a)) throw new Error('A causa imediata (parte I, linha a) é obrigatória.');
  const linhas: LinhaCausaObito[] = [];
  for (const l of ['a', 'b', 'c', 'd'] as const) {
    const d = limpo(c[l]);
    if (d) linhas.push({ sequencia: linhas.length + 1, parte: 'I', linha: l, descricao: d });
  }
  const ii = limpo(c.parteII);
  if (ii) linhas.push({ sequencia: linhas.length + 1, parte: 'II', linha: null, descricao: ii });
  for (const x of linhas)
    if (x.descricao.length > MAX_DESCRICAO_CAUSA)
      throw new Error(`A causa tem no máximo ${MAX_DESCRICAO_CAUSA} caracteres.`);
  return linhas;
}

export type RecusaCancelamentoObito =
  | { readonly codigo: 'ja-cancelada'; readonly mensagem: string }
  | { readonly codigo: 'motivo-obrigatorio'; readonly mensagem: string };

/**
 * Pode cancelar? Só a declaração não cancelada, e sempre com motivo escrito (de 10 a 2000 caracteres). Devolve o
 * motivo limpo, ou a recusa.
 */
export function validarCancelamentoObito(
  situacao: SituacaoDeclaracaoObito,
  motivo: string,
): { readonly ok: true; readonly motivo: string } | ({ readonly ok: false } & RecusaCancelamentoObito) {
  if (situacao === 'cancelada')
    return { ok: false, codigo: 'ja-cancelada', mensagem: 'A declaração de óbito já foi cancelada.' };
  const m = (motivo ?? '').trim();
  if (m.length < MIN_MOTIVO_CANCELAMENTO_OBITO || m.length > MAX_MOTIVO_CANCELAMENTO_OBITO)
    return {
      ok: false,
      codigo: 'motivo-obrigatorio',
      mensagem: `O motivo do cancelamento tem de ${MIN_MOTIVO_CANCELAMENTO_OBITO} a ${MAX_MOTIVO_CANCELAMENTO_OBITO} caracteres.`,
    };
  return { ok: true, motivo: m };
}
