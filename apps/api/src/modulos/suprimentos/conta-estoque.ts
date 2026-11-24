// Motor estoque → conta (F3.0): a saída de estoque ao paciente (dispensação da farmácia, consumo por paciente nos
// suprimentos) lança o item na conta do paciente na mesma transação do lançamento do razão do estoque, e a devolução
// reduz ou estorna o item. As regras (preço e estorno) são de @sgh/contratos/regras-faturamento (estoque-conta); aqui
// ficam as leituras sob trava e as escritas.
// Contrato de efeito:
//   - saída: conta_hospitalar_item (item faturável do produto, quantidade cobrada, preço vigente pela conta, lote,
//     setor, centro de custo, movimento_estoque_id = o lançamento de saída, tipo_valorizacao 'tabela', situação
//     'lancado'), conta_hospitalar_item_memoria ('inclusao', com os passos do preço) e movimento_estoque
//     .conta_hospitalar_item_id apontando o item; a conta fica "não calculada" (calculada = FALSE);
//   - devolução: o item reduzido na proporção (ou 'estornado', devolvido tudo), a memória ('alteracao' ou 'exclusao') e
//     o lançamento de entrada apontando o item;
//   - sem conta aberta para o atendimento, ou produto sem item faturável: nada na conta (o lançamento fica faturável sem
//     item, para o lançamento tardio); a falta de preço lança com valor zero e a regra "sem_preco" na memória.
// Ids grandes (material próprio do hospital com id >= 10^12) passam como número inteiro exato (abaixo de 2^53).
import {
  estornoDoItemDeEstoque,
  precoDoItemDeEstoque,
  SITUACOES_CONTA_LANCAVEL,
  type BasePrecoReferencia,
} from '@sgh/contratos/regras-faturamento';
import { recusa, type TxOperacao } from '@sgh/nucleo';
import { vinculoReferenciaDaConta } from './vinculo-referencia-preco.js';

/** As tabelas que o lançamento na conta grava (somar às da operação que movimenta o estoque). */
export const TABELAS_CONTA_ESTOQUE = [
  'conta_hospitalar',
  'conta_hospitalar_item',
  'conta_hospitalar_item_memoria',
  'movimento_estoque',
] as const;

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const idOuNulo = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const numOuNulo = idOuNulo;
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';
const dataIso = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10);

export interface SaidaParaConta {
  /** O lançamento de saída no razão (acabado de incluir, versão 1). */
  readonly movimento: number;
  readonly atendimento: number | null;
  readonly insumo: number;
  /** Na unidade de estoque. */
  readonly quantidade: number;
  readonly lote: number | null;
  readonly setor?: number | null;
  readonly centroCusto?: number | null;
  readonly solicitante?: number | null;
  readonly realizadoEm: Date;
  /** Data civil do consumo (AAAA-MM-DD), a data-base do preço. */
  readonly dataBase: string;
}

export interface DevolucaoParaConta {
  /** O lançamento de saída que o produto devolvido deixou. */
  readonly movimentoSaida: number;
  /** O lançamento de entrada da devolução (acabado de incluir, versão 1). */
  readonly movimentoDevolucao: number;
  /** Na unidade de estoque. */
  readonly quantidade: number;
}

