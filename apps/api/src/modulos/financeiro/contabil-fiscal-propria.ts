// F3.8, 07-FIN linhas 100 e 109: o de-para contábil mantido pela tela (conta externa por evento, lado e natureza; o
// código externo do centro de custo e do credor), as regras de retenção na fonte com vigência e o título do
// recolhimento do retido, no banco próprio pelo executor do @sgh/nucleo (trilha, outbox e idempotência na mesma
// transação). As regras são do @sgh/dominio-financeiro (depara-contabil.ts, retencao-regra.ts); aqui ficam a leitura
// sob a trava e a gravação. Nada é apagado: a regra de-para sai de uso desligada (ativo = falso) e a de retenção pelo
// fim da vigência; a retenção recolhida fica ligada ao título do recolhimento.
import { centavos } from '@sgh/contratos/regras-financeiro';
import {
  conferirRecolhimento,
  conferirRegraDePara,
  conferirRegraRetencao,
  conferirEncerramento,
  EVENTOS_CONTABEIS_FINANCEIRO,
  type FatoContabil,
  fatoDaCompensacao,
  fatoDaConcessao,
  fatoDaDevolucao,
  fatoDoPagamento,
  fatosDaApropriacao,
  type FatoRetencao,
  type LadoDePara,
  MOMENTOS_RETENCAO,
  PARTICIPANTES_RETENCAO,
  type RecusaFinanceiro,
  type RegraDeParaConta,
  type RegraRetencao,
  sugerirRetencoes,
  vencimentoRecolhimento,
} from '@sgh/dominio-financeiro';
import {
  type ContextoOperacao,
  definirOperacao,
  garantirSequencia,
  type Leitor,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { dataIso, numero, texto } from './vocabulario.js';

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const id = z.number().int().positive();
const data = z.string().regex(DATA);
const dinheiro = z.number().min(0).max(999_999_999);
const pct = z.number().min(0).max(100);

function recusar(r: RecusaFinanceiro | null): void {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: r.campos } : {});
}
function estabelecimentoDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return ctx.estabelecimento;
}
const nulo = (v: unknown): number | null => (v === null || v === undefined ? null : numero(v));

// ── De-para contábil ───────────────────────────────────────────────────────────────────────────────────────────

const EVENTOS = Object.keys(EVENTOS_CONTABEIS_FINANCEIRO) as [string, ...string[]];

export const esquemaDeParaContabil = z.discriminatedUnion('tipo', [
  z
    .object({
      tipo: z.literal('conta'),
      id: id.nullable(),
      evento: z.enum(EVENTOS),
      lado: z.enum(['debito', 'credito', 'ambos']),
      natureza: id.nullable(),
      conta: z.string().trim().min(1).max(50),
      ativo: z.boolean(),
      versao: z.number().int().positive().nullable().optional(),
    })
    .strict(),
  z
    .object({
      tipo: z.literal('centro'),
      centro: id,
      codigo: z.string().trim().min(1).max(40),
      ativo: z.boolean(),
    })
    .strict(),
  z
    .object({
      tipo: z.literal('credor'),
      fornecedor: id,
      codigo: z.string().trim().min(1).max(40),
      ativo: z.boolean(),
    })
    .strict(),
]);
export type DeParaContabilEntrada = z.infer<typeof esquemaDeParaContabil>;

/** As regras de conta (evento, lado, natureza) do estabelecimento, ativas e desligadas. */
export async function regrasDePara(
  l: Leitor,
  est: number,
): Promise<(RegraDeParaConta & { versao: number })[]> {
  const linhas = await l.consultar(
    `SELECT d.id, ev.codigo AS evento, d.lado, d.natureza_financeira_id, d.codigo_conta_externa, d.ativo, d.versao
       FROM depara_conta_externa d JOIN evento_contabil ev ON ev.id = d.evento_contabil_id
      WHERE d.estabelecimento_id = ? AND d.sistema_externo_id IS NULL AND d.codigo_conta_externa IS NOT NULL
      ORDER BY ev.codigo, d.natureza_financeira_id, d.lado, d.id LIMIT 2000`,
    [est],
  );
  return linhas.map((r) => ({
    id: numero(r['id']),
    evento: texto(r['evento']),
    lado: texto(r['lado']) as LadoDePara,
    natureza: nulo(r['natureza_financeira_id']),
    conta: texto(r['codigo_conta_externa']),
    ativo: Boolean(Number(r['ativo'])),
    versao: numero(r['versao']),
  }));
}

