// O exame pedido na conta do paciente (F3.5, 05-SADT linha 4), na transação de quem chama. A regra é a pura de
// @sgh/dominio-sadt (exame/conta.ts); aqui ficam a leitura e a gravação. Contrato de efeito:
//   - lançar: cada exame pedido ainda não cobrado vira um `conta_hospitalar_item` na conta aberta do atendimento (a da
//     fonte da requisição primeiro), pelo preço vigente das tabelas da conta, com a memória
//     (`conta_hospitalar_item_memoria`, regra "exame_pedido" e o exame_item); o exame fica `faturado` e a conta com os
//     totais refeitos e "não calculada". Sem item cobrável, sem conta ou sem preço o exame segue pedido e a falta volta
//     como pendência (nada é lançado para ele);
//   - estornar: o item da conta do exame cancelado fica 'estornado' (nunca apagado) com a memória da exclusão e o
//     motivo; os totais da conta são refeitos. Motivo que não tira da conta mantém a cobrança.
import { SITUACOES_CONTA_LANCAVEL } from '@sgh/contratos/regras-faturamento';
import { cobrancaDoExame, estornoDoExameNaConta, type PendenciaCobrancaExame } from '@sgh/dominio-sadt';
import type { TxOperacao } from '@sgh/nucleo';
import { totalDosItens } from '../../faturamento/operacoes.js';
import { precoVigente, tabelasDePreco } from '../../faturamento/public-api.js';

export const TABELAS_CONTA_PEDIDO = [
  'conta_hospitalar',
  'conta_hospitalar_item',
  'conta_hospitalar_item_memoria',
] as const;

export const REGRA_EXAME_PEDIDO = 'exame_pedido';

export interface CobrancaDoItem {
  /** O exame_item. */
  readonly item: number;
  readonly exame: string;
  /** O item lançado na conta (nulo: ficou pendente). */
  readonly contaItem: number | null;
  readonly pendencia: PendenciaCobrancaExame | null;
  readonly mensagem: string | null;
}

export interface CobrancaDoPedido {
  readonly conta: number | null;
  readonly itens: readonly CobrancaDoItem[];
}

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const marcas = SITUACOES_CONTA_LANCAVEL.map(() => '?').join(', ');

/** Refaz os totais da conta a partir dos itens (sem gatilho) e a deixa "não calculada". */
async function refazerTotais(tx: TxOperacao, conta: number): Promise<void> {
  const [c] = await tx.consultarParaAtualizar<Linha>(
    'SELECT versao FROM conta_hospitalar WHERE id = ?',
    [conta],
    { teto: 1 },
  );
  const t = await totalDosItens(tx, conta);
  await tx.alterar('conta_hospitalar', conta, n(c?.['versao']), {
    valor_itens: t.valor_itens,
    valor_filme: t.valor_filme,
    valor_total: t.valor_total,
    calculada: false,
  });
}

/**
 * Lança na conta os exames ainda não cobrados de uma requisição ou de todo o atendimento (os pendentes de antes:
 * conta aberta depois, preço cadastrado depois). `hoje` é o dia do estabelecimento (a data do preço).
 */
