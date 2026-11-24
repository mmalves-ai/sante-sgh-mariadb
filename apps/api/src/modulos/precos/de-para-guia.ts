// De-para na guia (06-FAT linha 9): cada item da conta vai à fonte pagadora com o código, a descrição, a quantidade na
// unidade dela e o percentual de cobrança da equivalência que vale na data do item (item > grupo, específico > todos;
// regra em `escolherEquivalencia` e `itemNaFonte` do domínio). Sem equivalência, o item segue com o código do
// hospital. A regra de apresentação da fonte (código de apresentação, agrupamento) é aplicada depois, sobre este
// resultado. Uma leitura por conta (todas as equivalências vigentes dos itens dela).
import type { ContaTiss } from '@sgh/contratos';
import { escolherEquivalencia, itemNaFonte } from '@sgh/dominio-preco';
import type { Leitor } from '@sgh/nucleo';
import { equivalenciaDe } from './cobranca-propria.js';

/** Origem de cada item da guia, na mesma ordem dos itens da conta. */
export interface OrigemDePara {
  readonly itemId: number;
  readonly grupoId: number | null;
}

export interface ContaNaFonte {
  readonly conta: ContaTiss;
  /** Quantos itens levaram o código da fonte pagadora. */
  readonly trocados: number;
}

export async function aplicarDeParaNaConta(
  l: Leitor,
  fonte: number,
  conta: ContaTiss,
  origens: readonly OrigemDePara[],
  tipoContaId: number | null,
): Promise<ContaNaFonte> {
  if (!conta.itens.length || origens.length !== conta.itens.length) return { conta, trocados: 0 };
  const itens = [...new Set(origens.map((o) => o.itemId))];
  const grupos = [...new Set(origens.map((o) => o.grupoId ?? 0))];
  const datas = conta.itens.map((i) => i.data).sort();
  const linhas = await l.consultar(
    `SELECT * FROM equivalencia_item_fonte_pagadora
      WHERE fonte_pagadora_id = ? AND excluido_em IS NULL AND vigencia_inicio <= ?
        AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
        AND (item_faturavel_id IN (${itens.map(() => '?').join(', ')})
             OR grupo_faturamento_id IN (${grupos.map(() => '?').join(', ')}))`,
    [fonte, datas[datas.length - 1], datas[0], ...itens, ...grupos],
    { teto: 2_000 },
  );
  if (!linhas.length) return { conta, trocados: 0 };
  const candidatas = linhas.map(equivalenciaDe);
  let trocados = 0;
  const novos = conta.itens.map((it, k) => {
    const o = origens[k]!;
    const eq = escolherEquivalencia(candidatas, {
      itemId: o.itemId,
      grupoId: o.grupoId,
      planoId: null,
      planoSuperiorId: null,
      tipoContaId,
      tipoAtendimento: null,
      data: it.data,
    });
    if (!eq) return it;
    trocados++;
    const f = itemNaFonte(it, eq);
    return {
      ...it,
      codigo: f.codigo.slice(0, 10),
      descricao: f.descricao.slice(0, 150),
      quantidade: f.quantidade,
      valorUnitario: f.valorUnitario,
    };
  });
  return { conta: { ...conta, itens: novos }, trocados };
}