/** O de-para completo para a tela e para o lote: contas, centros e credores com o código externo. */
export async function deParaDoEstabelecimento(l: Leitor, est: number) {
  const centros = await l.consultar(
    `SELECT c.id, c.codigo, c.nome, d.codigo_externo, d.ativo FROM centro_custo c
       LEFT JOIN depara_centro_custo_externo d ON d.centro_custo_id = c.id AND d.estabelecimento_id = ?
            AND d.sistema_externo_id IS NULL
      WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL ORDER BY c.codigo LIMIT 2000`,
    [est, est],
  );
  const credores = await l.consultar(
    `SELECT d.empresa_fornecedora_id AS id, d.codigo_externo, d.ativo FROM depara_participante_externo d
      WHERE d.estabelecimento_id = ? AND d.sistema_externo_id IS NULL AND d.tipo_participante = 'fornecedor'
      ORDER BY d.id LIMIT 5000`,
    [est],
  );
  const naturezas = await l.consultar(
    `SELECT id, codigo, descricao FROM natureza_financeira WHERE ativo = TRUE ORDER BY codigo LIMIT 3000`,
    [],
  );
  return {
    eventos: Object.entries(EVENTOS_CONTABEIS_FINANCEIRO).map(([codigo, descricao]) => ({
      codigo,
      descricao,
    })),
    regras: await regrasDePara(l, est),
    naturezas: naturezas.map((r) => ({
      id: numero(r['id']),
      codigo: texto(r['codigo']),
      descricao: texto(r['descricao']),
    })),
    centros: centros.map((r) => ({
      id: numero(r['id']),
      codigo: texto(r['codigo']),
      nome: texto(r['nome']),
      externo: r['codigo_externo'] && Number(r['ativo']) ? texto(r['codigo_externo']) : null,
    })),
    credores: credores
      .filter((r) => Number(r['ativo']))
      .map((r) => ({ id: numero(r['id']), externo: texto(r['codigo_externo']) })),
  };
}

async function eventoContabilId(tx: TxOperacao, codigo: string): Promise<number> {
  const ev = await tx.uma<{ id: number }>('SELECT id FROM evento_contabil WHERE codigo = ?', [codigo]);
  if (ev) return Number(ev.id);
  return tx.incluir('evento_contabil', {
    codigo,
    descricao: EVENTOS_CONTABEIS_FINANCEIRO[codigo as keyof typeof EVENTOS_CONTABEIS_FINANCEIRO],
    modulo: 'financeiro',
    contabiliza: true,
    nativo: true,
  });
}

/** Cria ou altera a linha única (estabelecimento, sistema padrão, alvo) do código externo; desligar mantém a linha. */
async function manterCodigoExterno(
  tx: TxOperacao,
  tabela: 'depara_centro_custo_externo' | 'depara_participante_externo',
  filtro: string,
  alvo: number,
  est: number,
  novo: Record<string, unknown>,
  codigo: string,
  ativo: boolean,
): Promise<number> {
  const [atual] = await tx.consultarParaAtualizar(
    `SELECT id, versao FROM ${tabela} WHERE estabelecimento_id = ? AND sistema_externo_id IS NULL AND ${filtro} = ? LIMIT 1`,
    [est, alvo],
    { teto: 1 },
  );
  if (atual)
    return (
      await tx.alterar(tabela, numero(atual['id']), numero(atual['versao']), {
        codigo_externo: codigo,
        ativo,
      }),
      numero(atual['id'])
    );
  if (!ativo) throw recusa('sem-mudanca', 'Não há código externo para desligar.');
  return tx.incluir(tabela, { estabelecimento_id: est, ...novo, codigo_externo: codigo, ativo: true });
}

