// Compras públicas depois da licitação (C2-030, 05-SUP linha 26; Lei 14.133/2021 e Lei 4.320/1964): a ata de registro
// de preços e a nota de empenho que consome o saldo dela. Regras puras; a porta própria grava o que elas decidem.
//   - Ata (Lei 14.133, art. 82 a 86): número único no estabelecimento, objeto, vigência de até 1 ano (art. 84), itens com
//     fornecedor, quantidade registrada e preço unitário, sem o mesmo item do mesmo fornecedor duas vezes. Ligada a um
//     processo, só depois da homologação e só com o que foi adjudicado: o fornecedor vencedor do item e o preço que não
//     passa do adjudicado.
//   - Empenho (Lei 4.320, art. 58 a 61): número único, um credor só (o fornecedor de todos os itens), a fonte de
//     recurso do orçamento, emissão não futura e dentro da vigência da ata, cada item com saldo bastante na ata (o saldo
//     é a quantidade registrada menos a utilizada). O total é a soma das parcelas (quantidade × preço da ata).
//   - Anulação do empenho: só do emitido, sem nada liquidado nem recebido, com motivo; o saldo volta à ata. Nada é
//     apagado: o empenho anulado fica com o motivo, quem e quando.
import { type RecusaSuprimentos, recusa, reais } from './recusa.js';

export const VIGENCIA_MAXIMA_ATA_MESES = 12;
export const SITUACOES_ATA = ['rascunho', 'vigente', 'encerrada', 'cancelada'] as const;
export type SituacaoAta = (typeof SITUACOES_ATA)[number];
export const SITUACOES_ITEM_ATA = ['ativo', 'suspenso', 'cancelado', 'esgotado'] as const;
export type SituacaoItemAta = (typeof SITUACOES_ITEM_ATA)[number];

/** Arredonda para 4 casas (quantidade da ata: DECIMAL(15,4)). */
export const qtd4 = (n: number): number => Math.round(n * 10_000) / 10_000;

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** O último dia da vigência máxima a partir do início (1 ano menos um dia: 2026-03-10 → 2027-03-09). */
export function fimMaximoVigenciaAta(inicio: string): string {
  const [a, m, d] = inicio.split('-').map(Number) as [number, number, number];
  const fim = new Date(Date.UTC(a, m - 1 + VIGENCIA_MAXIMA_ATA_MESES, d));
  // Mês mais curto (29/02 → 28/02 do ano seguinte): Date.UTC transborda para o mês seguinte; volta ao último dia.
  if (fim.getUTCDate() !== d) fim.setUTCDate(0);
  else fim.setUTCDate(fim.getUTCDate() - 1);
  return fim.toISOString().slice(0, 10);
}

export interface ItemAtaParaConferir {
  readonly insumo: number;
  readonly fornecedor: number;
  readonly quantidade: number;
  readonly valorUnitario: number;
}
/** O item adjudicado do processo homologado: o insumo, o fornecedor vencedor e o valor unitário adjudicado. */
export interface ItemAdjudicado {
  readonly insumo: number;
  readonly fornecedor: number;
  readonly valor: number;
}
export interface AtaParaConferir {
  readonly numero: string;
  readonly objeto: string;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string;
  readonly itens: readonly ItemAtaParaConferir[];
  /** O processo de origem (nulo: ata registrada sem processo do sistema, como a de outro órgão gerenciador). */
  readonly processo: { readonly etapa: string; readonly adjudicados: readonly ItemAdjudicado[] } | null;
}

