// C2-038 (05-SUP linha 21): os impostos da nota de entrada por item e o custo de entrada. O hospital, em regra, não
// recupera crédito de ICMS nem de IPI: o custo é o valor dos produtos − desconto + frete + seguro + outras despesas +
// IPI + ICMS-ST (+ FCP-ST), os impostos "por fora" que a NF-e soma ao total. Os impostos "por dentro" (ICMS próprio,
// PIS e COFINS) já estão no preço. A recuperação é parâmetro do estabelecimento: o imposto recuperável não entra no custo
// (por fora) ou sai dele (por dentro) e fica marcado como crédito. Frete, seguro, outras e desconto do cabeçalho são
// rateados pelo valor dos itens; o último item fecha a diferença dos centavos para o total bater com a soma.
import { recusa, reais, type RecusaSuprimentos } from './recusa.js';

/** Os tributos destacados na NF-e de compra, pela sigla do catálogo `tributo`. */
export const TRIBUTOS_NOTA = ['ICMS', 'ICMS_ST', 'FCP_ST', 'IPI', 'PIS', 'COFINS'] as const;
export type TributoNota = (typeof TRIBUTOS_NOTA)[number];

/** Somados ao total da NF-e (por fora do preço). */
export const TRIBUTOS_POR_FORA: readonly TributoNota[] = ['ICMS_ST', 'FCP_ST', 'IPI'];

export interface ImpostoItemNota {
  readonly tributo: TributoNota;
  readonly base: number;
  /** Percentual (ex.: 18 = 18%). */
  readonly aliquota: number;
  readonly valor: number;
  /** CST ou CSOSN do XML. */
  readonly cst?: string | null | undefined;
}

export interface ItemCustoEntrada {
  readonly quantidade: number;
  readonly valorUnitario: number;
  /** Quantidade na unidade de estoque (compra × fator). */
  readonly quantidadeEstoque: number;
  readonly impostos: readonly ImpostoItemNota[];
}

export interface DespesasNota {
  readonly desconto: number;
  readonly frete: number;
  readonly seguro: number;
  readonly outros: number;
}

/** O que o estabelecimento recupera como crédito (padrão do hospital: nada). */
export interface ParametroCustoEntrada {
  readonly recuperaveis: readonly TributoNota[];
}

export const PARAMETRO_CUSTO_HOSPITAL: ParametroCustoEntrada = { recuperaveis: [] };

export interface ImpostoCalculado extends ImpostoItemNota {
  readonly compoeCusto: boolean;
  readonly recuperavel: boolean;
}

export interface CustoItemCalculado {
  readonly valorProdutos: number;
  readonly desconto: number;
  readonly frete: number;
  readonly seguro: number;
  readonly outros: number;
  /** Impostos por fora não recuperáveis somados ao custo. */
  readonly impostosNoCusto: number;
  /** Impostos por dentro recuperáveis tirados do custo. */
  readonly creditos: number;
  readonly custoTotal: number;
  readonly custoUnitario: number;
  readonly impostos: readonly ImpostoCalculado[];
}

export interface TotaisImpostosNota {
  readonly baseIcms: number;
  readonly icms: number;
  readonly baseIcmsSt: number;
  readonly icmsSt: number;
  readonly ipi: number;
  readonly porFora: number;
}

export interface CustoEntradaNota {
  readonly itens: readonly CustoItemCalculado[];
  readonly totais: TotaisImpostosNota;
  readonly valorProdutos: number;
  /** Total da NF-e: produtos − desconto + frete + seguro + outras + impostos por fora. */
  readonly valorTotal: number;
  readonly custoTotal: number;
}

/** Diferença aceita entre o valor do imposto e base × alíquota (arredondamento do emitente). */
const TOLERANCIA_IMPOSTO = 0.02;

/** Confere os impostos de um item: tributo conhecido e único, valores não negativos e valor = base × alíquota. */
export function conferirImpostosItem(
  impostos: readonly ImpostoItemNota[],
  sequencia: number,
): RecusaSuprimentos | null {
  const vistos = new Set<string>();
  for (const i of impostos) {
    if (!(TRIBUTOS_NOTA as readonly string[]).includes(i.tributo))
      return recusa(
        'imposto-desconhecido',
        `Item ${sequencia}: tributo ${i.tributo} não é da NF-e de compra.`,
        ['impostos'],
      );
    if (vistos.has(i.tributo))
      return recusa('imposto-repetido', `Item ${sequencia}: o ${i.tributo} aparece duas vezes.`, [
        'impostos',
      ]);
    vistos.add(i.tributo);
    if (i.base < 0 || i.valor < 0 || i.aliquota < 0 || i.aliquota > 100)
      return recusa(
        'imposto-invalido',
        `Item ${sequencia}: base, valor e alíquota (0 a 100%) do ${i.tributo} não podem ser negativos.`,
        ['impostos'],
      );
    // O ICMS-ST da NF-e é base × alíquota menos o ICMS próprio: a conta não fecha sozinha e não é conferida aqui.
    if (
      i.tributo !== 'ICMS_ST' &&
      i.base > 0 &&
      i.aliquota > 0 &&
      Math.abs(reais((i.base * i.aliquota) / 100) - i.valor) > TOLERANCIA_IMPOSTO
    )
      return recusa(
        'imposto-nao-confere',
        `Item ${sequencia}: o ${i.tributo} de ${i.valor.toFixed(2)} não confere com base × alíquota (${reais(
          (i.base * i.aliquota) / 100,
        ).toFixed(2)}).`,
        ['impostos'],
      );
  }
  return null;
}