const manterDeParaContabil = definirOperacao<DeParaContabilEntrada, ResultadoOperacao>({
  nome: 'financeiro.manter_depara_contabil',
  tabelas: [
    'depara_conta_externa',
    'depara_centro_custo_externo',
    'depara_participante_externo',
    'evento_contabil',
  ],
  entrada: esquemaDeParaContabil as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    if (e.tipo === 'centro') {
      const c = await tx.uma('SELECT id FROM centro_custo WHERE id = ? AND estabelecimento_id = ?', [
        e.centro,
        est,
      ]);
      if (!c)
        throw recusa('centro-custo-inexistente', 'O centro de custo não é deste estabelecimento.', {
          campos: ['centro'],
        });
      const linha = await manterCodigoExterno(
        tx,
        'depara_centro_custo_externo',
        'centro_custo_id',
        e.centro,
        est,
        { centro_custo_id: e.centro },
        e.codigo,
        e.ativo,
      );
      return { tabela: 'depara_centro_custo_externo', linha, tipo: 'centro' };
    }
    if (e.tipo === 'credor') {
      const f = await tx.uma('SELECT id FROM empresa_fornecedora WHERE id = ?', [e.fornecedor]);
      if (!f) throw recusa('credor-inexistente', 'O fornecedor não existe.', { campos: ['fornecedor'] });
      const linha = await manterCodigoExterno(
        tx,
        'depara_participante_externo',
        'empresa_fornecedora_id',
        e.fornecedor,
        est,
        { tipo_participante: 'fornecedor', empresa_fornecedora_id: e.fornecedor },
        e.codigo,
        e.ativo,
      );
      return { tabela: 'depara_participante_externo', linha, tipo: 'credor' };
    }
    if (e.natureza !== null) {
      const n = await tx.uma('SELECT id FROM natureza_financeira WHERE id = ?', [e.natureza]);
      if (!n)
        throw recusa('natureza-inexistente', 'A natureza financeira não existe.', { campos: ['natureza'] });
    }
    const existentes = await regrasDePara(tx, est);
    if (e.ativo) recusar(conferirRegraDePara({ ...e, conta: e.conta.trim() }, existentes));
    const evento = await eventoContabilId(tx, e.evento);
    const valores = {
      tipo_origem: e.natureza !== null ? 'natureza_financeira' : 'evento_contabil',
      evento_contabil_id: evento,
      natureza_financeira_id: e.natureza,
      lado: e.lado,
      codigo_conta_externa: e.conta.trim(),
      ativo: e.ativo,
    };
    if (e.id !== null) {
      const atual = existentes.find((r) => r.id === e.id);
      if (!atual)
        throw recusa('nao-encontrado', 'A regra de-para não é deste estabelecimento.', { campos: ['id'] });
      await tx.alterar('depara_conta_externa', e.id, e.versao ?? atual.versao, valores);
      return { tabela: 'depara_conta_externa', linha: e.id, tipo: 'conta', antes: atual.conta };
    }
    if (!e.ativo) throw recusa('sem-mudanca', 'A regra nova entra ativa.');
    const linha = await tx.incluir('depara_conta_externa', { estabelecimento_id: est, ...valores });
    return { tabela: 'depara_conta_externa', linha, tipo: 'conta' };
  },
  alvo: (_e, r) => ({ tabela: texto(r['tabela']), id: numero(r['linha']) || null }),
});

/**
 * Os fatos do período para o lote, em partidas (depara-contabil.ts). Competência: a emissão (despesa, fornecedor pelo
 * líquido e o tributo a recolher pelo retido) e os pagamentos (ao fornecedor e da guia do retido). Caixa: o pagamento
 * da parcela como despesa paga, com o retido dela, e o pagamento da guia. A guia do retido nunca é despesa: ela baixa o
 * tributo a recolher. Título cancelado ou excluído, parcela excluída e retenção dispensada ou excluída ficam fora.
 */
