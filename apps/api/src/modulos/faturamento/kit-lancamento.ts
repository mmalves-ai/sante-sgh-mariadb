// Lançamento das linhas de um kit de cobrança na conta (06-FAT linha 16, F3.7): o mesmo caminho para o kit lançado pela
// tela de movimentos (faturamento.lancar-kit) e para o kit disparado pelo item lançado (faturamento.lancar-item, com o
// kit_cobranca.item_gatilho_id). Cada linha vira um conta_hospitalar_item com kit_cobranca_id, preço da tabela da conta
// (ou zero e "sem preço", para o faturista ajustar) e a memória do cálculo com a origem. O total da conta fica com quem
// chama (uma vez por transação). Este arquivo não importa as operações da conta (evita o ciclo com operacoes.ts).
import { type KitCobranca, kitsDoGatilho, type LinhaDoKit } from '@sgh/dominio-faturamento';
import { recusa, type TxOperacao } from '@sgh/nucleo';
import { precoVigente, tabelasDePreco } from './preco-conta.js';
import { criticarCoberturaDoItemConta } from './cobertura-item-conta.js';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const r2 = (x: number) => Math.round(x * 100) / 100;
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');

export interface ContaDoKit {
  readonly id: number;
  readonly fontePagadora: number;
  readonly plano: number | null;
  readonly tabela: number | null;
}

export type KitLido = KitCobranca & { readonly codigo: string; readonly descricao: string };

/** Lança as linhas do kit na conta; devolve os itens criados e quantos ficaram sem preço vigente. */
export async function lancarLinhasDoKit(
  tx: TxOperacao,
  est: number,
  c: ContaDoKit,
  kit: KitLido,
  linhas: readonly LinhaDoKit[],
  vezes: number,
  data: string,
  usuario: number | null,
  origem: { readonly gatilhoItem?: number | null } = {},
): Promise<{ itens: number[]; semPreco: number }> {
  const ids = [...new Set(linhas.map((x) => x.item))];
  const ativos = new Map(
    (
      await tx.consultar<Linha>(
        `SELECT id, grupo_faturamento_id FROM item_faturavel WHERE id IN (${lista(ids.length)}) AND situacao = 'ativo' AND excluido_em IS NULL`,
        ids,
        { teto: ids.length },
      )
    ).map((x) => [n(x['id']), nn(x['grupo_faturamento_id'])] as const),
  );
  if (ativos.size !== ids.length)
    throw recusa('item-inativo', `O kit ${kit.codigo} tem item inativo ou fora do catálogo: ajuste o kit.`, {
      campos: ['kitId'],
    });
  const tabelas = await tabelasDePreco(tx, est, c.fontePagadora, c.plano, c.tabela);
  const agora = new Date();
  const itens: number[] = [];
  let semPreco = 0;
  for (const linha of linhas) {
    const preco = await precoVigente(tx, tabelas, linha.item, data, {
      est,
      fonte: c.fontePagadora,
      conta: c.id,
    });
    if (!preco) semPreco += 1;
    const unitario = preco?.unitario ?? 0;
    const seq = await tx.uma<Linha>(
      'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?',
      [c.id],
    );
    // F7 (09-AREA linha 76): a cobertura da fonte pagadora antes de incluir o item (o bloqueio recusa).
    await criticarCoberturaDoItemConta(tx, est, {
      conta: c.id,
      item: linha.item,
      realizado: agora,
      quantidade: linha.quantidade,
      valorTotal: r2(unitario * linha.quantidade),
    });
    const item = await tx.incluir('conta_hospitalar_item', {
      conta_hospitalar_id: c.id,
      sequencia: n(seq?.['s']),
      item_faturavel_id: linha.item,
      grupo_faturamento_id: ativos.get(linha.item) ?? null,
      kit_cobranca_id: kit.id,
      realizado_em: agora,
      quantidade: linha.quantidade,
      valor_unitario: unitario,
      valor_honorario: preco ? r2(preco.honorario * linha.quantidade) : 0,
      valor_custo_operacional: preco ? r2(preco.custoOperacional * linha.quantidade) : 0,
      valor_filme: preco ? r2(preco.filme * linha.quantidade) : 0,
      valor_total: r2(unitario * linha.quantidade),
      tipo_valorizacao: preco ? 'tabela' : 'manual',
      situacao: 'lancado',
    });
    await tx.incluir('conta_hospitalar_item_memoria', {
      conta_hospitalar_item_id: item,
      tabela_preco_id: preco?.tabela ?? null,
      valor_unitario_calculado: unitario,
      valor_total_calculado: r2(unitario * linha.quantidade),
      preco_manual: 0,
      operacao: 'inclusao',
      dados: JSON.stringify({
        origem: origem.gatilhoItem ? 'kit_gatilho' : 'kit',
        kit: kit.codigo,
        modo: kit.modo,
        papel: linha.papel,
        vezes,
        itemGatilho: origem.gatilhoItem ?? null,
        origemPreco: preco ? 'tabela' : 'sem_preco_vigente',
        vigencia: preco?.vigencia ?? null,
      }),
      ocorrido_em: agora,
      usuario_id: usuario,
    });
    itens.push(item);
  }
  return { itens, semPreco };
}

