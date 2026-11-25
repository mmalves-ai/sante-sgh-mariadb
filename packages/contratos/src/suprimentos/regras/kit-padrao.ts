// Kit padrão de insumos (F3.6, 05-SUP linha 13): a composição (insumo e quantidade) e os procedimentos que usam o kit.
// Regras puras: a API confere antes de gravar e a tela confere na hora, com as mesmas mensagens e os mesmos campos.
import { recusa, type RecusaSuprimentos } from './recusa.js';

export const TIPOS_KIT_PADRAO = [
  'procedimento',
  'cirurgia',
  'rotina',
  'emergencia',
  'caixa_cirurgica',
] as const;
export type TipoKitPadrao = (typeof TIPOS_KIT_PADRAO)[number];

export interface ItemKitPadraoConferido {
  readonly insumo: number;
  readonly quantidade: number;
  readonly obrigatorioRastreavel: boolean;
}

export interface ProcedimentoKitPadraoConferido {
  readonly procedimentoCirurgico: number | null;
  readonly itemFaturavel: number | null;
  readonly quantidadeKits: number;
  readonly padrao: boolean;
}

export interface KitPadraoConferido {
  readonly codigo: string;
  readonly nome: string;
  readonly tipo: TipoKitPadrao;
  readonly ativo: boolean;
  readonly itens: readonly ItemKitPadraoConferido[];
  readonly procedimentos: readonly ProcedimentoKitPadraoConferido[];
}

/** O alvo do vínculo como chave única (cirurgia ou procedimento faturável). */
export const chaveProcedimentoKit = (p: {
  readonly procedimentoCirurgico: number | null;
  readonly itemFaturavel: number | null;
}): string => (p.procedimentoCirurgico !== null ? `c${p.procedimentoCirurgico}` : `f${p.itemFaturavel ?? 0}`);

/** As recusas do kit padrão (vazio: pode gravar). */
export function conferirKitPadrao(k: KitPadraoConferido): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (!k.codigo.trim()) r.push(recusa('kit-sem-codigo', 'Informe o código do kit.', ['codigo']));
  if (!k.nome.trim()) r.push(recusa('kit-sem-nome', 'Informe o nome do kit.', ['nome']));
  if (k.ativo && k.itens.length === 0)
    r.push(recusa('kit-sem-itens', 'O kit ativo precisa de pelo menos um item.', ['itens']));
  const vistos = new Set<number>();
  for (const [i, it] of k.itens.entries()) {
    if (vistos.has(it.insumo))
      r.push(
        recusa(
          'kit-item-repetido',
          `O item da linha ${i + 1} já está no kit: some a quantidade na mesma linha.`,
          [`itens.${i}.insumo`],
        ),
      );
    vistos.add(it.insumo);
    if (!(it.quantidade > 0))
      r.push(
        recusa('kit-quantidade-invalida', `A quantidade da linha ${i + 1} deve ser maior que zero.`, [
          `itens.${i}.quantidade`,
        ]),
      );
  }
  if (k.tipo === 'emergencia' && k.itens.length > 0 && !k.itens.some((i) => i.obrigatorioRastreavel))
    r.push(
      recusa(
        'kit-emergencia-sem-obrigatorio',
        'O kit de emergência precisa de pelo menos um item obrigatório na conferência do carrinho.',
        ['itens'],
      ),
    );
  const alvos = new Set<string>();
  for (const [i, p] of k.procedimentos.entries()) {
    if ((p.procedimentoCirurgico === null) === (p.itemFaturavel === null))
      r.push(
        recusa('kit-vinculo-sem-alvo', `Escolha a cirurgia ou o procedimento da linha ${i + 1}.`, [
          `procedimentos.${i}`,
        ]),
      );
    else {
      const c = chaveProcedimentoKit(p);
      if (alvos.has(c))
        r.push(
          recusa('kit-vinculo-repetido', `O procedimento da linha ${i + 1} já está vinculado a este kit.`, [
            `procedimentos.${i}`,
          ]),
        );
      alvos.add(c);
    }
    if (!(p.quantidadeKits > 0))
      r.push(
        recusa('kit-quantidade-invalida', `A quantidade de kits da linha ${i + 1} deve ser maior que zero.`, [
          `procedimentos.${i}.quantidadeKits`,
        ]),
      );
  }
  if (!k.ativo && k.procedimentos.some((p) => p.padrao))
    r.push(
      recusa('kit-inativo-padrao', 'Um kit inativo não pode ser o padrão de um procedimento.', ['ativo']),
    );
  return r;
}

/** As mudanças da composição: o que entra, o que muda de quantidade ou marcação e o que sai (sai sem apagar). */
export function diferencaItensKit<
  A extends {
    readonly insumo: number;
    readonly quantidade: number;
    readonly obrigatorioRastreavel: boolean;
    readonly permiteSubstituto: boolean;
  },