export async function fatosContabeis(
  l: Leitor,
  est: number,
  de: string,
  ate: string,
  regua: 'competencia' | 'caixa',
): Promise<FatoContabil[]> {
  const guia = `EXISTS (SELECT 1 FROM retencao_titulo rr WHERE rr.recolhimento_titulo_pagar_id = t.id AND rr.excluido_em IS NULL)`;
  const valido = `t.estabelecimento_id = ? AND t.excluido_em IS NULL AND t.situacao <> 'cancelado'`;
  const retidoVivo = `r.excluido_em IS NULL AND r.retencao_dispensada = FALSE AND r.valor_retido > 0`;
  const descricao = (r: Record<string, unknown>) => ({
    historico: texto(r['referente']) || `TITULO ${texto(r['numero_documento'])}`,
    documento: texto(r['numero_documento']),
    natureza: nulo(r['natureza_financeira_id']),
    centro: nulo(r['centro_custo_id']),
    credor: nulo(r['empresa_fornecedora_id']),
  });
  /** O retido (não dispensado) por chave (título ou parcela) e tributo, com a natureza do tributo. */
  const retidosPor = async (chave: 'p.titulo_pagar_id' | 'p.id', filtro: string, p: unknown[]) => {
    const mapa = new Map<number, { tributo: string; natureza: number | null; valor: number }[]>();
    for (const r of await l.consultar(
      `SELECT ${chave} AS chave, tr.codigo, tr.natureza_financeira_id, SUM(r.valor_retido) AS valor
         FROM retencao_titulo r JOIN parcela_pagar p ON p.id = r.parcela_pagar_id
         JOIN titulo_pagar t ON t.id = p.titulo_pagar_id JOIN tributo tr ON tr.id = r.tributo_id
        WHERE ${valido} AND p.excluido_em IS NULL AND ${retidoVivo} AND ${filtro}
        GROUP BY ${chave}, tr.codigo, tr.natureza_financeira_id ORDER BY tr.codigo`,
      [est, ...p],
    )) {
      const k = numero(r['chave']);
      mapa.set(k, [
        ...(mapa.get(k) ?? []),
        {
          tributo: texto(r['codigo']),
          natureza: nulo(r['natureza_financeira_id']),
          valor: numero(r['valor']),
        },
      ]);
    }
    return mapa;
  };
  const pagas = await l.consultar(
    `SELECT p.id, DATE(p.quitada_em) AS data, p.valor_pago, t.numero_documento, t.referente, t.natureza_financeira_id,
            t.centro_custo_id, t.empresa_fornecedora_id, ${guia} AS guia,
            (SELECT COALESCE(SUM(c.valor_compensado), 0) FROM compensacao_adiantamento c
              WHERE c.parcela_pagar_id = p.id AND c.excluido_em IS NULL) AS compensado,
            (SELECT tr.natureza_financeira_id FROM retencao_titulo rr JOIN tributo tr ON tr.id = rr.tributo_id
              WHERE rr.recolhimento_titulo_pagar_id = t.id AND rr.excluido_em IS NULL ORDER BY rr.id LIMIT 1) AS natureza_tributo
       FROM parcela_pagar p JOIN titulo_pagar t ON t.id = p.titulo_pagar_id
      WHERE ${valido} AND p.excluido_em IS NULL AND p.quitada_em IS NOT NULL AND p.valor_pago > 0
        AND DATE(p.quitada_em) BETWEEN ? AND ? ORDER BY p.quitada_em, p.id LIMIT 20000`,
    [est, de, ate],
  );
  const pagamento = (r: Record<string, unknown>) => ({
    ...descricao(r),
    data: dataIso(r['data']) ?? de,
    // O que o adiantamento compensou não sai do banco: vira o fato da compensação (fatosDoAdiantamento).
    valor: centavos(numero(r['valor_pago']) - numero(r['compensado'])),
  });
  const adiantamento = await fatosDoAdiantamento(l, est, de, ate, regua);
  if (regua === 'caixa') {
    const daParcela = await retidosPor('p.id', `DATE(p.quitada_em) BETWEEN ? AND ?`, [de, ate]);
    const doCaixa = pagas.flatMap((r) => {
      const f = pagamento(r);
      if (Number(r['guia']))
        return [fatoDoPagamento({ ...f, recolhimento: { naturezaTributo: nulo(r['natureza_tributo']) } })];
      const retencoes = daParcela.get(numero(r['id'])) ?? [];
      return fatosDaApropriacao(
        { ...f, valorDespesa: centavos(f.valor + retencoes.reduce((s, x) => s + x.valor, 0)), retencoes },
        'caixa',
      );
    });
    return emOrdem([...doCaixa, ...adiantamento]);
  }
  const emitidos = await l.consultar(
    `SELECT t.id, t.data_emissao AS data, t.valor_bruto - t.valor_desconto + t.valor_acrescimo AS valor_despesa,
            t.numero_documento, t.referente, t.natureza_financeira_id, t.centro_custo_id, t.empresa_fornecedora_id
       FROM titulo_pagar t
      WHERE ${valido} AND NOT ${guia} AND t.data_emissao BETWEEN ? AND ? ORDER BY t.data_emissao, t.id LIMIT 20000`,
    [est, de, ate],
  );
  const doTitulo = await retidosPor('p.titulo_pagar_id', `t.data_emissao BETWEEN ? AND ?`, [de, ate]);
  const fatos = [
    ...emitidos.flatMap((r) =>
      fatosDaApropriacao(
        {
          ...descricao(r),
          data: dataIso(r['data']) ?? de,
          valorDespesa: numero(r['valor_despesa']),
          retencoes: doTitulo.get(numero(r['id'])) ?? [],
        },
        'competencia',
      ),
    ),
    ...pagas
      .filter((r) => pagamento(r).valor > 0)
      .map((r) =>
        fatoDoPagamento({
          ...pagamento(r),
          recolhimento: Number(r['guia']) ? { naturezaTributo: nulo(r['natureza_tributo']) } : null,
        }),
      ),
    ...adiantamento,
  ];
  return emOrdem(fatos);
}