export async function lancarExamesNaConta(
  tx: TxOperacao,
  est: number,
  alvo: { readonly requisicao: number } | { readonly atendimento: number },
  hoje: string,
): Promise<CobrancaDoPedido> {
  const porRequisicao = 'requisicao' in alvo;
  const itens = await tx.consultarParaAtualizar<Linha>(
    `SELECT ei.id, ei.versao, ei.quantidade, ei.percentual_faturamento, r.id AS requisicao, r.atendimento_id,
            r.fonte_pagadora_id, r.orcamento_particular_id, r.solicitante_profissional_id, e.item_faturavel_id, e.nome
       FROM exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
       JOIN exame e ON e.id = ei.exame_id
      WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL AND ei.excluido_em IS NULL AND ei.faturado = 0
        AND ei.situacao NOT IN ('cancelado', 'recusado')
        AND ${porRequisicao ? 'r.id = ?' : 'r.atendimento_id = ? AND r.orcamento_particular_id IS NULL'}
      ORDER BY ei.id`,
    [est, porRequisicao ? alvo.requisicao : alvo.atendimento],
    { teto: 500 },
  );
  if (!itens.length) return { conta: null, itens: [] };
  const atendimento = nn(itens[0]!['atendimento_id']);
  const agora = new Date();
  // A conta aberta do atendimento que cobre o momento do pedido: a da fonte da requisição primeiro.
  const [conta] =
    atendimento === null
      ? []
      : await tx.consultarParaAtualizar<Linha>(
          `SELECT id, fonte_pagadora_id, plano_fonte_pagadora_id, tabela_preco_id
             FROM conta_hospitalar
            WHERE atendimento_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
              AND situacao IN (${marcas}) AND inicio_em <= ? AND (fim_em IS NULL OR fim_em >= ?)
            ORDER BY (fonte_pagadora_id = ?) DESC, inicio_em DESC, id DESC LIMIT 1`,
          [atendimento, est, ...SITUACOES_CONTA_LANCAVEL, agora, agora, n(itens[0]!['fonte_pagadora_id'])],
          { teto: 1 },
        );
  const contaId = conta ? n(conta['id']) : null;
  const tabelas = conta
    ? await tabelasDePreco(
        tx,
        est,
        n(conta['fonte_pagadora_id']),
        nn(conta['plano_fonte_pagadora_id']),
        nn(conta['tabela_preco_id']),
      )
    : [];
  const origem = await tx.uma<Linha>(
    "SELECT id FROM origem_lancamento WHERE codigo = 'diagnostico' AND ativo LIMIT 1",
    [],
  );
  const usuario = tx.contexto.usuario;
  const saida: CobrancaDoItem[] = [];
  for (const i of itens) {
    const itemFat = nn(i['item_faturavel_id']);
    const preco =
      itemFat !== null && contaId !== null ? await precoVigente(tx, tabelas, itemFat, hoje) : null;
    const c = cobrancaDoExame({
      quantidade: n(i['quantidade']),
      percentual: n(i['percentual_faturamento']),
      itemCobravel: itemFat,
      contaAberta: contaId !== null,
      preco,
      doOrcamento: i['orcamento_particular_id'] !== null && i['orcamento_particular_id'] !== undefined,
    });
    const item = n(i['id']);
    const exame = texto(i['nome']);
    if (!c.lanca || contaId === null || itemFat === null || !preco) {
      saida.push({
        item,
        exame,
        contaItem: null,
        pendencia: c.lanca ? 'sem-conta' : c.pendencia,
        mensagem: c.lanca ? null : c.mensagem,
      });
      continue;
    }
    const fat = await tx.uma<Linha>('SELECT grupo_faturamento_id FROM item_faturavel WHERE id = ?', [
      itemFat,
    ]);
    const seq = await tx.uma<Linha>(
      'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?',
      [contaId],
    );
    const contaItem = await tx.incluir('conta_hospitalar_item', {
      conta_hospitalar_id: contaId,
      sequencia: n(seq?.['s']),
      item_faturavel_id: itemFat,
      grupo_faturamento_id: nn(fat?.['grupo_faturamento_id']),
      origem_lancamento_id: nn(origem?.['id']),
      realizado_em: agora,
      quantidade: c.quantidade,
      valor_unitario: c.unitario,
      percentual_cobranca: c.percentual,
      valor_honorario: c.honorario,
      valor_custo_operacional: c.custoOperacional,
      valor_filme: c.filme,
      valor_total: c.total,
      solicitante_profissional_id: nn(i['solicitante_profissional_id']),
      tipo_valorizacao: 'tabela',
      situacao: 'lancado',
      observacao: 'Exame pedido no diagnóstico.',
    });
    await tx.incluir('conta_hospitalar_item_memoria', {
      conta_hospitalar_item_id: contaItem,
      operacao: 'inclusao',
      dados: JSON.stringify({
        regra: REGRA_EXAME_PEDIDO,
        exameItem: item,
        requisicao: n(i['requisicao']),
        modeloPreco: preco.modelo,
        vigenciaPreco: preco.vigencia,
      }),
      ocorrido_em: agora,
      usuario_id: usuario,
      tabela_preco_id: preco.tabela || null,
      percentual_aplicado: c.percentual,
      valor_unitario_calculado: c.unitario,
      valor_total_calculado: c.total,
    });
    await tx.alterar('exame_item', item, n(i['versao']), { faturado: true });
    saida.push({ item, exame, contaItem, pendencia: null, mensagem: null });
  }
  if (contaId !== null && saida.some((x) => x.contaItem !== null)) await refazerTotais(tx, contaId);
  return { conta: contaId, itens: saida };
}

