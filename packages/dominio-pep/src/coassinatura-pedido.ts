// Pedido de coassinatura do preceptor no registro clínico do residente ou acadêmico (03-PEP L96; CFM, supervisão da
// residência médica; SBIS NGS2). O registro nasce "aguardando coassinatura" e, na mesma gravação, o pedido ao preceptor
// (primeira rodada, pendente). Só o preceptor indicado decide; coassinado o último pedido, o registro fica finalizado.
// Regra pura: sem banco nem I/O.

export const VINCULOS_SUPERVISAO = [
  'residente',
  'academico',
  'estagiario',
  'profissional_em_treinamento',
] as const;
export type VinculoSupervisao = (typeof VINCULOS_SUPERVISAO)[number];

export interface PedidoCoassinatura {
  readonly autor: number;
  readonly preceptor: number;
  /** O preceptor existe, não foi excluído e tem vínculo vigente no estabelecimento. */
  readonly preceptorVigente: boolean;
  readonly vinculo?: VinculoSupervisao;
}

export interface CoassinaturaGravavel {
  readonly situacaoRegistro: 'aguardando_coassinatura';
  readonly sequencia: 1;
  readonly situacao: 'pendente';
  readonly tipoVinculo: VinculoSupervisao;
  readonly supervisionado: number;
  readonly preceptor: number;
}

export class RecusaCoassinatura extends Error {
  constructor(
    readonly codigo: 'preceptor-e-autor' | 'preceptor-indisponivel',
    mensagem: string,
  ) {
    super(mensagem);
  }
}

/** O pedido a gravar com o registro. Recusa: o autor indicado como o próprio preceptor; preceptor sem vínculo vigente. */
export function pedidoDeCoassinatura(p: PedidoCoassinatura): CoassinaturaGravavel {
  if (p.preceptor === p.autor)
    throw new RecusaCoassinatura(
      'preceptor-e-autor',
      'O preceptor tem de ser outro profissional, não o autor do registro.',
    );
  if (!p.preceptorVigente)
    throw new RecusaCoassinatura(
      'preceptor-indisponivel',
      'O preceptor indicado não tem vínculo vigente neste estabelecimento.',
    );
  return {
    situacaoRegistro: 'aguardando_coassinatura',
    sequencia: 1,
    situacao: 'pendente',
    tipoVinculo: p.vinculo ?? 'residente',
    supervisionado: p.autor,
    preceptor: p.preceptor,
  };
}
