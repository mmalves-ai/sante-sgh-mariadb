// Desfazer a unificação de prontuários (F3.1, 02-CAD linha 7): a unificação registrou, item a item, cada registro que
// passou do cadastro absorvido ao que ficou. Desfazer devolve esses registros na ordem inversa, reativa o absorvido e
// marca a unificação como revertida, com motivo e responsável. Nada se apaga: os itens e a unificação continuam como
// histórico. Se algum registro transferido já não aponta para o cadastro que ficou (foi movido de novo, por outra
// unificação ou correção), a reversão inteira é recusada: nunca se devolve só uma parte.

export interface UnificacaoParaDesfazer {
  readonly situacao: string;
  readonly reversivel: boolean;
  readonly mantido: number;
  readonly absorvido: number;
}

export interface ItemTransferido {
  readonly id: number;
  readonly sequencia: number;
  readonly tabela: string;
  readonly registroId: number;
  readonly coluna: string;
  readonly situacao: string;
}

export interface RecusaDesfazer {
  readonly codigo: string;
  readonly mensagem: string;
}

export type PlanoDesfazer =
  | { readonly ok: true; readonly devolver: readonly ItemTransferido[] }
  | { readonly ok: false; readonly recusa: RecusaDesfazer };

export const MOTIVO_DESFAZER_MIN = 5;
export const MOTIVO_DESFAZER_MAX = 400;

/** Confere se a unificação pode ser desfeita e devolve os itens a reverter, do último transferido ao primeiro. */
export function planoDeDesfazer(
  u: UnificacaoParaDesfazer,
  itens: readonly ItemTransferido[],
  motivo: string,
): PlanoDesfazer {
  const m = motivo.trim();
  if (m.length < MOTIVO_DESFAZER_MIN || m.length > MOTIVO_DESFAZER_MAX)
    return {
      ok: false,
      recusa: {
        codigo: 'motivo-obrigatorio',
        mensagem: `Escreva o motivo de desfazer a unificação (${MOTIVO_DESFAZER_MIN} a ${MOTIVO_DESFAZER_MAX} letras).`,
      },
    };
  if (u.situacao === 'revertida')
    return { ok: false, recusa: { codigo: 'ja-revertida', mensagem: 'Esta unificação já foi desfeita.' } };
  if (u.situacao !== 'efetivada')
    return {
      ok: false,
      recusa: {
        codigo: 'unificacao-nao-efetivada',
        mensagem: 'Só uma unificação efetivada pode ser desfeita.',
      },
    };
  if (!u.reversivel)
    return {
      ok: false,
      recusa: {
        codigo: 'unificacao-irreversivel',
        mensagem: 'Esta unificação foi marcada como não reversível: corrija os registros um a um.',
      },
    };
  const devolver = itens
    .filter((i) => i.situacao === 'transferido')
    .sort((a, b) => b.sequencia - a.sequencia);
  return { ok: true, devolver };
}

/**
 * Confere o registro no banco antes de devolvê-lo: ele tem de existir e ainda apontar para o cadastro que ficou. Senão,
 * a reversão é recusada com o lugar do conflito (tabela e id, nunca valores do paciente).
 */
export function conferirRegistroDevolvido(
  item: ItemTransferido,
  apontaPara: number | null,
  mantido: number,
): RecusaDesfazer | null {
  if (apontaPara === null)
    return {
      codigo: 'desfazer-registro-inexistente',
      mensagem: `O registro ${item.registroId} de ${item.tabela} não existe mais: a unificação não pode ser desfeita automaticamente.`,
    };
  if (apontaPara !== mantido)
    return {
      codigo: 'desfazer-conflito',
      mensagem: `O registro ${item.registroId} de ${item.tabela} já foi movido depois da unificação: nada foi desfeito.`,
    };
  return null;
}
