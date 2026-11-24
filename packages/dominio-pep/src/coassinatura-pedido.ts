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

/** Tipos do cadastro de supervisão entre profissionais (quem supervisiona quem, com vigência, por estabelecimento). */
export const VINCULOS_CADASTRO_SUPERVISAO = [
  'preceptoria',
  'titular_auxiliar',
  'academico',
  'estagio',
] as const;
export type VinculoCadastroSupervisao = (typeof VINCULOS_CADASTRO_SUPERVISAO)[number];

/**
 * A relação do autor com o preceptor no pedido, derivada do cadastro de supervisão vigente entre os dois: preceptoria é
 * residência; titular e auxiliar é profissional em treinamento. Sem cadastro, o pedido parte da indicação do autor, que
 * por padrão é residente (o preceptor confere na coassinatura).
 */
export function vinculoDoCadastro(tipo: string | null | undefined): VinculoSupervisao | undefined {
  switch (tipo) {
    case 'preceptoria':
      return 'residente';
    case 'titular_auxiliar':
      return 'profissional_em_treinamento';
    case 'academico':
      return 'academico';
    case 'estagio':
      return 'estagiario';
    default:
      return undefined;
  }
}

export interface PedidoCoassinatura {
  readonly autor: number;
  readonly preceptor: number;
  /** O preceptor existe, não foi excluído e tem vínculo vigente no estabelecimento. */
  readonly preceptorVigente: boolean;
  readonly vinculo?: VinculoSupervisao | undefined;
}

export interface CoassinaturaGravavel {
  readonly situacaoRegistro: 'aguardando_coassinatura';
  readonly sequencia: number;
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

export class RecusaNovaRodada extends Error {
  constructor(
    readonly codigo: 'rodada-pendente' | 'sem-decisao-anterior' | 'registro-coassinado',
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

export interface RodadaCoassinatura {
  readonly sequencia: number;
  readonly situacao: 'pendente' | 'coassinado' | 'ajuste_solicitado' | 'recusado' | 'cancelado';
}

/**
 * Nova rodada depois da recusa ou do pedido de ajuste: o registro segue aguardando, e o pedido seguinte (o mesmo ou
 * outro preceptor) nasce pendente na sequência seguinte. As rodadas anteriores ficam guardadas como histórico.
 * Recusa: há rodada ainda pendente; nenhuma rodada anterior foi decidida contra; o registro já foi coassinado.
 */
export function novaRodadaDeCoassinatura(
  rodadas: readonly RodadaCoassinatura[],
  p: PedidoCoassinatura,
): CoassinaturaGravavel {
  if (rodadas.some((r) => r.situacao === 'pendente'))
    throw new RecusaNovaRodada(
      'rodada-pendente',
      'Ainda há um pedido de coassinatura pendente neste registro.',
    );
  if (rodadas.some((r) => r.situacao === 'coassinado'))
    throw new RecusaNovaRodada('registro-coassinado', 'O registro já foi coassinado.');
  if (!rodadas.some((r) => r.situacao === 'recusado' || r.situacao === 'ajuste_solicitado'))
    throw new RecusaNovaRodada(
      'sem-decisao-anterior',
      'A nova rodada só cabe depois da recusa ou do pedido de ajuste do preceptor.',
    );
  const pedido = pedidoDeCoassinatura(p);
  return { ...pedido, sequencia: Math.max(...rodadas.map((r) => r.sequencia)) + 1 };
}