/** O lançador do estoque na conta numa transação do Executor (estabelecimento e usuário da sessão). */
export function lancadorContaEstoque(tx: TxOperacao, est: number, usuario: number) {
  const memoria = (
    item: number,
    operacao: string,
    valores: Readonly<Record<string, unknown>>,
    dados: unknown,
  ) =>
    tx.incluir('conta_hospitalar_item_memoria', {
      conta_hospitalar_item_id: item,
      operacao,
      dados: JSON.stringify(dados),
      ocorrido_em: new Date(),
      usuario_id: usuario,
      ...valores,
    });

  /** A conta aberta do atendimento (travada: a sequência do item e o recálculo se enfileiram aqui), ou null. */
  const contaAberta = async (atendimento: number): Promise<Linha | null> => {
    const [c] = await tx.consultarParaAtualizar<Linha>(
      `SELECT c.id, c.versao, c.situacao, c.calculada, c.fonte_pagadora_id, c.plano_fonte_pagadora_id, c.tipo_conta_id,
              c.tabela_preco_id, tp.preco_referencia, tp.referencia AS tabela_referencia
         FROM conta_hospitalar c LEFT JOIN tabela_preco tp ON tp.id = c.tabela_preco_id
        WHERE c.atendimento_id = ? AND c.estabelecimento_id = ? AND c.excluido_em IS NULL
          AND c.situacao IN (${SITUACOES_CONTA_LANCAVEL.map(() => '?').join(', ')})
        ORDER BY (c.tipo_cobranca = 'total') DESC, c.id DESC LIMIT 1`,
      [atendimento, est, ...SITUACOES_CONTA_LANCAVEL],
    );
    return c ?? null;
  };

  /** O item faturável do produto: o do cadastro do insumo, senão o item faturável ativo que aponta o insumo. */
  const itemFaturavelDo = async (insumo: number): Promise<Linha | null> =>
    (await tx.uma<Linha>(
      `SELECT f.id, f.grupo_faturamento_id, f.item_referencia_matmed_id
         FROM insumo i JOIN item_faturavel f ON f.id = i.item_faturavel_id AND f.excluido_em IS NULL AND f.situacao = 'ativo'
        WHERE i.id = ?
       UNION ALL
       SELECT f.id, f.grupo_faturamento_id, f.item_referencia_matmed_id FROM item_faturavel f
        WHERE f.insumo_id = ? AND f.excluido_em IS NULL AND f.situacao = 'ativo'
       LIMIT 1`,
      [insumo, insumo],
    )) ?? null;

  async function lancarSaida(s: SaidaParaConta): Promise<number | null> {
    if (s.atendimento === null) return null;
    const conta = await contaAberta(s.atendimento);
    if (!conta) return null;
    const fat = await itemFaturavelDo(s.insumo);
    if (!fat) return null;
    const data = s.dataBase.slice(0, 10);
    // A referência de mercado: o vínculo vigente do insumo (um por publicação; o da referência do item faturável, senão o
    // da publicação da tabela de preço da conta), com o fator; a referência do item faturável só sem vínculo vigente.
    const vinculo = await vinculoReferenciaDaConta(tx, s.insumo, data, {
      referenciaDoFaturavel: idOuNulo(fat['item_referencia_matmed_id']),
      fonteDaTabela: conta['tabela_referencia'] == null ? null : String(conta['tabela_referencia']),
    });
    const refId = vinculo?.referencia ?? idOuNulo(fat['item_referencia_matmed_id']);
    const fatorConversao = vinculo?.fator ?? null;
    const negociados = await tx.consultar<Linha>(
      `SELECT id, plano_fonte_pagadora_id, contrato_fonte_pagadora_id, tipo_conta_id, tabela_preco_id, unidade_medida_id,
              vigencia_inicio, vigencia_fim, valor_unitario, percentual_ajuste, quantidade_fixa
         FROM preco_negociado_matmed
        WHERE fonte_pagadora_id = ? AND item_faturavel_id = ? AND ativo AND vigencia_inicio <= ?`,
      [n(conta['fonte_pagadora_id']), n(fat['id']), data],
    );
    // Os contratos dos negociados (situação e vigência) e o fator de cada unidade de negociado para a de estoque.
    const idsContrato = [
      ...new Set(
        negociados
          .map((x) => idOuNulo(x['contrato_fonte_pagadora_id']))
          .filter((x): x is number => x !== null),
      ),
    ];
    const contratos = idsContrato.length
      ? await tx.consultar<Linha>(
          `SELECT id, situacao, vigencia_inicio, vigencia_fim FROM contrato_fonte_pagadora
            WHERE id IN (${idsContrato.map(() => '?').join(', ')}) AND excluido_em IS NULL`,
          idsContrato,
        )
      : [];
    const idsUnidade = [
      ...new Set(
        negociados.map((x) => idOuNulo(x['unidade_medida_id'])).filter((x): x is number => x !== null),
      ),
    ];
    const fatorDaUnidade = new Map<number, number>();
    if (idsUnidade.length) {
      const ins = await tx.uma<Linha>('SELECT estoque_unidade_medida_id FROM insumo WHERE id = ?', [
        s.insumo,
      ]);
      const unidadeRef =
        refId === null
          ? null
          : await tx.uma<Linha>('SELECT unidade_medida_id FROM item_referencia_matmed WHERE id = ?', [refId]);
      const doInsumo = await tx.consultar<Linha>(
        `SELECT unidade_medida_id, fator_conversao FROM insumo_unidade
          WHERE insumo_id = ? AND ativo AND excluido_em IS NULL AND unidade_medida_id IN (${idsUnidade.map(() => '?').join(', ')})`,
        [s.insumo, ...idsUnidade],
      );
      for (const u of idsUnidade) {
        const cadastro = doInsumo.find((x) => n(x['unidade_medida_id']) === u);
        if (u === idOuNulo(ins?.['estoque_unidade_medida_id'])) fatorDaUnidade.set(u, 1);
        else if (cadastro && n(cadastro['fator_conversao']) > 0)
          fatorDaUnidade.set(u, n(cadastro['fator_conversao']));
        else if (u === idOuNulo(unidadeRef?.['unidade_medida_id']))
          fatorDaUnidade.set(u, fatorConversao ?? 1);
      }
    }
    const referencias =
      refId === null
        ? []
        : await tx.consultar<Linha>(
            `SELECT p.id, p.vigencia_inicio, p.preco_fabrica, p.preco_maximo_consumidor, r.fator_divisao
               FROM preco_referencia_matmed p JOIN item_referencia_matmed r ON r.id = p.item_referencia_matmed_id
              WHERE p.item_referencia_matmed_id = ? AND p.operacao <> 'exclusao' AND p.vigencia_inicio <= ?`,
            [refId, data],
          );
    const base = conta['preco_referencia'];
    const preco = precoDoItemDeEstoque({
      dataBase: data,
      quantidade: s.quantidade,
      fatorConversao,
      conta: {
        plano: idOuNulo(conta['plano_fonte_pagadora_id']),
        tipoConta: idOuNulo(conta['tipo_conta_id']),
        tabelaPreco: idOuNulo(conta['tabela_preco_id']),
        basePreco: base === 'pf' || base === 'pmc' ? (base as BasePrecoReferencia) : null,
      },
      negociados: negociados.map((x) => ({
        id: n(x['id']),
        plano: idOuNulo(x['plano_fonte_pagadora_id']),
        contrato: idOuNulo(x['contrato_fonte_pagadora_id']),
        unidade: idOuNulo(x['unidade_medida_id']),
        fatorUnidade:
          idOuNulo(x['unidade_medida_id']) === null
            ? null
            : (fatorDaUnidade.get(n(x['unidade_medida_id'])) ?? null),
        tipoConta: idOuNulo(x['tipo_conta_id']),
        tabelaPreco: idOuNulo(x['tabela_preco_id']),
        vigenciaInicio: dataIso(x['vigencia_inicio']),
        vigenciaFim: x['vigencia_fim'] === null ? null : dataIso(x['vigencia_fim']),
        valorUnitario: numOuNulo(x['valor_unitario']),
        percentualAjuste: numOuNulo(x['percentual_ajuste']),
        quantidadeFixa: numOuNulo(x['quantidade_fixa']),
      })),
      contratos: contratos.map((x) => ({
        id: n(x['id']),
        situacao: String(x['situacao']),
        vigenciaInicio: dataIso(x['vigencia_inicio']),
        vigenciaFim: x['vigencia_fim'] === null ? null : dataIso(x['vigencia_fim']),
      })),
      referencias: referencias.map((x) => ({
        id: n(x['id']),
        vigenciaInicio: dataIso(x['vigencia_inicio']),
        precoFabrica: numOuNulo(x['preco_fabrica']),
        precoMaximoConsumidor: numOuNulo(x['preco_maximo_consumidor']),
        fatorDivisao: numOuNulo(x['fator_divisao']),
      })),
    });
    const lote =
      s.lote === null
        ? null
        : await tx.uma<Linha>('SELECT numero_lote, validade FROM lote_insumo WHERE id = ?', [s.lote]);
    const seq = await tx.uma<Linha>(
      'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?',
      [n(conta['id'])],
    );
    const origem = await tx.uma<Linha>(
      "SELECT id FROM origem_lancamento WHERE codigo = 'estoque' AND ativo LIMIT 1",
      [],
    );
    const item = await tx.incluir('conta_hospitalar_item', {
      conta_hospitalar_id: n(conta['id']),
      sequencia: n(seq?.['s']),
      item_faturavel_id: n(fat['id']),
      grupo_faturamento_id: idOuNulo(fat['grupo_faturamento_id']),
      origem_lancamento_id: idOuNulo(origem?.['id']),
      realizado_em: s.realizadoEm,
      quantidade: preco.quantidadeCobrada,
      valor_unitario: preco.valorUnitario,
      percentual_cobranca: 100,
      valor_total: preco.valorTotal,
      solicitante_profissional_id: s.solicitante ?? null,
      setor_funcional_id: s.setor ?? null,
      centro_custo_id: s.centroCusto ?? null,
      movimento_estoque_id: s.movimento,
      lote_insumo_id: s.lote,
      numero_lote: lote ? String(lote['numero_lote']) : null,
      validade_lote: lote && lote['validade'] ? dataIso(lote['validade']) : null,
      tipo_valorizacao: 'tabela',
      situacao: 'lancado',
      observacao:
        preco.regra === 'sem_preco' ? 'Sem preço vigente na tabela da conta: valor a conferir.' : null,
    });
    await memoria(
      item,
      'inclusao',
      {
        tabela_preco_id: idOuNulo(conta['tabela_preco_id']),
        percentual_aplicado: 100,
        valor_unitario_calculado: preco.valorUnitario,
        valor_total_calculado: preco.valorTotal,
      },
      {
        regra: preco.regra,
        negociado: preco.negociado,
        referencia: preco.referencia,
        quantidadeFixa: preco.quantidadeFixa,
        quantidadeEstoque: s.quantidade,
        movimento: s.movimento,
        passos: preco.passos,
      },
    );
    await tx.alterar('movimento_estoque', s.movimento, 1, { conta_hospitalar_item_id: item });
    if (verdadeiro(conta['calculada']))
      await tx.alterar('conta_hospitalar', n(conta['id']), n(conta['versao']), { calculada: false });
    return item;
  }

  async function estornarDevolucao(d: DevolucaoParaConta): Promise<number | null> {
    const [i] = await tx.consultarParaAtualizar<Linha>(
      `SELECT i.id, i.versao, i.situacao, i.quantidade, i.valor_unitario, i.percentual_cobranca, i.conta_hospitalar_id,
              c.situacao AS conta_situacao, c.versao AS conta_versao, c.calculada, m.quantidade_estoque AS saida
         FROM movimento_estoque m
         JOIN conta_hospitalar_item i ON i.id = m.conta_hospitalar_item_id AND i.excluido_em IS NULL
         JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id
        WHERE m.id = ? AND m.estabelecimento_id = ?`,
      [d.movimentoSaida, est],
    );
    if (!i) return null;
    const ja = await tx.uma<Linha>(
      `SELECT COALESCE(SUM(quantidade_estoque), 0) AS q FROM movimento_estoque
        WHERE conta_hospitalar_item_id = ? AND natureza = 'entrada' AND excluido_em IS NULL`,
      [n(i['id'])],
    );
    const fixa = await tx.uma<Linha>(
      `SELECT JSON_VALUE(dados, '$.quantidadeFixa') AS f FROM conta_hospitalar_item_memoria
        WHERE conta_hospitalar_item_id = ? AND operacao = 'inclusao' ORDER BY id LIMIT 1`,
      [n(i['id'])],
    );
    const r = estornoDoItemDeEstoque({
      situacaoConta: String(i['conta_situacao']),
      situacaoItem: String(i['situacao']),
      quantidadeItem: n(i['quantidade']),
      valorUnitario: n(i['valor_unitario']),
      percentualCobranca: n(i['percentual_cobranca']),
      quantidadeFixa: String(fixa?.['f'] ?? '') === 'true',
      quantidadeSaida: n(i['saida']),
      jaDevolvida: n(ja?.['q']),
      devolvida: d.quantidade,
    });
    if (r.recusa) throw recusa(r.recusa.codigo, r.recusa.mensagem, { campos: ['quantidade'] });
    const item = n(i['id']);
    await tx.alterar('conta_hospitalar_item', item, n(i['versao']), {
      quantidade: r.quantidade,
      valor_total: r.valorTotal,
      ...(r.total ? { situacao: 'estornado' } : {}),
    });
    await memoria(
      item,
      r.total ? 'exclusao' : 'alteracao',
      { valor_unitario_calculado: n(i['valor_unitario']), valor_total_calculado: r.total ? 0 : r.valorTotal },
      {
        regra: r.total ? 'estorno_devolucao' : 'reducao_devolucao',
        movimentoDevolucao: d.movimentoDevolucao,
        quantidadeDevolvida: d.quantidade,
        quantidadeAntes: n(i['quantidade']),
        quantidadeDepois: r.quantidade,
      },
    );
    await tx.alterar('movimento_estoque', d.movimentoDevolucao, 1, { conta_hospitalar_item_id: item });
    if (verdadeiro(i['calculada']))
      await tx.alterar('conta_hospitalar', n(i['conta_hospitalar_id']), n(i['conta_versao']), {
        calculada: false,
      });
    return item;
  }

  return { lancarSaida, estornarDevolucao };
}
