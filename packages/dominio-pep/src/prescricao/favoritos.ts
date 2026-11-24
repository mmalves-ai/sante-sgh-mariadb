// Favoritos do prescritor (03-PEP L107): atalhos pessoais para o item do catálogo, o protocolo ou o kit que o
// profissional usa sempre. Regra pura: o alvo casa com o tipo, o mesmo alvo não fica duas vezes ativo (reativar o
// antigo em vez de duplicar) e a ordem dos atalhos é a do prescritor, com os sem ordem no fim pelo rótulo.

/** Os tipos de favorito que a prescrição oferece (o cadastro aceita outros, como exame e diagnóstico). */
export const TIPOS_FAVORITO_PRESCRICAO = [
  'item_prescritivel',
  'protocolo_prescricao',
  'kit_prescricao',
] as const;
export type TipoFavoritoPrescricao = (typeof TIPOS_FAVORITO_PRESCRICAO)[number];

export interface FavoritoNovo {
  readonly tipo: TipoFavoritoPrescricao;
  readonly alvo: number;
  readonly rotulo: string | null;
  readonly ordem: number | null;
}

export interface FavoritoExistente {
  readonly id: number;
  readonly tipo: string;
  readonly alvo: number;
  readonly ativo: boolean;
}

/** O que fazer com o favorito pedido: incluir, reativar o antigo do mesmo alvo ou recusar. */
export type DecisaoFavorito =
  | { readonly acao: 'incluir' }
  | { readonly acao: 'reativar'; readonly id: number }
  | {
      readonly acao: 'recusar';
      readonly codigo: 'favorito-duplicado' | 'favorito-invalido';
      readonly detalhe: string;
    };

/** Teto de atalhos ativos por prescritor: a lista é para uso rápido, não um segundo catálogo. */
export const TETO_FAVORITOS_PRESCRITOR = 60;

export function decidirFavorito(
  novo: FavoritoNovo,
  existentes: readonly FavoritoExistente[],
): DecisaoFavorito {
  if (!TIPOS_FAVORITO_PRESCRICAO.includes(novo.tipo))
    return { acao: 'recusar', codigo: 'favorito-invalido', detalhe: 'Tipo de favorito fora da prescrição.' };
  if (!Number.isInteger(novo.alvo) || novo.alvo <= 0)
    return { acao: 'recusar', codigo: 'favorito-invalido', detalhe: 'Informe o item, o protocolo ou o kit.' };
  if (novo.rotulo !== null && (novo.rotulo.trim() === '' || novo.rotulo.length > 100))
    return { acao: 'recusar', codigo: 'favorito-invalido', detalhe: 'O rótulo tem de 1 a 100 caracteres.' };
  const mesmo = existentes.filter((e) => e.tipo === novo.tipo && e.alvo === novo.alvo);
  if (mesmo.some((e) => e.ativo))
    return {
      acao: 'recusar',
      codigo: 'favorito-duplicado',
      detalhe: 'Este atalho já está nos seus favoritos.',
    };
  if (existentes.filter((e) => e.ativo).length >= TETO_FAVORITOS_PRESCRITOR)
    return {
      acao: 'recusar',
      codigo: 'favorito-invalido',
      detalhe: `Limite de ${TETO_FAVORITOS_PRESCRITOR} favoritos ativos; desative um antes de incluir outro.`,
    };
  const antigo = mesmo.reduce<FavoritoExistente | null>((a, e) => (a === null || e.id > a.id ? e : a), null);
  return antigo ? { acao: 'reativar', id: antigo.id } : { acao: 'incluir' };
}

/** Ordem de exibição: pela ordem do prescritor; os sem ordem no fim, pelo rótulo. */
export function ordenarFavoritos<T extends { readonly ordem: number | null; readonly rotulo: string }>(
  lista: readonly T[],
): T[] {
  return [...lista].sort((a, b) => {
    if (a.ordem !== null && b.ordem !== null && a.ordem !== b.ordem) return a.ordem - b.ordem;
    if (a.ordem !== null && b.ordem === null) return -1;
    if (a.ordem === null && b.ordem !== null) return 1;
    return a.rotulo.localeCompare(b.rotulo, 'pt-BR');
  });
}