/** Os kits ativos do estabelecimento (ou de todos) que o item dispara, com os componentes. */
async function kitsDoItem(tx: TxOperacao, est: number, item: number): Promise<KitLido[]> {
  const ks = await tx.consultar<Linha>(
    `SELECT id, codigo, descricao, ativo, modo_cobranca, item_faturavel_id, item_gatilho_id, fonte_pagadora_id,
            plano_fonte_pagadora_id
       FROM kit_cobranca
      WHERE item_gatilho_id = ? AND ativo = TRUE AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)
      ORDER BY codigo`,
    [item, est],
    { teto: 50 },
  );
  if (!ks.length) return [];
  const ids = ks.map((k) => n(k['id']));
  const cs = await tx.consultar<Linha>(
    `SELECT kit_cobranca_id, item_faturavel_id, equipamento_saude_id, quantidade FROM kit_cobranca_item
      WHERE kit_cobranca_id IN (${lista(ids.length)}) AND excluido_em IS NULL ORDER BY kit_cobranca_id, sequencia`,
    ids,
    { teto: 5000 },
  );
  return ks.map((k) => ({
    id: n(k['id']),
    codigo: txt(k['codigo']),
    descricao: txt(k['descricao']),
    ativo: Boolean(n(k['ativo'])),
    modo: txt(k['modo_cobranca']) === 'fechado' ? 'fechado' : 'aberto',
    item: nn(k['item_faturavel_id']),
    gatilho: nn(k['item_gatilho_id']),
    fontePagadora: nn(k['fonte_pagadora_id']),
    plano: nn(k['plano_fonte_pagadora_id']),
    componentes: cs
      .filter((c) => n(c['kit_cobranca_id']) === n(k['id']))
      .map((c) => ({
        item: nn(c['item_faturavel_id']),
        equipamento: nn(c['equipamento_saude_id']),
        quantidade: n(c['quantidade']),
      })),
  }));
}

/**
 * O item lançado dispara os kits dele (kitsDoGatilho): cada kit válido para a fonte e o plano da conta entra na mesma
 * transação, tantas vezes quanto a quantidade do item. Devolve os códigos dos kits lançados e quantos itens ficaram
 * sem preço. Não mexe no total da conta (quem chama recalcula).
 */
export async function dispararKitsDoItem(
  tx: TxOperacao,
  est: number,
  c: ContaDoKit,
  item: number,
  quantidade: number,
  data: string,
  usuario: number | null,
): Promise<{ kits: string[]; itens: number[]; semPreco: number }> {
  const disparados = kitsDoGatilho(await kitsDoItem(tx, est, item), item, c, quantidade);
  const kits: string[] = [];
  const itens: number[] = [];
  let semPreco = 0;
  for (const d of disparados) {
    const r = await lancarLinhasDoKit(tx, est, c, d.kit, d.linhas, quantidade, data, usuario, {
      gatilhoItem: item,
    });
    kits.push(d.kit.codigo);
    itens.push(...r.itens);
    semPreco += r.semPreco;
  }
  return { kits, itens, semPreco };
}