/** Ordem do lote: pela data do fato (a emissão antes do pagamento no mesmo dia, pela ordem de montagem). */
function emOrdem(fatos: readonly FatoContabil[]): FatoContabil[] {
  return fatos
    .map((f, i) => ({ f, i }))
    .sort((x, y) => x.f.data.localeCompare(y.f.data) || x.i - y.i)
    .map((x) => x.f);
}

/**
 * F3.8, 07-FIN linha 67: o adiantamento no lote, pelo de-para por evento. A concessão paga (débito adiantamento,
 * crédito banco), a compensação na baixa do título (crédito o adiantamento; débito o fornecedor ou a despesa paga, pela
 * natureza do título) e a devolução da sobra (débito banco, crédito o adiantamento). Nenhuma conta fixa no código.
 */
async function fatosDoAdiantamento(
  l: Leitor,
  est: number,
  de: string,
  ate: string,
  regua: 'competencia' | 'caixa',
): Promise<FatoContabil[]> {
  const doAdiantamento = (r: Record<string, unknown>, data: unknown, valor: unknown) => ({
    data: dataIso(data) ?? de,
    valor: numero(valor),
    historico: `ADIANTAMENTO ${texto(r['numero'])} ${texto(r['referente'])}`.trim().slice(0, 200),
    documento: texto(r['documento']) || texto(r['numero']),
    natureza: nulo(r['natureza_financeira_id']),
    centro: nulo(r['centro_custo_id']),
    credor: nulo(r['empresa_fornecedora_id']),
  });
  const concessoes = await l.consultar(
    `SELECT a.numero, a.referente, NULL AS documento, a.natureza_financeira_id, a.centro_custo_id,
            a.empresa_fornecedora_id, a.data_pagamento, a.valor_pago
       FROM adiantamento a
      WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.valor_pago > 0
        AND a.data_pagamento BETWEEN ? AND ? ORDER BY a.data_pagamento, a.id LIMIT 20000`,
    [est, de, ate],
  );
  const compensacoes = await l.consultar(
    `SELECT a.numero, a.referente, t.numero_documento AS documento, t.natureza_financeira_id, t.centro_custo_id,
            t.empresa_fornecedora_id, c.data_compensacao, c.valor_compensado
       FROM compensacao_adiantamento c JOIN adiantamento a ON a.id = c.adiantamento_id
       JOIN parcela_pagar p ON p.id = c.parcela_pagar_id JOIN titulo_pagar t ON t.id = p.titulo_pagar_id
      WHERE a.estabelecimento_id = ? AND c.excluido_em IS NULL AND p.excluido_em IS NULL AND t.excluido_em IS NULL
        AND t.situacao <> 'cancelado' AND c.data_compensacao BETWEEN ? AND ?
      ORDER BY c.data_compensacao, c.id LIMIT 20000`,
    [est, de, ate],
  );
  // A devolução é a entrada (crédito) na conta no grupo do adiantamento (a saída é o débito do mesmo grupo).
  const devolucoes = await l.consultar(
    `SELECT a.numero, a.referente, NULL AS documento, a.natureza_financeira_id, a.centro_custo_id,
            a.empresa_fornecedora_id, m.data_movimento, m.valor
       FROM movimento_bancario m JOIN adiantamento a
         ON a.grupo_lancamento_financeiro_id = m.grupo_lancamento_financeiro_id AND a.estabelecimento_id = m.estabelecimento_id
      WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND m.natureza = 'credito' AND m.situacao = 'ativo'
        AND m.excluido_em IS NULL AND m.data_movimento BETWEEN ? AND ? ORDER BY m.data_movimento, m.id LIMIT 20000`,
    [est, de, ate],
  );
  return [
    ...concessoes.map((r) => fatoDaConcessao(doAdiantamento(r, r['data_pagamento'], r['valor_pago']))),
    ...compensacoes.map((r) =>
      fatoDaCompensacao(doAdiantamento(r, r['data_compensacao'], r['valor_compensado']), regua),
    ),
    ...devolucoes.map((r) => fatoDaDevolucao(doAdiantamento(r, r['data_movimento'], r['valor']))),
  ];
}

// ── Regras de retenção ─────────────────────────────────────────────────────────────────────────────────────────

