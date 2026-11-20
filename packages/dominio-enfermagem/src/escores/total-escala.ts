// Total das escalas (ficha do M45, regra 3; cap-11 §11.1, "Total das escalas"): no formulário novo e na tela de escores,
// o total é SEMPRE calculado (o digitado é ignorado). No formulário do prontuário em uso, o sistema PROPÕE o total pelos
// itens respondidos e o profissional o CONFIRMA; o confirmado vai para a mesma resposta que o formulário de origem
// gravaria. Confirmar um valor diferente do proposto exige a justificativa (o registro guarda os dois).
export interface PropostaTotal {
  readonly proposto: number | null;
  /** Itens sem resposta: sem todos, não há proposta (o profissional soma e justifica). */
  readonly faltam: readonly string[];
}

export function propostaDeTotal(
  itens: readonly { readonly codigo: string; readonly pontos: number | null }[],
): PropostaTotal {
  const faltam = itens.filter((i) => i.pontos === null || !Number.isFinite(i.pontos)).map((i) => i.codigo);
  if (faltam.length || itens.length === 0) return { proposto: null, faltam };
  return { proposto: itens.reduce((a, i) => a + (i.pontos ?? 0), 0), faltam: [] };
}

export type ConferenciaTotal =
  | { readonly ok: true; readonly total: number; readonly divergente: boolean }
  | {
      readonly ok: false;
      readonly codigo: 'total-sem-confirmacao' | 'total-divergente-sem-justificativa';
      readonly mensagem: string;
    };

/** O total confirmado pelo profissional no formulário em uso (o que vai para a resposta de total). */
export function conferirTotalConfirmado(c: {
  readonly proposta: PropostaTotal;
  readonly confirmado: number | null;
  readonly justificativa?: string | null;
}): ConferenciaTotal {
  if (c.confirmado === null || !Number.isFinite(c.confirmado))
    return {
      ok: false,
      codigo: 'total-sem-confirmacao',
      mensagem: 'Confirme o total proposto da escala (ou informe o total com a justificativa).',
    };
  const divergente = c.proposta.proposto === null || c.proposta.proposto !== c.confirmado;
  if (divergente && (c.justificativa ?? '').trim().length < 10)
    return {
      ok: false,
      codigo: 'total-divergente-sem-justificativa',
      mensagem:
        c.proposta.proposto === null
          ? 'Faltam itens respondidos: o total informado exige a justificativa (10 caracteres ou mais).'
          : `O total informado (${c.confirmado}) é diferente do proposto (${c.proposta.proposto}): justifique (10 caracteres ou mais).`,
    };
  return { ok: true, total: c.confirmado, divergente };
}

/** No formulário novo e na tela: o total recalculado dos itens, ignorando o que vier digitado. */
export function totalSempreCalculado(itens: Readonly<Record<string, number>>): number {
  return Object.values(itens).reduce((a, b) => a + b, 0);
}
