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
  | { readonly codigo: 'motivo-obrigatorio'; readonly mensagem: string }
  | { readonly codigo: 'nao-emissor'; readonly mensagem: string };

/**
 * Pode cancelar? Só a declaração não cancelada e sempre com motivo escrito (de 10 a 2000 caracteres). Cancela o médico
 * que a emitiu (quem atesta responde pelo documento) ou, por cima dele, quem tem a permissão do responsável técnico ou
 * do diretor clínico (`podeCancelarDeOutro`; CFM Res. 1.779/2005), também com motivo e com a trilha do cancelamento por
 * terceiro. Devolve o motivo limpo e se o cancelamento é de outro médico, ou a recusa. `ehEmissor` fica verdadeiro só
 * na conferência prévia do motivo, antes de a porta conhecer a declaração.
 */
export function validarCancelamentoObito(
  situacao: SituacaoDeclaracaoObito,
  motivo: string,
  ehEmissor = true,
  podeCancelarDeOutro = false,
):
  | { readonly ok: true; readonly motivo: string; readonly deOutroMedico: boolean }
  | ({ readonly ok: false } & RecusaCancelamentoObito) {
  if (situacao === 'cancelada')
    return { ok: false, codigo: 'ja-cancelada', mensagem: 'A declaração de óbito já foi cancelada.' };
  if (!ehEmissor && !podeCancelarDeOutro)
    return {
      ok: false,
      codigo: 'nao-emissor',
      mensagem:
        'Só o médico que emitiu a declaração de óbito, ou o responsável técnico ou diretor clínico, pode cancelá-la.',
    };
  const m = (motivo ?? '').trim();
  if (m.length < MIN_MOTIVO_CANCELAMENTO_OBITO || m.length > MAX_MOTIVO_CANCELAMENTO_OBITO)
    return {
      ok: false,
      codigo: 'motivo-obrigatorio',
      mensagem: `O motivo do cancelamento tem de ${MIN_MOTIVO_CANCELAMENTO_OBITO} a ${MAX_MOTIVO_CANCELAMENTO_OBITO} caracteres.`,
    };
  return { ok: true, motivo: m, deOutroMedico: !ehEmissor };
}

/** Status HTTP de cada recusa do cancelamento. */
export function statusDaRecusaObito(codigo: RecusaCancelamentoObito['codigo']): number {
  return codigo === 'motivo-obrigatorio' ? 422 : codigo === 'nao-emissor' ? 403 : 409;
}