export const esquemaRegraRetencao = z.union([
  z
    .object({
      acao: z.literal('incluir'),
      tributo: id,
      descricao: z.string().trim().min(3).max(150),
      momento: z.enum(MOMENTOS_RETENCAO),
      participante: z.enum(PARTICIPANTES_RETENCAO),
      municipio: id.nullable(),
      percentualBase: pct,
      aliquota: pct,
      faixaInicio: dinheiro.nullable(),
      faixaFim: dinheiro.nullable(),
      deducao: dinheiro,
      minimo: dinheiro,
      maximo: dinheiro.nullable(),
      codigoReceita: id.nullable(),
      vigenciaInicio: data,
      vigenciaFim: data.nullable(),
    })
    .strict(),
  z.object({ acao: z.literal('encerrar'), id, vigenciaFim: data }).strict(),
]);
export type RegraRetencaoEntrada = z.infer<typeof esquemaRegraRetencao>;

/** As regras de retenção do estabelecimento (vigentes e encerradas), com a sigla do tributo. */
export async function regrasRetencao(
  l: Leitor,
  est: number,
): Promise<
  (RegraRetencao & { descricao: string; tributoId: number; versao: number; codigoReceita: string | null })[]
> {
  const linhas = await l.consultar(
    `SELECT r.*, t.codigo AS sigla, c.codigo_receita AS receita FROM regra_retencao r JOIN tributo t ON t.id = r.tributo_id
       LEFT JOIN codigo_receita_federal c ON c.id = r.codigo_receita_federal_id
      WHERE r.estabelecimento_id = ? ORDER BY t.codigo, r.vigencia_inicio DESC, r.id LIMIT 2000`,
    [est],
  );
  return linhas.map((r) => ({
    id: numero(r['id']),
    tributoId: numero(r['tributo_id']),
    tributo: texto(r['sigla']),
    descricao: texto(r['descricao']),
    momento: texto(r['momento']) as RegraRetencao['momento'],
    participante: texto(r['tipo_participante']) as RegraRetencao['participante'],
    municipio: nulo(r['municipio_ibge_id']),
    percentualBase: numero(r['percentual_base']),
    aliquota: numero(r['aliquota']),
    faixaInicio: r['faixa_inicio'] === null ? null : numero(r['faixa_inicio']),
    faixaFim: r['faixa_fim'] === null ? null : numero(r['faixa_fim']),
    deducao: numero(r['valor_deducao']),
    minimo: numero(r['valor_minimo_retencao']),
    maximo: r['valor_maximo_retencao'] === null ? null : numero(r['valor_maximo_retencao']),
    vigenciaInicio: dataIso(r['vigencia_inicio']) ?? '',
    vigenciaFim: dataIso(r['vigencia_fim']),
    ativo: Boolean(Number(r['ativo'])),
    versao: numero(r['versao']),
    codigoReceita: r['receita'] ? texto(r['receita']) : null,
  }));
}

const manterRegraRetencao = definirOperacao<RegraRetencaoEntrada, ResultadoOperacao>({
  nome: 'financeiro.manter_regra_retencao',
  tabelas: ['regra_retencao'],
  entrada: esquemaRegraRetencao as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    // A trava: a linha do tributo serializa a inclusão e o encerramento das regras dele (duas inclusões simultâneas
    // não gravam vigências sobrepostas), e as regras do estabelecimento são relidas sob a trava.
    const tributoId =
      e.acao === 'encerrar'
        ? nulo(
            (
              await tx.consultarParaAtualizar(
                'SELECT tributo_id FROM regra_retencao WHERE id = ? AND estabelecimento_id = ?',
                [e.id, est],
              )
            )[0]?.['tributo_id'],
          )
        : e.tributo;
    if (tributoId === null)
      throw recusa('nao-encontrado', 'A regra não é deste estabelecimento.', { campos: ['id'] });
    await tx.consultarParaAtualizar('SELECT id FROM tributo WHERE id = ?', [tributoId]);
    const existentes = await regrasRetencao(tx, est);
    if (e.acao === 'encerrar') {
      const r = existentes.find((x) => x.id === e.id);
      if (!r) throw recusa('nao-encontrado', 'A regra não é deste estabelecimento.', { campos: ['id'] });
      recusar(conferirEncerramento(r, e.vigenciaFim, existentes));
      await tx.alterar('regra_retencao', r.id, r.versao, { vigencia_fim: e.vigenciaFim });
      return { regra: r.id, acao: 'encerrar' };
    }
    const t = await tx.uma<{ codigo: string }>('SELECT codigo FROM tributo WHERE id = ? AND ativo = TRUE', [
      e.tributo,
    ]);
    if (!t) throw recusa('tributo-inexistente', 'O tributo não existe.', { campos: ['tributo'] });
    if (t.codigo.toUpperCase() === 'ISS' && e.municipio === null)
      throw recusa('sem-municipio', 'A regra do ISS é do município do serviço.', { campos: ['municipio'] });
    recusar(conferirRegraRetencao({ ...e, tributo: String(t.codigo), codigoReceita: null }, existentes));
    const regra = await tx.incluir('regra_retencao', {
      estabelecimento_id: est,
      tributo_id: e.tributo,
      descricao: e.descricao,
      codigo_receita_federal_id: e.codigoReceita,
      municipio_ibge_id: e.municipio,
      tipo_participante: e.participante,
      momento: e.momento,
      percentual_base: e.percentualBase,
      aliquota: e.aliquota,
      faixa_inicio: e.faixaInicio,
      faixa_fim: e.faixaFim,
      valor_deducao: e.deducao,
      valor_minimo_retencao: e.minimo,
      valor_maximo_retencao: e.maximo,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim,
    });
    return { regra, acao: 'incluir' };
  },
  alvo: (_e, r) => ({ tabela: 'regra_retencao', id: numero(r['regra']) || null }),
});

