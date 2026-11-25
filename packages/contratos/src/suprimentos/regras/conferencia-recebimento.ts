// C2-038 (05-SUP linha 21): a conferência física do recebimento. Quem recebe a entrega conta, lê lote e validade e
// aponta avaria, temperatura ou produto errado; a regra compara com o esperado (nota ou pedido) e classifica cada item.
// A conferência com qualquer divergência fica "divergente" e só é validada com a justificativa; quem valida é outra
// pessoa (segregação de funções). A validada é a que a nota de entrada pode usar (uma vez só). Nada é apagado: o
// cancelamento pede o motivo e fica na trilha.
import { recusa, qtd3, type RecusaSuprimentos } from './recusa.js';

export const DIVERGENCIAS_RECEBIMENTO = [
  'nenhuma',
  'falta',
  'sobra',
  'avaria',
  'validade',
  'lote',
  'produto_errado',
  'temperatura',
] as const;
export type DivergenciaRecebimento = (typeof DIVERGENCIAS_RECEBIMENTO)[number];

/** O que o conferente aponta na mão (as de quantidade e validade a regra calcula). */
export const APONTAMENTOS_RECEBIMENTO = ['avaria', 'lote', 'produto_errado', 'temperatura'] as const;
export type ApontamentoRecebimento = (typeof APONTAMENTOS_RECEBIMENTO)[number];

export const TIPOS_RECEBIMENTO = ['compra', 'doacao', 'consignado', 'emprestimo', 'bonificacao'] as const;
export type TipoRecebimento = (typeof TIPOS_RECEBIMENTO)[number];

export type SituacaoConferencia = 'aberta' | 'conferida' | 'divergente' | 'validada' | 'cancelada';

export interface ItemParaConferir {
  readonly item: number;
  /** Da nota ou do pedido; null na entrega sem documento (conferência às cegas). */
  readonly esperada: number | null;
  readonly conferida: number;
  readonly controlaLote: boolean;
  readonly lote?: string | null | undefined;
  /** AAAA-MM-DD. */
  readonly validade?: string | null | undefined;
  readonly apontamento?: ApontamentoRecebimento | null | undefined;
  readonly observacao?: string | null | undefined;
}

export interface ItemConferido {
  readonly item: number;
  readonly divergencia: DivergenciaRecebimento;
  readonly diferenca: number;
}

/** Validade mínima aceita no recebimento, em dias a partir de hoje (padrão de mercado: 6 meses para o almoxarifado). */
export const VALIDADE_MINIMA_PADRAO_DIAS = 180;

function dias(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
}

/** Confere a entrada da tela: itens únicos, quantidades e o que o item com lote exige. */
export function conferirItensRecebimento(itens: readonly ItemParaConferir[]): RecusaSuprimentos | null {
  if (!itens.length) return recusa('sem-itens', 'Inclua ao menos um item conferido.', ['itens']);
  const vistos = new Set<number>();
  for (const [k, i] of itens.entries()) {
    if (vistos.has(i.item))
      return recusa('item-repetido', `Item ${k + 1}: o mesmo item aparece duas vezes.`, ['itens']);
    vistos.add(i.item);
    if (!(i.conferida >= 0))
      return recusa('quantidade-invalida', `Item ${k + 1}: a quantidade conferida não pode ser negativa.`, [
        'itens',
      ]);
    if (i.controlaLote && i.conferida > 0 && (!i.lote?.trim() || !i.validade))
      return recusa('lote-obrigatorio', `Item ${k + 1}: o item controla lote: informe o lote e a validade.`, [
        'itens',
      ]);
    if (i.apontamento && !i.observacao?.trim())
      return recusa('apontamento-sem-observacao', `Item ${k + 1}: descreva o que foi encontrado.`, ['itens']);
  }
  return null;
}

/**
 * A divergência de cada item: o apontamento do conferente vale primeiro; depois a validade vencida ou abaixo da mínima;
 * depois a quantidade (falta ou sobra sobre a esperada).
 */