>(
  atuais: readonly A[],
  novos: readonly A[],
): { readonly entram: A[]; readonly mudam: A[]; readonly saem: A[] } {
  const porInsumo = new Map(atuais.map((a) => [a.insumo, a]));
  const ficam = new Set(novos.map((x) => x.insumo));
  const entram: A[] = [];
  const mudam: A[] = [];
  for (const x of novos) {
    const a = porInsumo.get(x.insumo);
    if (!a) entram.push(x);
    else if (
      a.quantidade !== x.quantidade ||
      a.obrigatorioRastreavel !== x.obrigatorioRastreavel ||
      a.permiteSubstituto !== x.permiteSubstituto
    )
      mudam.push(x);
  }
  return { entram, mudam, saem: atuais.filter((a) => !ficam.has(a.insumo)) };
}

/** O kit marcado como padrão de uma cirurgia (o vínculo ativo de um kit ativo). */
export interface KitPadraoDoProcedimento {
  readonly vinculo: number;
  readonly procedimento: number;
  readonly kit: number;
  readonly quantidadeKits: number;
}

/**
 * As linhas que o kit padrão acrescenta à lista padrão de material da cirurgia, para a sugestão do gasto de sala: o
 * padrão entra como linha geral do serviço (qualquer cirurgião e anestesia), com a quantidade de kits do vínculo e sem
 * obrigatoriedade. Se a lista do procedimento já cita o mesmo kit numa linha ativa, vale a linha da lista (a
 * quantidade e a obrigatoriedade escolhidas para ela). O id da linha acrescentada é o do vínculo, negativo, para não
 * se confundir com uma linha gravada da lista.
 */
export function linhasDoKitPadrao(
  lista: readonly { readonly procedimento: number; readonly kit: number | null; readonly ativo: boolean }[],
  padroes: readonly KitPadraoDoProcedimento[],
): {
  readonly id: number;
  readonly procedimento: number;
  readonly cirurgiao: null;
  readonly tipoAnestesia: null;
  readonly insumo: null;
  readonly kit: number;
  readonly quantidade: number;
  readonly obrigatorio: false;
  readonly ativo: true;
}[] {
  const citados = new Set(
    lista.filter((l) => l.ativo && l.kit !== null).map((l) => `${l.procedimento}:${l.kit ?? 0}`),
  );
  return padroes
    .filter((p) => !citados.has(`${p.procedimento}:${p.kit}`))
    .map((p) => ({
      id: -p.vinculo,
      procedimento: p.procedimento,
      cirurgiao: null,
      tipoAnestesia: null,
      insumo: null,
      kit: p.kit,
      quantidade: p.quantidadeKits,
      obrigatorio: false,
      ativo: true,
    }));
}

/** A linha do pedido de material (requisição) na conta do kit: o item, a quantidade e o kit de onde ela veio. */
export interface LinhaPedidoKit {
  readonly item: number;
  readonly nome: string;
  readonly quantidade: number;
  readonly kit: number | null;
}

/** O teto de kits somados de uma vez ao pedido (o que passa disso é erro de digitação). */
export const MAXIMO_KITS_NO_PEDIDO = 999;

/**
 * Soma o kit padrão ao pedido de material: cada item da composição entra com a quantidade do kit × o número de kits.
 * O item que já está no pedido tem a quantidade somada (nunca vira duas linhas); a linha continua marcada com o kit
 * só quando tudo nela veio desse mesmo kit (a linha digitada à mão, ou de outro kit, fica sem a marca). Devolve
 * `null` quando o número de kits não é inteiro de 1 a 999 ou o kit não tem item.
 */
export function somarKitAoPedido(
  linhas: readonly LinhaPedidoKit[],
  kit: {
    readonly kit: number;
    readonly itens: readonly {
      readonly insumo: number;
      readonly nome: string;
      readonly quantidade: number;
    }[];
  },
  quantidadeKits: number,
): LinhaPedidoKit[] | null {
  if (!Number.isInteger(quantidadeKits) || quantidadeKits < 1 || quantidadeKits > MAXIMO_KITS_NO_PEDIDO)
    return null;
  if (kit.itens.length === 0) return null;
  const arredondar = (v: number) => Math.round(v * 10_000) / 10_000;
  const r = linhas.map((l) => ({ ...l }));
  for (const i of kit.itens) {
    const total = arredondar(i.quantidade * quantidadeKits);
    const atual = r.find((l) => l.item === i.insumo);
    if (atual) {
      atual.quantidade = arredondar(atual.quantidade + total);
      if (atual.kit !== kit.kit) atual.kit = null;
    } else r.push({ item: i.insumo, nome: i.nome, quantidade: total, kit: kit.kit });
  }
  return r;
}

/**
 * A linha do pedido que cita um kit: o kit existe no estabelecimento, está ativo e o item faz parte da composição
 * dele (a marca do kit na linha nunca aponta para um kit que não a explica). `kit` nulo é o kit não encontrado.
 */
export function conferirKitDoPedido(
  kit: { readonly ativo: boolean; readonly insumos: readonly number[] } | null,
  item: number,
  linha: number,
): RecusaSuprimentos[] {
  const campos = [`itens.${linha}.kit`];
  if (!kit)
    return [
      recusa('kit-inexistente', `O kit da linha ${linha + 1} não existe neste estabelecimento.`, campos),
    ];
  if (!kit.ativo) return [recusa('kit-inativo', `O kit da linha ${linha + 1} está inativo.`, campos)];
  if (!kit.insumos.includes(item))
    return [recusa('item-fora-do-kit', `O item da linha ${linha + 1} não faz parte do kit citado.`, campos)];
  return [];
}