/**
 * O destino da cobrança do exame que está sendo cancelado. Devolve o que aconteceu, para o evento do cancelamento:
 * 'estornado' (item da conta estornado, com a memória), 'mantido' (o motivo não tira da conta) ou 'sem_lancamento'.
 * Quem chama grava `faturado = false` no exame quando o item foi estornado.
 */
export async function estornarExameDaConta(
  tx: TxOperacao,
  est: number,
  exameItem: number,
  motivo: { readonly id: number; readonly removeDaConta: boolean },
): Promise<{
  readonly destino: 'estornado' | 'mantido' | 'sem_lancamento';
  readonly contaItem: number | null;
}> {
  // O lançamento do exame: pela conta do atendimento e pelo item cobrável (índice), conferido na memória.
  const [l] = await tx.consultarParaAtualizar<Linha>(
    `SELECT i.id, i.versao, i.situacao, i.conta_hospitalar_id, c.situacao AS situacao_conta
       FROM exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
       JOIN exame e ON e.id = ei.exame_id
       JOIN conta_hospitalar c ON c.atendimento_id = r.atendimento_id AND c.estabelecimento_id = r.estabelecimento_id
        AND c.excluido_em IS NULL
       JOIN conta_hospitalar_item i ON i.conta_hospitalar_id = c.id AND i.item_faturavel_id = e.item_faturavel_id
        AND i.excluido_em IS NULL
       JOIN conta_hospitalar_item_memoria m ON m.conta_hospitalar_item_id = i.id AND m.operacao = 'inclusao'
      WHERE ei.id = ? AND r.estabelecimento_id = ?
        AND JSON_VALUE(m.dados, '$.regra') = ? AND JSON_VALUE(m.dados, '$.exameItem') = ?
      ORDER BY i.id DESC LIMIT 1`,
    [exameItem, est, REGRA_EXAME_PEDIDO, exameItem],
    { teto: 1 },
  );
  const acao = estornoDoExameNaConta({
    removeDaConta: motivo.removeDaConta,
    lancamento: l ? { situacaoItem: texto(l['situacao']), situacaoConta: texto(l['situacao_conta']) } : null,
  });
  if (!l || acao === 'nada') return { destino: 'sem_lancamento', contaItem: null };
  const contaItem = n(l['id']);
  if (acao === 'manter') return { destino: 'mantido', contaItem };
  await tx.alterar('conta_hospitalar_item', contaItem, n(l['versao']), { situacao: 'estornado' });
  await tx.incluir('conta_hospitalar_item_memoria', {
    conta_hospitalar_item_id: contaItem,
    operacao: 'exclusao',
    dados: JSON.stringify({
      regra: REGRA_EXAME_PEDIDO,
      exameItem,
      motivoCancelamentoExame: motivo.id,
    }),
    ocorrido_em: new Date(),
    usuario_id: tx.contexto.usuario,
  });
  await refazerTotais(tx, n(l['conta_hospitalar_id']));
  return { destino: 'estornado', contaItem };
}
