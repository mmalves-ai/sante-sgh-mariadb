// Preço do item na conta: as tabelas que valem para a conta e o preço vigente na data. Fica fora de operacoes.ts para
// que a apuração automática (conta-entrada.ts) e o lançamento usem a mesma busca sem ciclo de importação (operacoes.ts
// registra as operações da apuração em OPERACOES_CONTA).
import type { Leitor } from '@sgh/nucleo';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const r2 = (x: number) => Math.round(x * 100) / 100;

/** As tabelas de preço que valem para a conta: a da própria conta, a do plano e as da fonte pagadora. */
export async function tabelasDePreco(
  l: Leitor,
  est: number,
  fonte: number,
  plano: number | null,
  daConta: number | null = null,
): Promise<number[]> {
  const ids: number[] = [];
  if (daConta !== null) ids.push(daConta);
  if (plano !== null) {
    const p = await l.uma<Linha>('SELECT tabela_preco_id FROM plano_fonte_pagadora WHERE id = ?', [plano]);
    if (p?.['tabela_preco_id']) ids.push(n(p['tabela_preco_id']));
  }
  const r = await l.consultar<Linha>(
    `SELECT id FROM tabela_preco WHERE fonte_pagadora_id = ? AND excluido_em IS NULL AND situacao = 'ativa'
        AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)
      ORDER BY estabelecimento_id IS NULL, id`,
    [fonte, est],
    { teto: 100 },
  );
  for (const x of r) if (!ids.includes(n(x['id']))) ids.push(n(x['id']));
  return ids;
}

export interface PrecoVigente {
  readonly modelo: string;
  readonly unitario: number;
  readonly honorario: number;
  readonly custoOperacional: number;
  readonly filme: number;
  readonly vigencia: string;
  readonly tabela: number;
}

/** O preço vigente do item na data, pela primeira tabela (na ordem dada) que o tem. */
export async function precoVigente(
  l: Leitor,
  tabelas: readonly number[],
  item: number,
  data: string,
): Promise<PrecoVigente | null> {
  for (const t of tabelas) {
    const v = await l.uma<Linha>(
      `SELECT pp.modelo_valor, pv.vigencia_inicio, pv.valor_honorario, pv.valor_custo_operacional, pv.valor_filme,
              pv.valor_total
         FROM preco_procedimento pp JOIN preco_procedimento_valor pv ON pv.preco_procedimento_id = pp.id
        WHERE pp.tabela_preco_id = ? AND pp.item_faturavel_id = ? AND pp.ativo = 1 AND pp.excluido_em IS NULL
          AND pv.vigencia_inicio <= ? AND pv.operacao <> 'exclusao'
          AND NOT EXISTS (SELECT 1 FROM preco_procedimento_valor z WHERE z.preco_procedimento_id = pv.preco_procedimento_id
                AND z.vigencia_inicio = pv.vigencia_inicio AND z.operacao = 'exclusao' AND z.id > pv.id)
        ORDER BY pv.vigencia_inicio DESC, pv.id DESC`,
      [t, item, data],
    );
    if (!v) continue;
    const honorario = n(v['valor_honorario']);
    const custoOperacional = n(v['valor_custo_operacional']);
    const filme = n(v['valor_filme']);
    const total = v['valor_total'] === null ? r2(honorario + custoOperacional + filme) : n(v['valor_total']);
    const vig = v['vigencia_inicio'];
    return {
      modelo: texto(v['modelo_valor']),
      unitario: total,
      honorario,
      custoOperacional,
      filme,
      vigencia: vig instanceof Date ? vig.toISOString().slice(0, 10) : texto(vig).slice(0, 10),
      tabela: t,
    };
  }
  return null;
}