/** A sugestão de retenção para o valor do documento, pelas regras vigentes na data (a tela mostra e o usuário confirma). */
export async function sugestaoRetencao(l: Leitor, est: number, f: FatoRetencao) {
  const regras = await regrasRetencao(l, est);
  const tributos = new Map(regras.map((r) => [r.tributo, r.tributoId]));
  return sugerirRetencoes(regras, f).map((s) => ({ ...s, tributoId: tributos.get(s.tributo) ?? 0 }));
}

// ── Recolhimento do retido ─────────────────────────────────────────────────────────────────────────────────────

export const esquemaRecolhimento = z
  .object({
    competencia: z.string().regex(/^\d{4}-\d{2}$/),
    tributo: id,
    credor: id,
    natureza: id.nullable(),
    codigoReceita: z.string().trim().max(10).nullable(),
  })
  .strict();
export type RecolhimentoEntrada = z.infer<typeof esquemaRecolhimento>;

/** O retido em aberto (sem título de recolhimento) por tributo na competência. */
export async function retidoEmAberto(l: Leitor, est: number, competencia: string) {
  const linhas = await l.consultar(
    `SELECT tr.id, tr.codigo, tr.codigo_receita, COUNT(*) AS retencoes, SUM(r.valor_retido) AS valor
       FROM retencao_titulo r JOIN parcela_pagar p ON p.id = r.parcela_pagar_id
       JOIN titulo_pagar t ON t.id = p.titulo_pagar_id JOIN tributo tr ON tr.id = r.tributo_id
      WHERE t.estabelecimento_id = ? AND r.competencia = ? AND r.excluido_em IS NULL AND t.excluido_em IS NULL
        AND t.situacao <> 'cancelado' AND p.excluido_em IS NULL AND r.retencao_dispensada = FALSE AND r.recolhimento_titulo_pagar_id IS NULL
      GROUP BY tr.id, tr.codigo, tr.codigo_receita ORDER BY tr.codigo`,
    [est, `${competencia}-01`],
  );
  return linhas.map((r) => ({
    tributo: numero(r['id']),
    sigla: texto(r['codigo']),
    codigoReceita: r['codigo_receita'] ? texto(r['codigo_receita']) : null,
    retencoes: numero(r['retencoes']),
    valor: centavos(numero(r['valor'])),
  }));
}