/** As recusas da ata (vazio: pode registrar). A primeira é a que a tela mostra. */
export function conferirAta(a: AtaParaConferir): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (!a.numero.trim()) r.push(recusa('ata-sem-numero', 'Informe o número da ata.', ['numero']));
  if (a.objeto.trim().length < 5)
    r.push(recusa('ata-sem-objeto', 'Descreva o objeto da ata (ao menos 5 letras).', ['objeto']));
  if (!DIA.test(a.vigenciaInicio) || !DIA.test(a.vigenciaFim) || a.vigenciaFim < a.vigenciaInicio)
    r.push(
      recusa('ata-vigencia-invalida', 'O fim da vigência não pode ser antes do início.', ['vigenciaFim']),
    );
  else if (a.vigenciaFim > fimMaximoVigenciaAta(a.vigenciaInicio))
    r.push(
      recusa(
        'ata-vigencia-acima-do-prazo',
        `A vigência da ata é de até 1 ano (Lei 14.133, art. 84): o último dia possível é ${fimMaximoVigenciaAta(a.vigenciaInicio)}.`,
        ['vigenciaFim'],
      ),
    );
  if (a.itens.length === 0) r.push(recusa('ata-sem-itens', 'Inclua ao menos um item na ata.', ['itens']));
  const vistos = new Set<string>();
  for (const [k, it] of a.itens.entries()) {
    const par = `${it.insumo}:${it.fornecedor}`;
    if (vistos.has(par))
      r.push(
        recusa('ata-item-repetido', `O item ${k + 1} repete o mesmo produto do mesmo fornecedor.`, [
          `itens.${k}`,
        ]),
      );
    vistos.add(par);
    if (!(it.quantidade > 0))
      r.push(
        recusa(
          'ata-quantidade-invalida',
          `A quantidade registrada do item ${k + 1} deve ser maior que zero.`,
          [`itens.${k}.quantidade`],
        ),
      );
    if (!(it.valorUnitario >= 0))
      r.push(
        recusa('ata-valor-invalido', `O preço do item ${k + 1} não pode ser negativo.`, [
          `itens.${k}.valorUnitario`,
        ]),
      );
  }
  if (a.processo) {
    if (a.processo.etapa !== 'homologado')
      r.push(
        recusa(
          'processo-nao-homologado',
          'A ata só é registrada depois da homologação do processo (Lei 14.133, art. 82).',
          ['processo'],
        ),
      );
    else
      for (const [k, it] of a.itens.entries()) {
        const adj = a.processo.adjudicados.find((x) => x.insumo === it.insumo);
        if (!adj || adj.fornecedor !== it.fornecedor)
          r.push(
            recusa(
              'ata-item-nao-adjudicado',
              `O item ${k + 1} não foi adjudicado a este fornecedor no processo.`,
              [`itens.${k}`],
            ),
          );
        else if (it.valorUnitario > adj.valor)
          r.push(
            recusa(
              'ata-preco-acima-do-adjudicado',
              `O preço do item ${k + 1} passa do valor adjudicado (${adj.valor}).`,
              [`itens.${k}.valorUnitario`],
            ),
          );
      }
  }
  return r;
}

/** O saldo do item da ata (registrada menos utilizada). */
export const saldoItemAta = (registrada: number, utilizada: number): number =>
  Math.max(0, qtd4(registrada - utilizada));

/** A situação do item depois de usar ou devolver saldo (o suspenso e o cancelado não mudam por uso). */
export function situacaoItemAtaApos(
  atual: SituacaoItemAta,
  registrada: number,
  utilizada: number,
): SituacaoItemAta {
  if (atual === 'suspenso' || atual === 'cancelado') return atual;
  return saldoItemAta(registrada, utilizada) === 0 ? 'esgotado' : 'ativo';
}

/** O item da ata como a porta o releu na transação. */
export interface ItemAtaRelido {
  readonly id: number;
  readonly situacao: SituacaoItemAta;
  readonly fornecedor: number;
  readonly registrada: number;
  readonly utilizada: number;
  readonly valorUnitario: number;
  readonly ata: {
    readonly situacao: SituacaoAta;
    readonly vigenciaInicio: string;
    readonly vigenciaFim: string;
  };
}
export interface EmpenhoParaConferir {
  readonly numero: string;
  readonly emitidoEm: string;
  readonly hoje: string;
  readonly validoAte: string | null;
  readonly fonteRecurso: string;
  readonly itens: readonly { readonly quantidade: number; readonly ataItem: ItemAtaRelido }[];
}

