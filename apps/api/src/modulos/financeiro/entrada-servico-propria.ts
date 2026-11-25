// F7, 09-AREA linha 78 (C2-094): a entrada de serviço tomado no banco próprio, pelo executor do @sgh/nucleo (trilha,
// outbox e idempotência na mesma transação). As regras são do @sgh/dominio-financeiro (entrada-servico.ts): a conferência
// contra o pedido de serviço, o câmbio, as retenções (regra vigente do estabelecimento; ISS pela nota), a conclusão e o
// cancelamento. Aqui ficam a leitura sob a trava e a gravação nas tabelas do modelo:
//   entrada_servico (cabeçalho, número de negócio ES-, situação aberta, concluída ou cancelada, título ligado);
//   entrada_servico_item (serviço, item do pedido atendido, centro de custo);
//   entrada_servico_cambio (moeda contratada, taxa e valores convertidos);
//   retencao_entrada_servico (o tributo retido rateado por item: base da R-2010 e da R-4020);
//   na conclusão, pedido_compra_item.quantidade_recebida e a situação do pedido, e a escrituração da entrada
//   (escrituracao_entrada e escrituracao_item_entrada, pendente de classificação na EFD-Contribuições).
// Nada é apagado: o cancelamento deixa a entrada "cancelada" com a justificativa, devolve o saldo ao pedido e cancela a
// escrituração. A EFD-REINF (reinf-eventos-propria.ts) lê a retenção da entrada concluída até o título confirmá-la.
import { centavos } from '@sgh/contratos/regras-financeiro';
import {
  calcularRetencoesEntrada,
  campoDoTributo,
  conferirCancelamentoEntrada,
  conferirConclusaoEntrada,
  conferirEntradaServico,
  type FatoRetencao,
  liquidoEntrada,
  type PedidoServico,
  PEDIDO_ACEITA_ENTRADA,
  type RecusaFinanceiro,
  ratear,
  totaisReinf,
  valorBrutoEntrada,
  valorDoItem,
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
import { sugestaoRetencao } from './contabil-fiscal-propria.js';
import { dataIso, instanteIso, numero, numeroOuNulo, texto } from './vocabulario.js';

const id = z.number().int().positive();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;
const valor = z.number().finite().min(0).max(9_999_999_999);
const PARTICIPANTES = [
  'pessoa_fisica',
  'pessoa_juridica',
  'cooperativa',
  'simples_nacional',
  'orgao_publico',
] as const;
/** CFOP de entrada da aquisição de serviço tributado pelo ISS (o da nota, quando informado, vence). */
const CFOP_SERVICO = '1933';
const SQL_CFOP = 'SELECT id FROM cfop WHERE codigo_cfop = ? ORDER BY id LIMIT 1';

function recusar(r: RecusaFinanceiro | null): void {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: r.campos } : {});
}
function estabelecimentoDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return ctx.estabelecimento;
}
const so = (s: unknown) => texto(s).replace(/\D/g, '');

// ── Esquemas ────────────────────────────────────────────────────────────────────────────────────────────────────

const esquemaItem = z
  .object({
    servico: id,
    pedidoItem: id.nullable().default(null),
    descricao: z.string().trim().max(2000).nullable().default(null),
    quantidade: z.number().positive().max(99_999_999),
    valorUnitario: valor,
    valorDesconto: valor.default(0),
    centroCusto: id,
    inssNaoRetido: valor.default(0),
    processoJudicial: z.string().trim().max(21).nullable().default(null),
  })
  .strict();
