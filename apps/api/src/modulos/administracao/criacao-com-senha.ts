// Criar a conta já com a senha inicial (01-ADM L57): quem cria o usuário recebe, na mesma resposta, a senha provisória
// que entrega à pessoa; ela troca no primeiro acesso. Um passo para o gestor, em vez de criar e depois abrir a ficha
// para "dar a senha".
// São duas gravações, cada uma na sua transação com a sua trilha: a conta (com vínculo e perfil) e a credencial
// provisória. Se a segunda falhar, a conta continua criada e sem credencial (ninguém entra com ela) e a resposta diz
// que a senha ficou pendente e por quê; a ficha do usuário continua oferecendo "dar senha provisória". A senha nunca
// vai a log nem a trilha: volta só nesta resposta.

export interface SenhaInicial {
  readonly senhaProvisoria: string;
  readonly trocaObrigatoria: boolean;
}

export type ResultadoSenhaInicial =
  | { readonly emitida: true; readonly senha: SenhaInicial }
  | { readonly emitida: false; readonly motivo: string };

export const SENHA_INICIAL_PENDENTE =
  'A conta foi criada, mas a senha inicial não pôde ser emitida agora. Abra a ficha do usuário e use "Senha provisória".';

/** O detalhe legível de uma falha, sem nada além do texto de negócio. */
function motivoDaFalha(e: unknown): string {
  const d = (e as { detalhe?: unknown } | null)?.detalhe;
  return typeof d === 'string' && d.trim() !== ''
    ? `${SENHA_INICIAL_PENDENTE} (${d.trim()})`
    : SENHA_INICIAL_PENDENTE;
}

/**
 * Cria a conta e, criada, emite a senha inicial. A recusa da criação sobe como está (nada de senha para conta que não
 * nasceu); a falha da senha não desfaz a conta: vira "pendente" com o motivo.
 */
export async function criarContaComSenhaInicial<R>(
  criar: () => Promise<R>,
  darSenha: ((conta: R) => Promise<SenhaInicial>) | null,
): Promise<{ readonly conta: R; readonly senhaInicial: ResultadoSenhaInicial }> {
  const conta = await criar();
  if (!darSenha) return { conta, senhaInicial: { emitida: false, motivo: SENHA_INICIAL_PENDENTE } };
  try {
    const senha = await darSenha(conta);
    if (!senha.senhaProvisoria)
      return { conta, senhaInicial: { emitida: false, motivo: SENHA_INICIAL_PENDENTE } };
    return { conta, senhaInicial: { emitida: true, senha } };
  } catch (e) {
    return { conta, senhaInicial: { emitida: false, motivo: motivoDaFalha(e) } };
  }
}