/** As recusas do empenho (vazio: pode emitir). */
export function conferirEmpenho(e: EmpenhoParaConferir): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (!e.numero.trim())
    r.push(recusa('empenho-sem-numero', 'Informe o número da nota de empenho.', ['numero']));
  if (!DIA.test(e.emitidoEm) || e.emitidoEm > e.hoje)
    r.push(recusa('empenho-data-futura', 'A data de emissão do empenho não pode ser futura.', ['emitidoEm']));
  if (e.validoAte !== null && e.validoAte < e.emitidoEm)
    r.push(recusa('empenho-validade-invalida', 'A validade não pode ser antes da emissão.', ['validoAte']));
  if (!e.fonteRecurso.trim())
    r.push(
      recusa('empenho-sem-fonte', 'Informe a fonte de recurso do orçamento (Lei 4.320, art. 61).', [
        'fonteRecurso',
      ]),
    );
  if (e.itens.length === 0) r.push(recusa('empenho-sem-itens', 'Inclua ao menos um item da ata.', ['itens']));
  const credores = new Set(e.itens.map((i) => i.ataItem.fornecedor));
  if (credores.size > 1)
    r.push(
      recusa('empenho-credor-unico', 'Um empenho tem um credor só: separe os itens por fornecedor.', [
        'itens',
      ]),
    );
  const vistos = new Set<number>();
  for (const [k, it] of e.itens.entries()) {
    const a = it.ataItem;
    if (vistos.has(a.id))
      r.push(recusa('empenho-item-repetido', `O item ${k + 1} repete um item da ata.`, [`itens.${k}`]));
    vistos.add(a.id);
    if (a.ata.situacao !== 'vigente')
      r.push(recusa('ata-nao-vigente', `A ata do item ${k + 1} não está vigente.`, [`itens.${k}`]));
    else if (e.emitidoEm < a.ata.vigenciaInicio || e.emitidoEm > a.ata.vigenciaFim)
      r.push(
        recusa('empenho-fora-da-vigencia', `A emissão está fora da vigência da ata do item ${k + 1}.`, [
          'emitidoEm',
        ]),
      );
    if (a.situacao !== 'ativo')
      r.push(recusa('ata-item-indisponivel', `O item ${k + 1} da ata está ${a.situacao}.`, [`itens.${k}`]));
    if (!(it.quantidade > 0))
      r.push(
        recusa('empenho-quantidade-invalida', `A quantidade do item ${k + 1} deve ser maior que zero.`, [
          `itens.${k}.quantidade`,
        ]),
      );
    else if (qtd4(it.quantidade) > saldoItemAta(a.registrada, a.utilizada))
      r.push(
        recusa(
          'empenho-acima-do-saldo',
          `O item ${k + 1} pede ${qtd4(it.quantidade)} e a ata tem saldo de ${saldoItemAta(a.registrada, a.utilizada)}.`,
          [`itens.${k}.quantidade`],
        ),
      );
  }
  return r;
}

/** As parcelas e o total do empenho: quantidade × preço da ata, em centavos. */
export function totalEmpenho(
  itens: readonly { readonly quantidade: number; readonly valorUnitario: number }[],
): {
  itens: number[];
  total: number;
} {
  const parcelas = itens.map((i) => reais(qtd4(i.quantidade) * i.valorUnitario));
  return { itens: parcelas, total: reais(parcelas.reduce((s, x) => s + x, 0)) };
}

/** A anulação do empenho: só do emitido, sem liquidação nem recebimento, com o motivo. */
export function podeAnularEmpenho(e: {
  readonly situacao: string;
  readonly valorLiquidado: number;
  readonly quantidadeRecebida: number;
  readonly motivo: string;
}): RecusaSuprimentos | null {
  if (e.situacao !== 'emitido')
    return recusa('empenho-nao-anulavel', `O empenho está ${e.situacao}: só o emitido pode ser anulado.`);
  if (e.valorLiquidado > 0 || e.quantidadeRecebida > 0)
    return recusa(
      'empenho-com-execucao',
      'O empenho já tem liquidação ou recebimento: anule só o saldo pelo financeiro.',
    );
  if (e.motivo.trim().length < 10)
    return recusa('empenho-sem-motivo', 'Descreva o motivo da anulação (ao menos 10 letras).', ['motivo']);
  return null;
}