export function classificarRecebimento(
  itens: readonly ItemParaConferir[],
  hoje: string,
  validadeMinimaDias = VALIDADE_MINIMA_PADRAO_DIAS,
): { itens: ItemConferido[]; situacao: 'conferida' | 'divergente' } {
  const r = itens.map((i): ItemConferido => {
    const diferenca = i.esperada === null ? 0 : qtd3(i.conferida - i.esperada);
    if (i.apontamento) return { item: i.item, divergencia: i.apontamento, diferenca };
    if (i.validade && dias(hoje, i.validade) < validadeMinimaDias)
      return { item: i.item, divergencia: 'validade', diferenca };
    if (diferenca < 0) return { item: i.item, divergencia: 'falta', diferenca };
    if (diferenca > 0) return { item: i.item, divergencia: 'sobra', diferenca };
    return { item: i.item, divergencia: 'nenhuma', diferenca };
  });
  return { itens: r, situacao: r.every((x) => x.divergencia === 'nenhuma') ? 'conferida' : 'divergente' };
}

/** A validação: só a conferida ou a divergente; outra pessoa; a divergente com a justificativa. */
export function podeValidarRecebimento(
  c: { situacao: SituacaoConferencia; conferente: number | null },
  validador: number,
  justificativa: string | null | undefined,
): RecusaSuprimentos | null {
  if (c.situacao !== 'conferida' && c.situacao !== 'divergente')
    return recusa('situacao-nao-permite', 'Só a conferência concluída (conferida ou divergente) é validada.');
  if (c.conferente !== null && c.conferente === validador)
    return recusa('mesmo-conferente', 'A validação é de outra pessoa: quem conferiu não valida.');
  if (c.situacao === 'divergente' && (justificativa ?? '').trim().length < 10)
    return recusa(
      'divergencia-sem-justificativa',
      'A conferência tem divergência: escreva a justificativa da aceitação (ao menos 10 letras).',
      ['justificativa'],
    );
  return null;
}

/** O cancelamento: nunca da validada já usada pela nota; sempre com o motivo. */
export function podeCancelarRecebimento(
  c: { situacao: SituacaoConferencia; notaLigada: boolean },
  motivo: string | null | undefined,
): RecusaSuprimentos | null {
  if (c.situacao === 'cancelada') return recusa('ja-cancelada', 'A conferência já está cancelada.');
  if (c.notaLigada)
    return recusa('conferencia-usada', 'A conferência já deu entrada numa nota: estorne a nota antes.');
  if ((motivo ?? '').trim().length < 10)
    return recusa('motivo-obrigatorio', 'Escreva o motivo do cancelamento (ao menos 10 letras).', ['motivo']);
  return null;
}

/** A nota usa a conferência validada, do mesmo fornecedor e local, ainda não usada, com os itens dela. */
export function conferirNotaComRecebimento(
  c: {
    situacao: SituacaoConferencia;
    fornecedor: number;
    local: number;
    notaLigada: boolean;
    itens: readonly number[];
  },
  nota: { fornecedor: number; local: number; itens: readonly number[] },
): RecusaSuprimentos | null {
  if (c.situacao !== 'validada')
    return recusa('conferencia-nao-validada', 'A conferência física ainda não foi validada.', [
      'conferencia',
    ]);
  if (c.notaLigada)
    return recusa('conferencia-usada', 'A conferência já deu entrada em outra nota.', ['conferencia']);
  if (c.fornecedor !== nota.fornecedor || c.local !== nota.local)
    return recusa('conferencia-de-outra-entrega', 'A conferência é de outro fornecedor ou de outro local.', [
      'conferencia',
    ]);
  const fora = nota.itens.filter((i) => !c.itens.includes(i));
  if (fora.length)
    return recusa('item-nao-conferido', 'Há item da nota que não passou pela conferência física.', ['itens']);
  return null;
}
