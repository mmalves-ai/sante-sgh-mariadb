// 02-AGE linha 49: a prioridade legal escolhida na marcação acompanha o paciente na chegada. Ao ligar a senha ao
// agendamento, a senha passa ao grupo da marcação quando ele é mais forte (menor peso) que o da senha, ou quando a
// senha é normal; a senha que já é mais forte (ex.: acima de 80 anos no balcão) fica como está. Grupo desativado no
// cadastro não vale. Desfazer a chegada devolve o grupo anterior da senha, desde que ele não tenha mudado depois.

/** O grupo legal como a regra precisa: id, peso do cadastro (menor chama antes) e se está ativo. */
export interface GrupoLegalNaChegada {
  readonly id: number;
  readonly peso: number;
  readonly ativo: boolean;
}

export interface GrupoDaSenhaNaChegada {
  /** O grupo que a senha deve ter depois da chegada (null: normal). */
  readonly grupo: number | null;
  /** true quando a senha muda de grupo por causa da marcação. */
  readonly mudou: boolean;
}

/** O grupo da senha depois da chegada do agendado. */
export function grupoDaSenhaNaChegada(e: {
  readonly senha: GrupoLegalNaChegada | null;
  readonly marcacao: GrupoLegalNaChegada | null;
}): GrupoDaSenhaNaChegada {
  const daSenha = e.senha?.id ?? null;
  const m = e.marcacao;
  if (!m || !m.ativo || m.id === daSenha) return { grupo: daSenha, mudou: false };
  if (e.senha && e.senha.ativo && e.senha.peso <= m.peso) return { grupo: daSenha, mudou: false };
  return { grupo: m.id, mudou: true };
}

/**
 * O grupo da senha ao desfazer a chegada: volta ao anterior quando a chegada o trocou e a senha ainda está no grupo
 * que a chegada aplicou; senão a senha fica como está (null: nada a alterar).
 */
export function grupoDaSenhaAoDesfazer(e: {
  readonly atual: number | null;
  readonly aplicadoNaChegada: number | null | undefined;
  readonly anteriorNaChegada: number | null | undefined;
}): { readonly grupo: number | null } | null {
  if (e.aplicadoNaChegada === null || e.aplicadoNaChegada === undefined) return null;
  if (e.atual !== e.aplicadoNaChegada) return null;
  return { grupo: e.anteriorNaChegada ?? null };
}
