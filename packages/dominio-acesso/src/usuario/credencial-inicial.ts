// Credencial inicial da conta criada (01-ADM L57): a conta nasce já com a senha provisória, na MESMA gravação da conta,
// do vínculo e do perfil (uma transação; nada de conta criada "sem senha" por falha no meio). A senha em claro nunca
// chega aqui: só o resumo PHC argon2id já cifrado. A troca no primeiro acesso é obrigatória (SBIS: a senha que o gestor
// entrega não é a senha da pessoa) e o histórico registra a forma "criacao", com quem criou como responsável.

/** Resumo PHC argon2id (o mesmo formato que a conferência da senha aceita). */
const PHC_ARGON2ID = /^\$argon2id\$v=\d+\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/;

export type RecusaCredencialInicial = 'senha-sem-cifra';

export const MENSAGEM_CREDENCIAL_INICIAL: Readonly<Record<RecusaCredencialInicial, string>> = {
  'senha-sem-cifra': 'A senha inicial só é guardada cifrada (argon2id).',
};

export interface PlanoCredencialInicial {
  readonly credencial: {
    readonly algoritmo: 'argon2id';
    readonly resumo_senha: string;
    readonly troca_obrigatoria: true;
    readonly tentativas_invalidas: 0;
  };
  readonly historico: {
    readonly operacao: 'inclusao';
    readonly hash_senha: string;
    readonly algoritmo: 'argon2id';
    readonly forma_troca: 'criacao';
  };
}

/**
 * O que a criação grava de credencial: nada sem resumo (a conta nasce sem senha e a ficha oferece "Senha provisória");
 * com resumo fora do formato, recusa (a criação inteira não grava); com resumo, a credencial de troca obrigatória e a
 * linha do histórico.
 */
export function planoCredencialInicial(
  resumo: string | null | undefined,
): PlanoCredencialInicial | null | { readonly recusa: RecusaCredencialInicial } {
  if (resumo === null || resumo === undefined) return null;
  if (!PHC_ARGON2ID.test(resumo)) return { recusa: 'senha-sem-cifra' };
  return {
    credencial: {
      algoritmo: 'argon2id',
      resumo_senha: resumo,
      troca_obrigatoria: true,
      tentativas_invalidas: 0,
    },
    historico: { operacao: 'inclusao', hash_senha: resumo, algoritmo: 'argon2id', forma_troca: 'criacao' },
  };
}