/** Rateia o valor pelos pesos; o último fecha os centavos. */
export function ratear(valor: number, pesos: readonly number[]): number[] {
  const soma = pesos.reduce((s, p) => s + p, 0);
  if (!(soma > 0) || valor === 0) return pesos.map(() => 0);
  let acumulado = 0;
  return pesos.map((p, k) => {
    if (k === pesos.length - 1) return reais(valor - acumulado);
    const v = reais((valor * p) / soma);
    acumulado = reais(acumulado + v);
    return v;
  });
}

/** O custo de entrada de cada item com os impostos marcados (compõe o custo ou é crédito) e os totais da nota. */
export function custoEntradaNota(
  itens: readonly ItemCustoEntrada[],
  despesas: DespesasNota,
  parametro: ParametroCustoEntrada = PARAMETRO_CUSTO_HOSPITAL,
): CustoEntradaNota {
  const valores = itens.map((i) => reais(i.quantidade * i.valorUnitario));
  const desconto = ratear(despesas.desconto, valores);
  const frete = ratear(despesas.frete, valores);
  const seguro = ratear(despesas.seguro, valores);
  const outros = ratear(despesas.outros, valores);
  const recupera = new Set(parametro.recuperaveis);
  const calculados = itens.map((it, k): CustoItemCalculado => {
    const impostos = it.impostos.map((i): ImpostoCalculado => {
      const recuperavel = recupera.has(i.tributo);
      return { ...i, recuperavel, compoeCusto: !recuperavel };
    });
    const impostosNoCusto = reais(
      impostos
        .filter((i) => TRIBUTOS_POR_FORA.includes(i.tributo) && i.compoeCusto)
        .reduce((s, i) => s + i.valor, 0),
    );
    const creditos = reais(
      impostos
        .filter((i) => !TRIBUTOS_POR_FORA.includes(i.tributo) && i.recuperavel)
        .reduce((s, i) => s + i.valor, 0),
    );
    const custoTotal = Math.max(
      0,
      reais(valores[k]! - desconto[k]! + frete[k]! + seguro[k]! + outros[k]! + impostosNoCusto - creditos),
    );
    return {
      valorProdutos: valores[k]!,
      desconto: desconto[k]!,
      frete: frete[k]!,
      seguro: seguro[k]!,
      outros: outros[k]!,
      impostosNoCusto,
      creditos,
      custoTotal,
      custoUnitario:
        it.quantidadeEstoque > 0
          ? Math.round((custoTotal / it.quantidadeEstoque) * 1_000_000) / 1_000_000
          : 0,
      impostos,
    };
  });
  const soma = (t: TributoNota, campo: 'base' | 'valor') =>
    reais(
      itens.reduce(
        (s, it) => s + it.impostos.filter((i) => i.tributo === t).reduce((a, i) => a + i[campo], 0),
        0,
      ),
    );
  const porFora = reais(
    itens.reduce(
      (s, it) =>
        s + it.impostos.filter((i) => TRIBUTOS_POR_FORA.includes(i.tributo)).reduce((a, i) => a + i.valor, 0),
      0,
    ),
  );
  const valorProdutos = reais(valores.reduce((s, v) => s + v, 0));
  return {
    itens: calculados,
    totais: {
      baseIcms: soma('ICMS', 'base'),
      icms: soma('ICMS', 'valor'),
      baseIcmsSt: soma('ICMS_ST', 'base'),
      icmsSt: reais(soma('ICMS_ST', 'valor') + soma('FCP_ST', 'valor')),
      ipi: soma('IPI', 'valor'),
      porFora,
    },
    valorProdutos,
    valorTotal: reais(
      valorProdutos - despesas.desconto + despesas.frete + despesas.seguro + despesas.outros + porFora,
    ),
    custoTotal: reais(calculados.reduce((s, c) => s + c.custoTotal, 0)),
  };
}

/** O parâmetro do estabelecimento (0/1 por grupo) vira a lista dos recuperáveis. */
export function parametroCustoDe(p: { icms: number; ipi: number; pisCofins: number }): ParametroCustoEntrada {
  const r: TributoNota[] = [];
  if (p.icms === 1) r.push('ICMS');
  if (p.ipi === 1) r.push('IPI');
  if (p.pisCofins === 1) r.push('PIS', 'COFINS');
  return { recuperaveis: r };
}