const gerarRecolhimento = definirOperacao<RecolhimentoEntrada, ResultadoOperacao>({
  nome: 'financeiro.gerar_recolhimento_retencao',
  tabelas: [
    'titulo_pagar',
    'parcela_pagar',
    'retencao_titulo',
    'sequencia_negocio',
    'tipo_documento_financeiro',
  ],
  entrada: esquemaRecolhimento as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const trib = await tx.uma<Record<string, unknown>>(
      'SELECT codigo, codigo_receita, dia_vencimento, natureza_financeira_id FROM tributo WHERE id = ?',
      [e.tributo],
    );
    if (!trib) throw recusa('tributo-inexistente', 'O tributo não existe.', { campos: ['tributo'] });
    const retidos = await tx.consultarParaAtualizar(
      `SELECT r.id, r.versao, r.valor_retido FROM retencao_titulo r JOIN parcela_pagar p ON p.id = r.parcela_pagar_id
         JOIN titulo_pagar t ON t.id = p.titulo_pagar_id
        WHERE t.estabelecimento_id = ? AND r.tributo_id = ? AND r.competencia = ? AND r.excluido_em IS NULL
          AND t.excluido_em IS NULL AND t.situacao <> 'cancelado' AND p.excluido_em IS NULL
          AND r.retencao_dispensada = FALSE AND r.recolhimento_titulo_pagar_id IS NULL
        ORDER BY r.id`,
      [est, e.tributo, `${e.competencia}-01`],
      { teto: 5000 },
    );
    const codigoReceita =
      e.codigoReceita?.trim() || (trib['codigo_receita'] ? texto(trib['codigo_receita']) : null);
    recusar(
      conferirRecolhimento(
        retidos.map((r) => ({ valor: numero(r['valor_retido']) })),
        codigoReceita,
      ),
    );
    const natureza = e.natureza ?? nulo(trib['natureza_financeira_id']);
    if (natureza === null)
      throw recusa('sem-natureza', 'Escolha a natureza do recolhimento (ou cadastre-a no tributo).', {
        campos: ['natureza'],
      });
    const credor = await tx.uma('SELECT id FROM empresa_fornecedora WHERE id = ?', [e.credor]);
    if (!credor)
      throw recusa('credor-inexistente', 'O órgão arrecadador (credor) não existe.', { campos: ['credor'] });
    const tc = await tx.uma<{ id: number }>("SELECT id FROM tipo_credor WHERE codigo = 'fornecedor'", []);
    if (!tc) throw recusa('sem-tipo-credor', 'Falta o tipo de credor "fornecedor" no cadastro.');
    const guia = await tx.uma<{ id: number }>(
      "SELECT id FROM tipo_documento_financeiro WHERE codigo = 'guia_recolhimento'",
      [],
    );
    const tipoDoc =
      guia?.id ??
      (await tx.incluir('tipo_documento_financeiro', {
        codigo: 'guia_recolhimento',
        descricao: 'Guia de recolhimento de tributo retido',
        sentido: 'pagar',
        nativo_sistema: true,
      }));
    const valor = centavos(retidos.reduce((s, r) => s + numero(r['valor_retido']), 0));
    const vencimento = vencimentoRecolhimento(e.competencia, nulo(trib['dia_vencimento']) ?? 20);
    const hoje = new Date().toISOString().slice(0, 10);
    await garantirSequencia(
      tx,
      { tipo: 'titulo_pagar', estabelecimento: est, prefixo: 'TP-' },
      { usuario: ctx.usuario, agora: new Date() },
    );
    const num = await tx.proximoNumero('titulo_pagar');
    const titulo = await tx.incluir('titulo_pagar', {
      estabelecimento_id: est,
      numero: num.formatado,
      tipo_credor_id: Number(tc.id),
      empresa_fornecedora_id: e.credor,
      tipo_documento_financeiro_id: Number(tipoDoc),
      numero_documento: `${codigoReceita}-${e.competencia}`.slice(0, 30),
      data_emissao: hoje,
      data_entrada: hoje,
      data_lancamento: hoje,
      valor_bruto: valor,
      valor_retencoes: 0,
      valor_liquido: valor,
      quantidade_parcelas: 1,
      natureza_financeira_id: natureza,
      referente:
        `Recolhimento ${texto(trib['codigo'])} retido ${e.competencia} (receita ${codigoReceita})`.slice(
          0,
          200,
        ),
    });
    await tx.incluir('parcela_pagar', {
      titulo_pagar_id: titulo,
      sequencia: 1,
      vencimento,
      vencimento_original: vencimento,
      valor,
      saldo: valor,
    });
    for (const r of retidos)
      await tx.alterar('retencao_titulo', numero(r['id']), numero(r['versao']), {
        recolhimento_titulo_pagar_id: titulo,
      });
    return { tituloPagar: titulo, retencoes: retidos.length, valor, vencimento, codigoReceita };
  },
  alvo: (_e, r) => ({ tabela: 'titulo_pagar', id: numero(r['tituloPagar']) || null }),
  eventos: (_e, r) => [
    { tipo: 'financeiro.titulo_pagar.lancado', carga: { titulo: numero(r['tituloPagar']), parcelas: 1 } },
  ],
});

/** As operações desta parte, pelo nome da rota. */
export const OPERACOES_CONTABIL_FISCAL = {
  'financeiro.manterDeParaContabil': manterDeParaContabil,
  'financeiro.manterRegraRetencao': manterRegraRetencao,
  'financeiro.gerarRecolhimentoRetencao': gerarRecolhimento,
} as const;