export const esquemaEntradaServico = z
  .object({
    fornecedor: id,
    pedido: id.nullable().default(null),
    numeroDocumento: z.string().trim().min(1).max(20),
    serie: z.string().trim().max(10).nullable().default(null),
    chaveAcesso: z.string().trim().max(50).nullable().default(null),
    dataEmissao: data,
    dataEntrada: data,
    competencia: z.string().regex(COMPETENCIA),
    municipio: id.nullable().default(null),
    participante: z.enum(PARTICIPANTES).nullable().default(null),
    issRetido: z.boolean().default(false),
    aliquotaIss: z.number().min(0).max(100).nullable().default(null),
    baseIss: valor.nullable().default(null),
    observacao: z.string().trim().max(2000).nullable().default(null),
    itens: z.array(esquemaItem).min(1).max(200),
    cambio: z
      .object({
        moeda: id,
        dataCotacao: data,
        taxa: z.number().positive().max(1_000_000),
        valorMoeda: valor,
        sugerido: z.boolean().default(true),
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();
export type EntradaServicoEntrada = z.infer<typeof esquemaEntradaServico>;
const esquemaConcluir = z
  .object({ entrada: id, versao: z.number().int().positive(), titulo: id.nullable().default(null) })
  .strict();
const esquemaCancelar = z
  .object({
    entrada: id,
    versao: z.number().int().positive(),
    justificativa: z.string().trim().min(1).max(2000),
  })
  .strict();

// ── Leituras ────────────────────────────────────────────────────────────────────────────────────────────────────

/** O pedido de serviço sob leitura (na gravação, sob a trava), com os itens de serviço e o saldo. */
async function pedidoServico(
  l: Leitor,
  est: number,
  pedido: number,
  travar = false,
): Promise<PedidoServico | null> {
  const sql = `SELECT id, empresa_fornecedora_id, situacao, natureza, versao FROM pedido_compra
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`;
  const cab = travar
    ? (await (l as TxOperacao).consultarParaAtualizar(sql, [pedido, est]))[0]
    : await l.uma(sql, [pedido, est]);
  if (!cab) return null;
  const itens = await l.consultar(
    `SELECT id, servico_contratavel_id, quantidade, quantidade_recebida, quantidade_cancelada, valor_unitario
       FROM pedido_compra_item WHERE pedido_compra_id = ? AND excluido_em IS NULL AND cancelado_em IS NULL
      ORDER BY sequencia`,
    [pedido],
  );
  return {
    id: numero(cab['id']),
    fornecedor: numero(cab['empresa_fornecedora_id']),
    situacao: texto(cab['situacao']),
    natureza: texto(cab['natureza']),
    itens: itens.map((r) => ({
      id: numero(r['id']),
      servico: numeroOuNulo(r['servico_contratavel_id']),
      quantidade: numero(r['quantidade']),
      recebida: numero(r['quantidade_recebida']),
      cancelada: numero(r['quantidade_cancelada']),
      valorUnitario: numero(r['valor_unitario']),
    })),
  };
}

/** O participante da regra de retenção pelo cadastro do fornecedor (a tela pode dizer cooperativa ou órgão público). */
const participanteDe = (r: Record<string, unknown>): FatoRetencao['participante'] =>
  texto(r['tipo_pessoa']) === 'fisica'
    ? 'pessoa_fisica'
    : Number(r['optante_simples']) === 1 || r['optante_simples'] === true
      ? 'simples_nacional'
      : 'pessoa_juridica';

/** A prévia das retenções para a tela (as mesmas regras da gravação), sem gravar. */
export async function previaRetencoesEntrada(
  l: Leitor,
  est: number,
  p: {
    fornecedor: number;
    valorBruto: number;
    dataEmissao: string;
    municipio: number | null;
    participante: FatoRetencao['participante'] | null;
    issRetido: boolean;
    aliquotaIss: number | null;
    baseIss: number | null;
    inssNaoRetido: number;
  },
) {
  const f = await l.uma('SELECT tipo_pessoa, optante_simples FROM empresa_fornecedora WHERE id = ?', [
    p.fornecedor,
  ]);
  if (!f) throw recusa('fornecedor-inexistente', 'O fornecedor não existe.', { campos: ['fornecedor'] });
  const sugestoes = await sugestaoRetencao(l, est, {
    data: p.dataEmissao,
    valorBruto: p.valorBruto,
    momento: 'emissao',
    participante: p.participante ?? participanteDe(f),
    municipio: p.municipio,
  });
  const iss = await l.uma<{ id: number; codigo: string }>(
    "SELECT id, codigo FROM tributo WHERE UPPER(codigo) IN ('ISS', 'ISSQN') AND ativo = TRUE ORDER BY id LIMIT 1",
    [],
  );
  const retencoes = calcularRetencoesEntrada(sugestoes, { ...p, siglaIss: iss ? texto(iss.codigo) : 'ISS' });
  const tributoId = new Map(sugestoes.map((s) => [s.tributo, s.tributoId]));
  if (iss) tributoId.set(texto(iss.codigo), numero(iss.id));
  return {
    retencoes: retencoes.map((r) => ({ ...r, tributoId: tributoId.get(r.tributo) ?? 0 })),
    liquido: liquidoEntrada(p.valorBruto, retencoes),
    reinf: totaisReinf(retencoes),
  };
}

/** O apoio da tela: fornecedores, pedidos de serviço abertos (itens com saldo), serviços, centros de custo e moedas. */
export async function apoioEntradaServico(l: Leitor, est: number) {
  const fornecedores = await l.consultar(
    `SELECT id, razao_social, COALESCE(cnpj, cpf) AS documento FROM empresa_fornecedora
      WHERE excluido_em IS NULL ORDER BY razao_social LIMIT 2000`,
    [],
  );
  const pedidos = await l.consultar(
    `SELECT p.id, p.ano, p.numero, p.empresa_fornecedora_id, p.situacao FROM pedido_compra p
      WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND p.natureza <> 'produto'
        AND p.situacao IN (${PEDIDO_ACEITA_ENTRADA.map(() => '?').join(', ')})
      ORDER BY p.ano DESC, p.numero DESC LIMIT 500`,
    [est, ...PEDIDO_ACEITA_ENTRADA],
  );
  const itens = pedidos.length
    ? await l.consultar(
        `SELECT i.id, i.pedido_compra_id, i.servico_contratavel_id, sc.descricao, i.quantidade, i.quantidade_recebida,
                i.quantidade_cancelada, i.valor_unitario
           FROM pedido_compra_item i JOIN servico_contratavel sc ON sc.id = i.servico_contratavel_id
          WHERE i.pedido_compra_id IN (${pedidos.map(() => '?').join(', ')}) AND i.excluido_em IS NULL
            AND i.cancelado_em IS NULL
          ORDER BY i.pedido_compra_id, i.sequencia`,
        pedidos.map((p) => p['id']),
      )
    : [];
  const servicos = await l.consultar(
    'SELECT id, codigo, descricao FROM servico_contratavel WHERE ativo = TRUE AND excluido_em IS NULL ORDER BY descricao LIMIT 2000',
    [],
  );
  const centros = await l.consultar(
    'SELECT id, codigo, nome FROM centro_custo WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY codigo LIMIT 2000',
    [est],
  );
  const moedas = await l.consultar(
    "SELECT id, codigo_iso, descricao FROM moeda WHERE ativo = TRUE AND codigo_iso <> 'BRL' ORDER BY codigo_iso",
    [],
  );
  return {
    fornecedores: fornecedores.map((r) => ({
      id: numero(r['id']),
      rotulo: `${texto(r['razao_social'])} · ${so(r['documento']) || 'sem documento'}`,
    })),
    pedidos: pedidos.map((p) => ({
      id: numero(p['id']),
      rotulo: `${texto(p['ano'])}/${texto(p['numero'])}`,
      fornecedor: numero(p['empresa_fornecedora_id']),
      situacao: texto(p['situacao']),
      itens: itens
        .filter((i) => numero(i['pedido_compra_id']) === numero(p['id']))
        .map((i) => ({
          id: numero(i['id']),
          servico: numero(i['servico_contratavel_id']),
          descricao: texto(i['descricao']),
          saldo: Math.max(
            0,
            numero(i['quantidade']) - numero(i['quantidade_recebida']) - numero(i['quantidade_cancelada']),
          ),
          valorUnitario: numero(i['valor_unitario']),
        })),
    })),
    servicos: servicos.map((r) => ({
      id: numero(r['id']),
      rotulo: `${texto(r['codigo'])} · ${texto(r['descricao'])}`,
    })),
    centros: centros.map((r) => ({
      id: numero(r['id']),
      rotulo: `${texto(r['codigo'])} · ${texto(r['nome'])}`,
    })),
    moedas: moedas.map((r) => ({
      id: numero(r['id']),
      rotulo: `${texto(r['codigo_iso'])} · ${texto(r['descricao'])}`,
    })),
  };
}

/** As entradas do estabelecimento (na competência e na situação, se pedidas), com o retido e o líquido. */
export async function listarEntradasServico(
  l: Leitor,
  est: number,
  f: { competencia?: string | null; situacao?: string | null },
) {
  const onde: string[] = ['es.estabelecimento_id = ?', 'es.excluido_em IS NULL'];
  const p: unknown[] = [est];
  if (f.competencia && COMPETENCIA.test(f.competencia)) {
    onde.push('es.competencia = ?');
    p.push(`${f.competencia}-01`);
  }
  if (f.situacao) {
    onde.push('es.situacao = ?');
    p.push(f.situacao);
  }
  const linhas = await l.consultar(
    `SELECT es.id, es.versao, es.numero, es.numero_documento, es.serie, es.data_emissao, es.data_entrada, es.competencia,
            es.valor_total, es.situacao, es.titulo_pagar_id, es.pedido_compra_id, es.concluido_em, ef.razao_social,
            COALESCE(ef.cnpj, ef.cpf) AS documento, p.ano AS pedido_ano, p.numero AS pedido_numero,
            (SELECT COALESCE(SUM(r.valor_retido), 0) FROM retencao_entrada_servico r
               JOIN entrada_servico_item i ON i.id = r.entrada_servico_item_id
              WHERE i.entrada_servico_id = es.id AND r.excluido_em IS NULL AND i.excluido_em IS NULL) AS retido
       FROM entrada_servico es JOIN empresa_fornecedora ef ON ef.id = es.empresa_fornecedora_id
       LEFT JOIN pedido_compra p ON p.id = es.pedido_compra_id
      WHERE ${onde.join(' AND ')}
      ORDER BY es.data_entrada DESC, es.id DESC LIMIT 1000`,
    p,
  );
  return linhas.map((r) => ({
    id: numero(r['id']),
    versao: numero(r['versao']),
    numero: texto(r['numero']),
    documento: texto(r['numero_documento']),
    serie: r['serie'] ? texto(r['serie']) : null,
    fornecedor: texto(r['razao_social']),
    fornecedorDocumento: so(r['documento']),
    pedido: r['pedido_ano'] == null ? null : `${texto(r['pedido_ano'])}/${texto(r['pedido_numero'])}`,
    emissao: dataIso(r['data_emissao']),
    entrada: dataIso(r['data_entrada']),
    competencia: (dataIso(r['competencia']) ?? '').slice(0, 7),
    valorBruto: numero(r['valor_total']),
    retido: numero(r['retido']),
    liquido: centavos(numero(r['valor_total']) - numero(r['retido'])),
    situacao: texto(r['situacao']),
    titulo: numeroOuNulo(r['titulo_pagar_id']),
    concluidaEm: instanteIso(r['concluido_em']),
  }));
}

/** A entrada com os itens, o câmbio e as retenções por tributo (somadas dos itens). */
export async function detalheEntradaServico(l: Leitor, est: number, entrada: number) {
  const [cab] = (await listarEntradasServico(l, est, {})).filter((e) => e.id === entrada);
  if (!cab) return null;
  const itens = await l.consultar(
    `SELECT i.id, i.sequencia, sc.codigo, sc.descricao AS servico, i.descricao, i.quantidade, i.valor_unitario,
            i.valor_desconto, i.valor_total, cc.codigo AS centro, i.pedido_compra_item_id, i.valor_inss_nao_retido
       FROM entrada_servico_item i JOIN servico_contratavel sc ON sc.id = i.servico_contratavel_id
       JOIN centro_custo cc ON cc.id = i.centro_custo_id
      WHERE i.entrada_servico_id = ? AND i.excluido_em IS NULL ORDER BY i.sequencia`,
    [entrada],
  );
  const retencoes = await l.consultar(
    `SELECT t.codigo AS tributo, SUM(r.base_calculo) AS base, MAX(r.aliquota) AS aliquota, SUM(r.valor_tributo) AS devido,
            SUM(r.valor_retido) AS retido, SUM(r.valor_nao_retido) AS nao_retido, MIN(r.retido) AS retida
       FROM retencao_entrada_servico r JOIN entrada_servico_item i ON i.id = r.entrada_servico_item_id
       JOIN tributo t ON t.id = r.tributo_id
      WHERE i.entrada_servico_id = ? AND r.excluido_em IS NULL AND i.excluido_em IS NULL
      GROUP BY t.codigo ORDER BY t.codigo`,
    [entrada],
  );
  const cambio = await l.uma(
    `SELECT m.codigo_iso, c.data_cotacao, c.taxa_cambio, c.valor_total_moeda, c.valor_total_convertido
       FROM entrada_servico_cambio c JOIN moeda m ON m.id = c.moeda_id
      WHERE c.entrada_servico_id = ? AND c.excluido_em IS NULL ORDER BY c.sequencia LIMIT 1`,
    [entrada],
  );
  return {
    ...cab,
    itens: itens.map((r) => ({
      sequencia: numero(r['sequencia']),
      servico: `${texto(r['codigo'])} · ${texto(r['servico'])}`,
      descricao: r['descricao'] ? texto(r['descricao']) : null,
      quantidade: numero(r['quantidade']),
      valorUnitario: numero(r['valor_unitario']),
      valorDesconto: numero(r['valor_desconto']),
      valorTotal: numero(r['valor_total']),
      centro: texto(r['centro']),
      doPedido: r['pedido_compra_item_id'] != null,
      inssNaoRetido: numero(r['valor_inss_nao_retido']),
    })),
    retencoes: retencoes.map((r) => ({
      tributo: texto(r['tributo']),
      campo: campoDoTributo(texto(r['tributo'])),
      base: numero(r['base']),
      aliquota: numero(r['aliquota']),
      devido: numero(r['devido']),
      retido: numero(r['retido']),
      naoRetido: numero(r['nao_retido']),
      dispensada: Number(r['retida']) === 0,
    })),
    cambio: cambio
      ? {
          moeda: texto(cambio['codigo_iso']),
          dataCotacao: dataIso(cambio['data_cotacao']),
          taxa: numero(cambio['taxa_cambio']),
          valorMoeda: numero(cambio['valor_total_moeda']),
          valorConvertido: numero(cambio['valor_total_convertido']),
        }
      : null,
  };
}

// ── Gravações ───────────────────────────────────────────────────────────────────────────────────────────────────

const registrar = definirOperacao<EntradaServicoEntrada, ResultadoOperacao>({
  nome: 'financeiro.entrada_servico_registrar',
  tabelas: [
    'entrada_servico',
    'entrada_servico_item',
    'entrada_servico_cambio',
    'retencao_entrada_servico',
    'sequencia_negocio',
  ],
  entrada: esquemaEntradaServico as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const pedido = e.pedido === null ? null : await pedidoServico(tx, est, e.pedido, true);
    if (e.pedido !== null && !pedido)
      throw recusa('pedido-inexistente', 'O pedido não é deste estabelecimento.', { campos: ['pedido'] });
    recusar(
      conferirEntradaServico({
        fornecedor: e.fornecedor,
        dataEmissao: e.dataEmissao,
        dataEntrada: e.dataEntrada,
        competencia: e.competencia,
        itens: e.itens,
        pedido,
        issRetido: e.issRetido,
        aliquotaIss: e.aliquotaIss,
        cambio: e.cambio,
      }),
    );
    const repetida = await tx.uma(
      `SELECT numero, situacao FROM entrada_servico WHERE estabelecimento_id = ? AND empresa_fornecedora_id = ?
          AND numero_documento = ? AND serie <=> ?`,
      [est, e.fornecedor, e.numeroDocumento, e.serie],
    );
    if (repetida)
      throw recusa(
        'documento-repetido',
        `Esta nota do fornecedor já foi registrada na entrada ${texto(repetida['numero'])} (${texto(repetida['situacao'])}).`,
        { campos: ['numeroDocumento'] },
      );
    const centros = [...new Set(e.itens.map((i) => i.centroCusto))];
    const validos = await tx.consultar(
      `SELECT id FROM centro_custo WHERE estabelecimento_id = ? AND id IN (${centros.map(() => '?').join(', ')})`,
      [est, ...centros],
    );
    if (validos.length !== centros.length)
      throw recusa('centro-invalido', 'O centro de custo não é deste estabelecimento.', {
        campos: ['itens'],
      });
    const bruto = valorBrutoEntrada(e.itens);
    const inssNaoRetido = centavos(e.itens.reduce((s, i) => s + i.inssNaoRetido, 0));
    const previa = await previaRetencoesEntrada(tx, est, {
      fornecedor: e.fornecedor,
      valorBruto: bruto,
      dataEmissao: e.dataEmissao,
      municipio: e.municipio,
      participante: e.participante,
      issRetido: e.issRetido,
      aliquotaIss: e.aliquotaIss,
      baseIss: e.baseIss,
      inssNaoRetido,
    });
    const semCadastro = previa.retencoes.find((r) => r.tributoId === 0);
    if (semCadastro)
      throw recusa('tributo-sem-cadastro', `Falta no cadastro o tributo ${semCadastro.tributo}.`, {
        campos: ['issRetido'],
      });
    const iss = previa.retencoes.find((r) => r.campo === 'iss');
    const ir = previa.retencoes.find((r) => r.campo === 'ir');
    const inss = previa.retencoes.find((r) => r.campo === 'inss');
    await garantirSequencia(
      tx,
      { tipo: 'entrada_servico', estabelecimento: est, prefixo: 'ES-' },
      { usuario: ctx.usuario, agora: new Date() },
    );
    const numeroNegocio = (await tx.proximoNumero('entrada_servico')).formatado;
    const entrada = await tx.incluir('entrada_servico', {
      estabelecimento_id: est,
      numero: numeroNegocio,
      empresa_fornecedora_id: e.fornecedor,
      pedido_compra_id: e.pedido,
      numero_documento: e.numeroDocumento,
      serie: e.serie,
      chave_acesso: e.chaveAcesso,
      data_emissao: e.dataEmissao,
      data_entrada: e.dataEntrada,
      competencia: `${e.competencia}-01`,
      prestacao_municipio_ibge_id: e.municipio,
      valor_total: bruto,
      valor_desconto: centavos(e.itens.reduce((s, i) => s + i.valorDesconto, 0)),
      base_iss: iss?.base ?? e.baseIss,
      aliquota_iss: e.aliquotaIss,
      valor_iss: iss?.valorTributo ?? 0,
      iss_retido: e.issRetido,
      base_irrf: ir?.base ?? null,
      base_inss: inss?.base ?? null,
      situacao: 'aberta',
      observacao: e.observacao,
    });
    const pesos = e.itens.map(valorDoItem);
    const itens: number[] = [];
    for (const [n, i] of e.itens.entries())
      itens.push(
        await tx.incluir('entrada_servico_item', {
          entrada_servico_id: entrada,
          sequencia: n + 1,
          servico_contratavel_id: i.servico,
          pedido_compra_item_id: i.pedidoItem,
          descricao: i.descricao,
          quantidade: i.quantidade,
          valor_unitario: i.valorUnitario,
          valor_total: pesos[n],
          valor_desconto: i.valorDesconto,
          base_iss: iss ? ratear(iss.base, pesos)[n] : null,
          valor_iss: iss ? ratear(iss.valorTributo, pesos)[n] : 0,
          valor_inss_nao_retido: i.inssNaoRetido > 0 ? i.inssNaoRetido : null,
          numero_processo_judicial: i.processoJudicial,
          centro_custo_id: i.centroCusto,
        }),
      );
    if (e.cambio)
      await tx.incluir('entrada_servico_cambio', {
        entrada_servico_id: entrada,
        sequencia: 1,
        moeda_id: e.cambio.moeda,
        data_cotacao: e.cambio.dataCotacao,
        taxa_cambio: e.cambio.taxa,
        cambio_sugerido: e.cambio.sugerido,
        valor_total_moeda: e.cambio.valorMoeda,
        valor_total_convertido: bruto,
      });
    const sequencia = new Map<number, number>();
    for (const r of previa.retencoes) {
      const base = ratear(r.base, pesos);
      const devido = ratear(r.valorTributo, pesos);
      const retido = ratear(r.valorRetido, pesos);
      const naoRetido = ratear(r.valorNaoRetido, pesos);
      for (const [n, item] of itens.entries()) {
        if (devido[n]! <= 0 && base[n]! <= 0) continue;
        const s = (sequencia.get(item) ?? 0) + 1;
        sequencia.set(item, s);
        await tx.incluir('retencao_entrada_servico', {
          entrada_servico_item_id: item,
          sequencia: s,
          tributo_id: r.tributoId,
          regra_retencao_id: r.regra,
          base_calculo: base[n],
          aliquota: r.aliquota,
          valor_tributo: devido[n],
          valor_retido: retido[n],
          valor_nao_retido: naoRetido[n],
          retido: !r.dispensada,
        });
      }
    }
    return {
      entrada,
      numero: numeroNegocio,
      valorBruto: bruto,
      retido: centavos(previa.retencoes.reduce((s, r) => s + r.valorRetido, 0)),
      liquido: previa.liquido,
    };
  },
  alvo: (_e, r) => ({ tabela: 'entrada_servico', id: numero(r['entrada']) || null }),
});

/** A entrada sob a trava, do estabelecimento, com a versão conferida. */
async function entradaTravada(tx: TxOperacao, est: number, entrada: number, versao: number) {
  const [r] = await tx.consultarParaAtualizar(
    `SELECT es.*, COALESCE(ef.cnpj, ef.cpf) AS documento FROM entrada_servico es
       JOIN empresa_fornecedora ef ON ef.id = es.empresa_fornecedora_id
      WHERE es.id = ? AND es.estabelecimento_id = ? AND es.excluido_em IS NULL`,
    [entrada, est],
  );
  if (!r) throw recusa('nao-encontrado', 'A entrada não é deste estabelecimento.', { campos: ['entrada'] });
  if (numero(r['versao']) !== versao)
    throw recusa('conflito-versao', 'A entrada mudou desde que foi aberta: recarregue.', {
      campos: ['versao'],
    });
  const itens = await tx.consultar(
    `SELECT i.id, i.sequencia, i.pedido_compra_item_id, i.quantidade, i.valor_total, i.valor_desconto, i.descricao,
            i.centro_custo_id, sc.codigo, sc.descricao AS servico
       FROM entrada_servico_item i JOIN servico_contratavel sc ON sc.id = i.servico_contratavel_id
      WHERE i.entrada_servico_id = ? AND i.excluido_em IS NULL ORDER BY i.sequencia`,
    [entrada],
  );
  return { r, itens };
}

/** Soma (ou devolve, com sinal negativo) a quantidade atendida aos itens do pedido e acerta a situação dele. */
async function movimentarPedido(
  tx: TxOperacao,
  est: number,
  pedido: number,
  itens: readonly Record<string, unknown>[],
  sinal: 1 | -1,
) {
  const ped = await pedidoServico(tx, est, pedido, true);
  if (!ped)
    throw recusa('pedido-inexistente', 'O pedido não é deste estabelecimento.', { campos: ['pedido'] });
  if (sinal === 1 && !(PEDIDO_ACEITA_ENTRADA as readonly string[]).includes(ped.situacao))
    throw recusa('pedido-fechado', 'O pedido não está aprovado ou já foi encerrado.', { campos: ['pedido'] });
  for (const i of itens) {
    const pi = numeroOuNulo(i['pedido_compra_item_id']);
    if (pi === null) continue;
    const [linha] = await tx.consultarParaAtualizar(
      'SELECT id, versao, quantidade, quantidade_recebida, quantidade_cancelada FROM pedido_compra_item WHERE id = ?',
      [pi],
    );
    if (!linha) continue;
    const recebida = numero(linha['quantidade_recebida']) + sinal * numero(i['quantidade']);
    if (recebida > numero(linha['quantidade']) - numero(linha['quantidade_cancelada']) + 1e-9)
      throw recusa(
        'acima-do-saldo',
        `Serviço ${numero(i['sequencia'])}: a quantidade passa do saldo do pedido.`,
        {
          campos: ['itens'],
        },
      );
    await tx.alterar('pedido_compra_item', pi, numero(linha['versao']), {
      quantidade_recebida: Math.max(0, recebida),
    });
  }
  const s = await tx.uma(
    `SELECT SUM(quantidade - quantidade_cancelada) AS total, SUM(quantidade_recebida) AS recebida, MAX(p.versao) AS versao,
            MAX(p.enviado_fornecedor_em) AS enviado
       FROM pedido_compra_item i JOIN pedido_compra p ON p.id = i.pedido_compra_id
      WHERE i.pedido_compra_id = ? AND i.excluido_em IS NULL AND i.cancelado_em IS NULL`,
    [pedido],
  );
  const total = numero(s?.['total']);
  const recebida = numero(s?.['recebida']);
  const situacao =
    recebida <= 0
      ? s?.['enviado']
        ? 'enviado'
        : 'aprovado'
      : recebida + 1e-9 >= total
        ? 'recebido'
        : 'parcialmente_recebido';
  if (situacao !== ped.situacao)
    await tx.alterar('pedido_compra', pedido, numero(s?.['versao']), { situacao });
}

const concluir = definirOperacao<z.infer<typeof esquemaConcluir>, ResultadoOperacao>({
  nome: 'financeiro.entrada_servico_concluir',
  tabelas: [
    'entrada_servico',
    'pedido_compra',
    'pedido_compra_item',
    'escrituracao_entrada',
    'escrituracao_item_entrada',
  ],
  entrada: esquemaConcluir as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const { r, itens } = await entradaTravada(tx, est, e.entrada, e.versao);
    recusar(
      conferirConclusaoEntrada({
        situacao: texto(r['situacao']),
        valorTotal: numero(r['valor_total']),
        somaItens: centavos(itens.reduce((s, i) => s + numero(i['valor_total']), 0)),
      }),
    );
    if (e.titulo !== null) {
      const t = await tx.uma(
        `SELECT id FROM titulo_pagar WHERE id = ? AND estabelecimento_id = ? AND empresa_fornecedora_id = ?
            AND situacao <> 'cancelado' AND excluido_em IS NULL`,
        [e.titulo, est, r['empresa_fornecedora_id']],
      );
      if (!t)
        throw recusa('titulo-invalido', 'O título não é deste fornecedor nem deste estabelecimento.', {
          campos: ['titulo'],
        });
    }
    const pedido = numeroOuNulo(r['pedido_compra_id']);
    if (pedido !== null) await movimentarPedido(tx, est, pedido, itens, 1);
    const cfop = numeroOuNulo(r['cfop_id']) ?? numeroOuNulo((await tx.uma(SQL_CFOP, [CFOP_SERVICO]))?.['id']);
    if (cfop === null)
      throw recusa('sem-cfop', `Falta no catálogo o CFOP ${CFOP_SERVICO} da aquisição de serviço.`, {
        campos: ['cfop'],
      });
    const chave = so(r['chave_acesso']);
    const escrituracao = await tx.incluir('escrituracao_entrada', {
      estabelecimento_id: est,
      entrada_servico_id: e.entrada,
      empresa_fornecedora_id: r['empresa_fornecedora_id'],
      modelo_documento: 'SE',
      serie: r['serie'] ? texto(r['serie']).slice(0, 3) : null,
      numero_documento: r['numero_documento'],
      chave_acesso: chave.length === 44 ? chave : null,
      data_emissao: dataIso(r['data_emissao']),
      data_entrada: dataIso(r['data_entrada']),
      competencia: dataIso(r['competencia']),
      cfop_id: cfop,
      valor_documento: r['valor_total'],
      valor_desconto: r['valor_desconto'],
      situacao: 'pendente',
    });
    for (const i of itens)
      await tx.incluir('escrituracao_item_entrada', {
        escrituracao_entrada_id: escrituracao,
        sequencia: numero(i['sequencia']),
        entrada_servico_item_id: i['id'],
        cfop_id: cfop,
        codigo_item: texto(i['codigo']).slice(0, 60),
        descricao: texto(i['descricao'] ?? i['servico']).slice(0, 200) || null,
        quantidade: i['quantidade'],
        valor_item: centavos(numero(i['valor_total']) + numero(i['valor_desconto'])),
        valor_desconto: i['valor_desconto'],
        centro_custo_id: i['centro_custo_id'],
      });
    await tx.alterar('entrada_servico', e.entrada, e.versao, {
      situacao: 'concluida',
      concluido_em: new Date(),
      concluido_por_usuario_id: ctx.usuario,
      titulo_pagar_id: e.titulo,
      cfop_id: cfop,
    });
    return { entrada: e.entrada, escrituracao, pedido: pedido ?? 0 };
  },
  alvo: (e) => ({ tabela: 'entrada_servico', id: e.entrada }),
});

const cancelar = definirOperacao<z.infer<typeof esquemaCancelar>, ResultadoOperacao>({
  nome: 'financeiro.entrada_servico_cancelar',
  tabelas: ['entrada_servico', 'pedido_compra', 'pedido_compra_item', 'escrituracao_entrada'],
  entrada: esquemaCancelar as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const { r, itens } = await entradaTravada(tx, est, e.entrada, e.versao);
    const situacao = texto(r['situacao']);
    // Declarada: a competência do prestador já tem evento aceito na EFD-REINF.
    const declarada =
      situacao === 'concluida' &&
      (await tx.uma(
        `SELECT 1 AS x FROM evento_reinf v JOIN evento_reinf_item i ON i.evento_reinf_id = v.id AND i.sequencia = 1
          WHERE v.estabelecimento_id = ? AND v.competencia = ? AND v.situacao = 'aceito' AND v.excluido_em IS NULL
            AND i.beneficiario_documento = ? LIMIT 1`,
        [est, dataIso(r['competencia']), so(r['documento'])],
      )) !== null;
    const pago =
      r['titulo_pagar_id'] != null &&
      (await tx.uma("SELECT 1 AS x FROM titulo_pagar WHERE id = ? AND situacao IN ('pago', 'pago_parcial')", [
        r['titulo_pagar_id'],
      ])) !== null;
    recusar(
      conferirCancelamentoEntrada({
        situacao,
        justificativa: e.justificativa,
        declaradaReinf: declarada,
        tituloPago: pago,
      }),
    );
    const pedido = numeroOuNulo(r['pedido_compra_id']);
    if (situacao === 'concluida') {
      if (pedido !== null) await movimentarPedido(tx, est, pedido, itens, -1);
      const esc = await tx.uma(
        "SELECT id, versao FROM escrituracao_entrada WHERE entrada_servico_id = ? AND situacao <> 'cancelada'",
        [e.entrada],
      );
      if (esc)
        await tx.alterar('escrituracao_entrada', numero(esc['id']), numero(esc['versao']), {
          situacao: 'cancelada',
          situacao_documento: '02',
        });
    }
    await tx.alterar('entrada_servico', e.entrada, e.versao, {
      situacao: 'cancelada',
      justificativa: e.justificativa,
    });
    return { entrada: e.entrada, anterior: situacao };
  },
  alvo: (e) => ({ tabela: 'entrada_servico', id: e.entrada }),
});

export const OPERACOES_ENTRADA_SERVICO = { registrar, concluir, cancelar } as const;
