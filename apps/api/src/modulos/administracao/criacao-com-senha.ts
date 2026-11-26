// Criar a conta já com a senha inicial (01-ADM L57): quem cria o usuário recebe, na mesma resposta, a senha provisória
// que entrega à pessoa; ela troca no primeiro acesso. Um passo para o gestor, em vez de criar e depois abrir a ficha
// para "dar a senha".
// Uma gravação só: a senha é gerada e cifrada ANTES, e a receita acesso.criar_usuario grava a conta, o vínculo, o perfil,
// a credencial de troca obrigatória e o histórico na mesma transação, com a trilha (ou nasce tudo, ou nada). Só se a
// senha nem puder ser gerada (política ilegível, serviço de senha ausente) a conta nasce sem credencial e a resposta
// diz que a senha ficou pendente e por quê; a ficha continua oferecendo "Senha provisória". A senha nunca vai a log
// nem a trilha: volta só nesta resposta.

export interface SenhaInicial {
  readonly senhaProvisoria: string;
  readonly trocaObrigatoria: boolean;
}

/** A senha gerada para a conta nova: a clara volta ao gestor; o resumo argon2id vai à receita. */
export interface SenhaPreparada {
  readonly senha: string;
  readonly resumo: string;
}

export type ResultadoSenhaInicial =
  | { readonly emitida: true; readonly senha: SenhaInicial }
  | { readonly emitida: false; readonly motivo: string };

export const SENHA_INICIAL_PENDENTE =
  'A conta foi criada, mas a senha inicial não pôde ser emitida agora. Abra a ficha do usuário e use "Senha provisória".';

/** O detalhe legível de uma falha, sem nada além do texto de negócio. */
function motivoDaFalha(e: unknown): string {
  const d = (e as { detalhe?: unknown; message?: unknown } | null)?.detalhe;
  return typeof d === 'string' && d.trim() !== ''
    ? `${SENHA_INICIAL_PENDENTE} (${d.trim()})`
    : SENHA_INICIAL_PENDENTE;
}

/**
 * Prepara a senha e cria a conta com ela numa gravação só. A recusa da criação sobe como está (nada gravado, nada de
 * senha na resposta). Sem como preparar a senha, cria a conta sem credencial e devolve "pendente" com o motivo.
 * `concluir` (opcional) roda depois da gravação (o serviço da identidade). A troca obrigatória vem da credencial que a
 * receita gravou (planoCredencialInicial: sempre de troca obrigatória); o desfecho de `concluir` nunca a rebaixa.
 */
export async function criarContaComSenhaInicial<R>(
  preparar: (() => Promise<SenhaPreparada>) | null,
  criar: (resumo: string | null) => Promise<R>,
  concluir?: (conta: R, senha: string) => Promise<unknown>,
): Promise<{ readonly conta: R; readonly senhaInicial: ResultadoSenhaInicial }> {
  let preparada: SenhaPreparada | null = null;
  let motivo = SENHA_INICIAL_PENDENTE;
  if (preparar) {
    try {
      const p = await preparar();
      if (p.senha && p.resumo) preparada = p;
    } catch (e) {
      motivo = motivoDaFalha(e);
    }
  }
  const conta = await criar(preparada ? preparada.resumo : null);
  if (!preparada) return { conta, senhaInicial: { emitida: false, motivo } };
  if (concluir) await concluir(conta, preparada.senha).catch(() => undefined);
  return {
    conta,
    senhaInicial: { emitida: true, senha: { senhaProvisoria: preparada.senha, trocaObrigatoria: true } },
  };
}
