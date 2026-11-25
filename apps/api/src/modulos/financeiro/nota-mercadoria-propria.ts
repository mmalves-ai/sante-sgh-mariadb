// F7, 07-FIN linha 114: a NF-e de saída de mercadoria no banco do cliente, pelo Executor do núcleo (trilha, outbox e
// idempotência na mesma transação). A regra pura é a do domínio (`@sgh/dominio-financeiro`, nfe-saida); aqui fica a
// gravação, tudo numa transação:
//   - a nota nasce de uma devolução ao fornecedor já gravada (a de compra ou a do consignado, pelo tipo da
//     devolução: itens, lotes e a nota de entrada referenciada vêm dela), de uma remessa para conserto ou de uma
//     saída avulsa (simples remessa, venda a terceiro), com o destinatário do cadastro (fornecedor ou cliente);
//   - a natureza de operação de partida entra no cadastro do cliente na primeira emissão (o CFOP vem do catálogo
//     oficial), a série 1 da NF-e também; o número sai da série travada;
//   - nota_mercadoria, nota_mercadoria_item, tributo_item_nota_mercadoria (quando o tributo está no cadastro),
//     referencia_nota_mercadoria e o evento da Sefaz (evento_nota_mercadoria);
//   - o XML 4.00 assinado (A1 do cofre; no simulador, o sintético) vai ao armazém de arquivos (ADR 0004) e a
//     `arquivo`, ligado por nota_mercadoria.xml_arquivo_id;
//   - autorizada a nota da devolução, a devolução recebe o número, a série, a chave e o CFOP da nota.
// Cancelamento (24 h, motivo do catálogo e justificativa) e carta de correção (sequência, até 20) são eventos; nada é
// apagado: a nota cancelada fica no banco e a devolução volta a aceitar nota.
import { createHash, randomInt } from 'node:crypto';
import {
  calcularNfeSaida,
  chaveAcessoNfe,
  CONDICAO_USO_CCE,
  conferirCancelamentoNfe,
  conferirCartaCorrecao,
  conferirNfeSaida,
  danfeHtml,
  NATUREZA_DA_ORIGEM,
  NATUREZAS_NFE_PADRAO,
  type NaturezaNfePadrao,
  type ParteNfe,
  type PedidoNfeSaida,
  type RecusaFinanceiro,
  simularSefaz,
  xmlNfeSaida,
} from '@sgh/dominio-financeiro';
import {
  type ContextoOperacao,
  definirOperacao,
  type Leitor,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { ligarArquivo, registrarArquivoGuardado, retencaoAte } from '../tiss/armazem-xml.js';
import { type ArmazemFinanceiro, ErroSobrescritaArquivo } from './armazem.js';
import { assinarNfe, certificadoNfe, conferirAssinaturaNfe } from './nfe-assinatura.js';
import { instanteIso, numero, texto } from './vocabulario.js';

type Tx = TxOperacao;
const id = z.number().int().positive();
const ATIVAS = "('assinada','enviada','autorizada')";
export const SITUACOES_NFE = [
  'rascunho',
  'assinada',
  'enviada',
  'autorizada',
  'rejeitada',
  'denegada',
  'cancelada',
  'inutilizada',
] as const;

function recusar(r: RecusaFinanceiro | null): void {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: r.campos } : {});
}
function estabelecimentoDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null) throw recusa('estabelecimento', 'Escolha o estabelecimento da sessão.');
  return ctx.estabelecimento;
}

const destino = z.enum(['simulador', 'sefaz']).default('simulador');
const esquemaItem = z
  .object({
    insumo: id.nullable().default(null),
    codigo: z.string().trim().max(60).default(''),
    descricao: z.string().trim().max(120).default(''),
    ncm: z.string().trim().max(8).default(''),
    unidade: z.string().trim().max(6).default('UN'),
    quantidade: z.number().positive().max(99_999_999),
    valorUnitario: z.number().min(0).max(999_999_999),
    desconto: z.number().min(0).default(0),
    lote: z.string().trim().max(20).nullable().default(null),
    fabricacao: z.string().date().nullable().default(null),
    validade: z.string().date().nullable().default(null),
  })
  .strict();
const esquemaTributos = z
  .object({
    cstIcms: z
      .string()
      .regex(/^\d{2}$/)
      .default('90'),
    aliquotaIcms: z.number().min(0).max(100).default(0),
    aliquotaIpi: z.number().min(0).max(100).default(0),
  })
  .strict();

export const esquemaEmitirNotaMercadoria = z
  .object({
    destino,
    origem: z.enum(['devolucao_fornecedor', 'conserto', 'avulsa']),
    devolucao: id.nullable().default(null),
    natureza: z.string().trim().max(30).nullable().default(null),
    fornecedor: id.nullable().default(null),
    cliente: id.nullable().default(null),
    notaEntrada: id.nullable().default(null),
    referencias: z
      .array(z.string().regex(/^\d{44}$/))
      .max(20)
      .default([]),
    itens: z.array(esquemaItem).max(990).default([]),
    tributos: esquemaTributos.default({ cstIcms: '90', aliquotaIcms: 0, aliquotaIpi: 0 }),
    valorFrete: z.number().min(0).max(999_999_999).default(0),
    informacaoComplementar: z.string().trim().max(2000).nullable().default(null),
  })
  .strict();
export const esquemaCancelarNotaMercadoria = z
  .object({ destino, nota: id, motivo: id, justificativa: z.string().trim().max(255) })
  .strict();
export const esquemaCorrigirNotaMercadoria = z
  .object({ destino, nota: id, texto: z.string().trim().max(1000) })
  .strict();

// ---------------------------------------------------------------- leituras

export async function naturezasNfe(l: Leitor) {
  const cadastradas = await l.consultar(
    `SELECT n.codigo, n.descricao, n.ativo, cd.codigo_cfop AS dentro, cf.codigo_cfop AS fora
       FROM natureza_operacao n
       LEFT JOIN cfop cd ON cd.id = n.cfop_dentro_estado_id
       LEFT JOIN cfop cf ON cf.id = n.cfop_fora_estado_id
      WHERE n.tipo_nota IN ('saida','ambos')`,
    [],
  );
  return NATUREZAS_NFE_PADRAO.map((p) => {
    const c = cadastradas.find((x) => texto(x['codigo']) === p.codigo);
    return {
      codigo: p.codigo,
      descricao: c ? texto(c['descricao']) : p.descricao,
      finalidade: p.finalidade,
      cfopDentro: c?.['dentro'] ? texto(c['dentro']) : p.cfopDentro,
      cfopFora: c?.['fora'] ? texto(c['fora']) : p.cfopFora,
      exigeReferencia: p.finalidadeEmissao === 'devolucao',
      ativa: c ? Boolean(c['ativo']) : true,
    };
  });
}

/** Devoluções ao fornecedor do estabelecimento sem NF-e ativa (as que pedem a nota). */
export async function devolucoesSemNota(l: Leitor, est: number) {
  const linhas = await l.consultar(
    `SELECT d.id, d.numero, d.tipo, d.valor_total, d.devolvido_em, f.razao_social,
            (SELECT COUNT(*) FROM devolucao_fornecedor_item i WHERE i.devolucao_fornecedor_id = d.id AND i.excluido_em IS NULL) AS itens
       FROM devolucao_fornecedor d
       JOIN empresa_fornecedora f ON f.id = d.empresa_fornecedora_id
      WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL AND d.situacao <> 'cancelada' AND d.chave_acesso IS NULL
        AND NOT EXISTS (SELECT 1 FROM nota_mercadoria n WHERE n.devolucao_fornecedor_id = d.id
                         AND n.excluido_em IS NULL AND n.situacao IN ${ATIVAS})
      ORDER BY d.id DESC LIMIT 200`,
    [est],
  );
  return linhas.map((d) => ({
    devolucao: numero(d['id']),
    numero: texto(d['numero']),
    consignado: texto(d['tipo']) === 'consignado',
    fornecedor: texto(d['razao_social']),
    valor: numero(d['valor_total']),
    itens: numero(d['itens']),
    devolvidaEm: instanteIso(d['devolvido_em']),
  }));
}

export async function apoioNotaMercadoria(l: Leitor, est: number) {
  const fornecedores = await l.consultar(
    `SELECT id, razao_social, COALESCE(cnpj, cpf) AS documento FROM empresa_fornecedora
      WHERE excluido_em IS NULL AND situacao <> 'inativo' ORDER BY razao_social LIMIT 500`,
    [],
  );
  const clientes = await l.consultar(
    `SELECT id, nome, COALESCE(cnpj, cpf) AS documento FROM cliente_financeiro
      WHERE excluido_em IS NULL AND ativo = TRUE ORDER BY nome LIMIT 500`,
    [],
  );
  const motivos = await l.consultar(
    `SELECT id, descricao FROM motivo_cancelamento_documento_fiscal
      WHERE ativo = TRUE AND aplica_nota_mercadoria = TRUE ORDER BY descricao`,
    [],
  );
  const insumos = await l.consultar(
    `SELECT id, codigo, nome, codigo_ncm FROM insumo WHERE excluido_em IS NULL AND situacao = 'ativo'
      ORDER BY nome LIMIT 500`,
    [],
  );
  const rotulo = (n: unknown, d: unknown) => `${texto(n)}${d ? ` · ${texto(d)}` : ''}`;
  return {
    naturezas: await naturezasNfe(l),
    devolucoes: await devolucoesSemNota(l, est),
    fornecedores: fornecedores.map((f) => ({
      id: numero(f['id']),
      rotulo: rotulo(f['razao_social'], f['documento']),
    })),
    clientes: clientes.map((c) => ({ id: numero(c['id']), rotulo: rotulo(c['nome'], c['documento']) })),
    motivos: motivos.map((m) => ({ id: numero(m['id']), rotulo: texto(m['descricao']) })),
    insumos: insumos.map((i) => ({
      id: numero(i['id']),
      rotulo: `${texto(i['codigo'])} · ${texto(i['nome'])}`,
      ncm: texto(i['codigo_ncm']),
    })),
  };
}

export async function notasMercadoria(l: Leitor, est: number, situacao: string | null = null) {
  const linhas = await l.consultar(
    `SELECT n.id, n.numero, s.serie, n.situacao, n.ambiente, n.chave_acesso, n.protocolo_autorizacao, n.data_emissao,
            n.valor_total, n.devolucao_fornecedor_id, n.finalidade_emissao, n.autorizada_em, n.mensagem_retorno,
            o.codigo AS natureza, o.descricao AS natureza_descricao, c.codigo_cfop,
            COALESCE(f.razao_social, cl.nome) AS destinatario,
            (SELECT COUNT(*) FROM evento_nota_mercadoria e WHERE e.nota_mercadoria_id = n.id AND e.tipo_evento = 'carta_correcao') AS cartas
       FROM nota_mercadoria n
       JOIN serie_documento_fiscal s ON s.id = n.serie_documento_fiscal_id
       JOIN natureza_operacao o ON o.id = n.natureza_operacao_id
       JOIN cfop c ON c.id = n.cfop_id
       LEFT JOIN empresa_fornecedora f ON f.id = n.empresa_fornecedora_id
       LEFT JOIN cliente_financeiro cl ON cl.id = n.cliente_financeiro_id
      WHERE n.estabelecimento_id = ? AND n.excluido_em IS NULL AND (? IS NULL OR n.situacao = ?)
      ORDER BY n.id DESC LIMIT 300`,
    [est, situacao, situacao],
  );
  return linhas.map((n) => ({
    nota: numero(n['id']),
    numero: numero(n['numero']),
    serie: texto(n['serie']),
    situacao: texto(n['situacao']),
    homologacao: texto(n['ambiente']) === 'homologacao',
    chave: n['chave_acesso'] ? texto(n['chave_acesso']) : null,
    protocolo: n['protocolo_autorizacao'] ? texto(n['protocolo_autorizacao']) : null,
    emissao: instanteIso(n['data_emissao']),
    autorizadaEm: instanteIso(n['autorizada_em']),
    valorTotal: numero(n['valor_total']),
    devolucao: n['devolucao_fornecedor_id'] === null ? null : numero(n['devolucao_fornecedor_id']),
    natureza: texto(n['natureza']),
    naturezaDescricao: texto(n['natureza_descricao']),
    cfop: texto(n['codigo_cfop']),
    destinatario: texto(n['destinatario']),
    cartasCorrecao: numero(n['cartas']),
    retorno: n['mensagem_retorno'] ? texto(n['mensagem_retorno']) : null,
  }));
}

export async function historicoNotaMercadoria(l: Leitor, est: number, nota: number) {
  const [n] = (await notasMercadoriaPorId(l, est, nota)) ?? [];
  if (!n) return null;
  const itens = await l.consultar(
    `SELECT i.sequencia, i.codigo_produto, i.descricao, i.codigo_ncm, c.codigo_cfop, i.unidade_comercial, i.quantidade,
            i.valor_unitario, i.valor_desconto, i.valor_total, i.numero_lote, i.data_validade, i.situacao_tributaria_icms
       FROM nota_mercadoria_item i JOIN cfop c ON c.id = i.cfop_id
      WHERE i.nota_mercadoria_id = ? AND i.excluido_em IS NULL ORDER BY i.sequencia`,
    [nota],
  );
  const eventos = await l.consultar(
    `SELECT tipo_evento, sequencia_evento, protocolo, codigo_status, mensagem_retorno, texto_correcao, justificativa, ocorrido_em
       FROM evento_nota_mercadoria WHERE nota_mercadoria_id = ? ORDER BY id`,
    [nota],
  );
  const referencias = await l.consultar(
    'SELECT tipo_referencia, chave_acesso FROM referencia_nota_mercadoria WHERE nota_mercadoria_id = ? AND excluido_em IS NULL ORDER BY id',
    [nota],
  );
  return {
    nota: n,
    itens: itens.map((i) => ({
      sequencia: numero(i['sequencia']),
      codigo: texto(i['codigo_produto']),
      descricao: texto(i['descricao']),
      ncm: texto(i['codigo_ncm']),
      cfop: texto(i['codigo_cfop']),
      unidade: texto(i['unidade_comercial']),
      quantidade: numero(i['quantidade']),
      valorUnitario: numero(i['valor_unitario']),
      desconto: numero(i['valor_desconto']),
      valorTotal: numero(i['valor_total']),
      lote: i['numero_lote'] ? texto(i['numero_lote']) : null,
      validade: i['data_validade'] ? (instanteIso(i['data_validade'])?.slice(0, 10) ?? null) : null,
      cstIcms: texto(i['situacao_tributaria_icms']),
    })),
    eventos: eventos.map((e) => ({
      tipo: texto(e['tipo_evento']),
      sequencia: numero(e['sequencia_evento']),
      protocolo: e['protocolo'] ? texto(e['protocolo']) : null,
      codigo: e['codigo_status'] ? texto(e['codigo_status']) : null,
      mensagem: e['mensagem_retorno'] ? texto(e['mensagem_retorno']) : null,
      texto: e['texto_correcao']
        ? texto(e['texto_correcao'])
        : e['justificativa']
          ? texto(e['justificativa'])
          : null,
      em: instanteIso(e['ocorrido_em']),
    })),
    referencias: referencias.map((r) => ({
      tipo: texto(r['tipo_referencia']),
      chave: texto(r['chave_acesso']),
    })),
  };
}

async function notasMercadoriaPorId(l: Leitor, est: number, nota: number) {
  const todas = await l.consultar(
    'SELECT id FROM nota_mercadoria WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [nota, est],
  );
  if (!todas.length) return null;
  return (await notasMercadoria(l, est)).filter((n) => n.nota === nota);
}

/** O DANFE simplificado (HTML escapado) da nota do estabelecimento. */
export async function danfeNotaMercadoria(l: Leitor, est: number, nota: number): Promise<string | null> {
  const h = await historicoNotaMercadoria(l, est, nota);
  if (!h) return null;
  const [e] = await l.consultar(
    `SELECT n.valor_produtos, n.valor_icms, n.valor_ipi, n.informacao_complementar, x.razao_social AS emitente,
            COALESCE(f.cnpj, f.cpf, cl.cnpj, cl.cpf) AS documento
       FROM nota_mercadoria n JOIN estabelecimento x ON x.id = n.estabelecimento_id
       LEFT JOIN empresa_fornecedora f ON f.id = n.empresa_fornecedora_id
       LEFT JOIN cliente_financeiro cl ON cl.id = n.cliente_financeiro_id
      WHERE n.id = ?`,
    [nota],
  );
  return danfeHtml({
    chave: h.nota.chave,
    protocolo: h.nota.protocolo,
    numero: h.nota.numero,
    serie: h.nota.serie,
    emissao: (h.nota.emissao ?? '').slice(0, 10),
    natureza: h.nota.naturezaDescricao,
    situacao: h.nota.situacao,
    emitente: texto(e?.['emitente']),
    destinatario: h.nota.destinatario,
    destinatarioDocumento: texto(e?.['documento']),
    homologacao: h.nota.homologacao,
    itens: h.itens,
    valorProdutos: numero(e?.['valor_produtos']),
    valorIcms: numero(e?.['valor_icms']),
    valorIpi: numero(e?.['valor_ipi']),
    valorTotal: h.nota.valorTotal,
    informacaoComplementar: e?.['informacao_complementar'] ? texto(e['informacao_complementar']) : null,
  });
}

// ---------------------------------------------------------------- gravação

interface NaturezaResolvida {
  readonly id: number;
  readonly regra: NaturezaNfePadrao;
  readonly cfopIds: Readonly<Record<string, number>>;
}

/** A natureza do cadastro do cliente; na primeira emissão, a de partida entra com o CFOP do catálogo oficial. */
async function naturezaDe(tx: Tx, codigo: string): Promise<NaturezaResolvida> {
  const padrao = NATUREZAS_NFE_PADRAO.find((n) => n.codigo === codigo);
  if (!padrao)
    throw recusa('natureza', 'Natureza de operação desconhecida para a NF-e de saída.', {
      campos: ['natureza'],
    });
  const [linha] = await tx.consultar(
    `SELECT n.id, n.ativo, n.descricao, cd.id AS di, cd.codigo_cfop AS dc, cf.id AS fi, cf.codigo_cfop AS fc
       FROM natureza_operacao n
       LEFT JOIN cfop cd ON cd.id = n.cfop_dentro_estado_id
       LEFT JOIN cfop cf ON cf.id = n.cfop_fora_estado_id
      WHERE n.codigo = ?`,
    [codigo],
  );
  if (linha) {
    if (!linha['ativo'])
      throw recusa('natureza-inativa', 'A natureza de operação está inativa no cadastro.', {
        campos: ['natureza'],
      });
    if (!linha['di'] || !linha['fi'])
      throw recusa('natureza-cfop', 'A natureza de operação está sem o CFOP de dentro e de fora do estado.', {
        campos: ['natureza'],
      });
    return {
      id: numero(linha['id']),
      regra: {
        ...padrao,
        descricao: texto(linha['descricao']),
        cfopDentro: texto(linha['dc']),
        cfopFora: texto(linha['fc']),
      },
      cfopIds: { [texto(linha['dc'])]: numero(linha['di']), [texto(linha['fc'])]: numero(linha['fi']) },
    };
  }
  const codigos = [padrao.cfopDentro, padrao.cfopFora, ...(padrao.cfopEntrada ? [padrao.cfopEntrada] : [])];
  const cfops = await tx.consultar(
    `SELECT id, codigo_cfop FROM cfop WHERE codigo_cfop IN (${codigos.map(() => '?').join(', ')})`,
    codigos,
  );
  const ids: Record<string, number> = {};
  for (const c of cfops) ids[texto(c['codigo_cfop'])] = numero(c['id']);
  const falta = codigos.filter((c) => !ids[c]);
  if (falta.length)
    throw recusa(
      'cfop-catalogo',
      `O catálogo oficial de CFOP está sem ${falta.join(', ')}: carregue-o antes de emitir.`,
    );
  const novo = await tx.incluir('natureza_operacao', {
    codigo: padrao.codigo,
    descricao: padrao.descricao,
    ativo: true,
    tipo_nota: 'saida',
    finalidade: padrao.finalidade,
    cfop_dentro_estado_id: ids[padrao.cfopDentro],
    cfop_fora_estado_id: ids[padrao.cfopFora],
    cfop_entrada_id: padrao.cfopEntrada ? ids[padrao.cfopEntrada] : null,
    atualiza_estoque: padrao.atualizaEstoque,
    gera_titulo: padrao.finalidade === 'venda',
  });
  return { id: novo, regra: padrao, cfopIds: ids };
}

/** A série da NF-e (modelo 55) do estabelecimento, travada; a série 1 nasce na primeira emissão. */
async function proximoNumeroNfe(
  tx: Tx,
  est: number,
): Promise<{ serie: number; serieId: number; numero: number }> {
  const travar = () =>
    tx.consultarParaAtualizar(
      `SELECT id, serie, proximo_numero, numero_final, versao FROM serie_documento_fiscal
        WHERE estabelecimento_id = ? AND tipo_documento = 'nfe' AND ativo = TRUE ORDER BY serie LIMIT 1`,
      [est],
    );
  let [s] = await travar();
  if (!s) {
    await tx.incluir('serie_documento_fiscal', {
      estabelecimento_id: est,
      tipo_documento: 'nfe',
      serie: '1',
      modelo_fiscal: '55',
      descricao: 'NF-e de saída de mercadoria',
      numero_inicial: 1,
      proximo_numero: 1,
    });
    [s] = await travar();
  }
  const n = numero(s!['proximo_numero']);
  if (s!['numero_final'] !== null && n > numero(s!['numero_final']))
    throw recusa('serie-esgotada', 'A faixa de numeração da série da NF-e acabou: cadastre a próxima.');
  if (!/^\d{1,3}$/.test(texto(s!['serie'])))
    throw recusa('serie-formato', 'A série da NF-e é numérica, de 0 a 999.');
  await tx.alterar('serie_documento_fiscal', numero(s!['id']), numero(s!['versao']), {
    proximo_numero: n + 1,
  });
  return { serie: Number(texto(s!['serie'])), serieId: numero(s!['id']), numero: n };
}

const PARTE_SQL = (tabela: string, nome: string, extra: string) =>
  `SELECT x.id, COALESCE(x.cnpj, x.cpf) AS documento, x.${nome} AS nome, x.inscricao_estadual, ${extra} AS contribuinte,
          m.codigo_ibge, m.nome AS municipio, u.sigla AS uf
     FROM ${tabela} x
     LEFT JOIN municipio_ibge m ON m.id = x.municipio_ibge_id
     LEFT JOIN unidade_federativa u ON u.id = m.unidade_federativa_id
    WHERE x.id = ? AND x.excluido_em IS NULL`;
const SQL_FORNECEDOR = PARTE_SQL('empresa_fornecedora', 'razao_social', 'x.contribuinte_icms');
const SQL_CLIENTE = PARTE_SQL('cliente_financeiro', 'nome', '(x.inscricao_estadual IS NOT NULL)');
const SQL_EMITENTE = `SELECT x.id, x.cnpj AS documento, x.razao_social AS nome, x.inscricao_estadual, TRUE AS contribuinte,
          m.codigo_ibge, m.nome AS municipio, u.sigla AS uf
     FROM estabelecimento x
     LEFT JOIN municipio_ibge m ON m.id = x.municipio_ibge_id
     LEFT JOIN unidade_federativa u ON u.id = m.unidade_federativa_id
    WHERE x.id = ?`;

async function parte(tx: Tx, sql: string, idParte: number, campo: string): Promise<ParteNfe> {
  const [x] = await tx.consultar(sql, [idParte]);
  if (!x) throw recusa('destinatario', 'Destinatário não encontrado no cadastro.', { campos: [campo] });
  return {
    documento: texto(x['documento']).replace(/\D/g, ''),
    nome: texto(x['nome']),
    uf: texto(x['uf']),
    municipioIbge: x['codigo_ibge'] ? texto(x['codigo_ibge']) : null,
    municipio: x['municipio'] ? texto(x['municipio']) : null,
    inscricaoEstadual: x['inscricao_estadual'] ? texto(x['inscricao_estadual']) : null,
    contribuinteIcms: Boolean(Number(x['contribuinte'])),
  };
}

type Entrada = z.infer<typeof esquemaEmitirNotaMercadoria>;
type ItemSaida = PedidoNfeSaida['itens'][number] & {
  readonly insumo: number | null;
  readonly loteInsumo: number | null;
  readonly notaEntradaItem: number | null;
};

interface Origem {
  readonly natureza: string;
  readonly fornecedor: number | null;
  readonly cliente: number | null;
  readonly notaEntrada: number | null;
  readonly devolucao: { id: number; versao: number; situacao: string } | null;
  readonly localEstoque: number | null;
  readonly referencias: string[];
  readonly itens: ItemSaida[];
}

/** Os itens e o destinatário da devolução ao fornecedor gravada (C2-015); a devolução fica travada. */
async function origemDevolucao(tx: Tx, est: number, e: Entrada): Promise<Origem> {
  if (!e.devolucao)
    throw recusa('devolucao', 'Escolha a devolução ao fornecedor.', { campos: ['devolucao'] });
  const [d] = await tx.consultarParaAtualizar(
    `SELECT d.id, d.versao, d.situacao, d.tipo, d.empresa_fornecedora_id, d.nota_entrada_id, d.local_estoque_id,
            d.chave_acesso, d.excluido_em, ne.chave_acesso AS chave_entrada
       FROM devolucao_fornecedor d LEFT JOIN nota_entrada ne ON ne.id = d.nota_entrada_id
      WHERE d.id = ? AND d.estabelecimento_id = ?`,
    [e.devolucao, est],
  );
  if (!d || d['excluido_em'] !== null)
    throw recusa('devolucao', 'Devolução não encontrada.', { campos: ['devolucao'] });
  if (texto(d['situacao']) === 'cancelada')
    throw recusa('devolucao-cancelada', 'A devolução está cancelada.', { campos: ['devolucao'] });
  const ativa = await tx.consultar(
    `SELECT id FROM nota_mercadoria WHERE devolucao_fornecedor_id = ? AND excluido_em IS NULL AND situacao IN ${ATIVAS}`,
    [e.devolucao],
  );
  if (d['chave_acesso'] !== null || ativa.length)
    throw recusa('devolucao-com-nota', 'A devolução já tem NF-e; cancele a nota antes de emitir outra.', {
      campos: ['devolucao'],
    });
  const itens = await tx.consultar(
    `SELECT di.insumo_id, di.lote_insumo_id, di.nota_entrada_item_id, di.quantidade, di.valor_unitario, di.numero_lote,
            di.validade, i.codigo, i.nome, COALESCE(nei.codigo_ncm, i.codigo_ncm) AS ncm, um.sigla,
            i.registro_sanitario_numero
       FROM devolucao_fornecedor_item di
       JOIN insumo i ON i.id = di.insumo_id
       LEFT JOIN nota_entrada_item nei ON nei.id = di.nota_entrada_item_id
       LEFT JOIN unidade_medida um ON um.id = di.unidade_medida_id
      WHERE di.devolucao_fornecedor_id = ? AND di.excluido_em IS NULL ORDER BY di.sequencia`,
    [e.devolucao],
  );
  const chaveEntrada = d['chave_entrada'] ? texto(d['chave_entrada']) : null;
  return {
    natureza:
      texto(d['tipo']) === 'consignado' ? 'devolucao_consignado' : NATUREZA_DA_ORIGEM.devolucao_fornecedor,
    fornecedor: numero(d['empresa_fornecedora_id']),
    cliente: null,
    notaEntrada: d['nota_entrada_id'] === null ? null : numero(d['nota_entrada_id']),
    devolucao: { id: numero(d['id']), versao: numero(d['versao']), situacao: texto(d['situacao']) },
    localEstoque: d['local_estoque_id'] === null ? null : numero(d['local_estoque_id']),
    referencias: [...new Set([...(chaveEntrada ? [chaveEntrada] : []), ...e.referencias])],
    itens: itens.map((i) => {
      const anvisa = texto(i['registro_sanitario_numero']).replace(/\D/g, '');
      return {
        insumo: numero(i['insumo_id']),
        loteInsumo: i['lote_insumo_id'] === null ? null : numero(i['lote_insumo_id']),
        notaEntradaItem: i['nota_entrada_item_id'] === null ? null : numero(i['nota_entrada_item_id']),
        codigo: texto(i['codigo']),
        descricao: texto(i['nome']).slice(0, 120),
        ncm: texto(i['ncm']),
        unidade: (texto(i['sigla']) || 'UN').slice(0, 6),
        quantidade: numero(i['quantidade']),
        valorUnitario: numero(i['valor_unitario']),
        desconto: 0,
        lote: i['numero_lote'] ? texto(i['numero_lote']) : null,
        fabricacao: null,
        validade: i['validade'] ? (instanteIso(i['validade']) ?? '').slice(0, 10) : null,
        registroAnvisa: anvisa.length === 13 ? anvisa : null,
        ...e.tributos,
      };
    }),
  };
}

/** Conserto e saída avulsa: destinatário, itens e referências do pedido (o insumo completa código, nome e NCM). */
async function origemPedido(tx: Tx, e: Entrada): Promise<Origem> {
  const natureza = e.origem === 'conserto' ? NATUREZA_DA_ORIGEM.conserto : e.natureza;
  if (!natureza) throw recusa('natureza', 'Escolha a natureza da operação.', { campos: ['natureza'] });
  if ((e.fornecedor === null) === (e.cliente === null))
    throw recusa('destinatario', 'Escolha um destinatário: o fornecedor ou o cliente.', {
      campos: ['fornecedor'],
    });
  const insumos = e.itens.flatMap((i) => (i.insumo ? [i.insumo] : []));
  const cadastro = insumos.length
    ? await tx.consultar(
        `SELECT id, codigo, nome, codigo_ncm FROM insumo WHERE id IN (${insumos.map(() => '?').join(', ')})`,
        insumos,
      )
    : [];
  let chaveEntrada: string | null = null;
  if (e.notaEntrada) {
    const [ne] = await tx.consultar('SELECT chave_acesso FROM nota_entrada WHERE id = ?', [e.notaEntrada]);
    if (!ne) throw recusa('nota-entrada', 'Nota de entrada não encontrada.', { campos: ['notaEntrada'] });
    chaveEntrada = ne['chave_acesso'] ? texto(ne['chave_acesso']) : null;
  }
  return {
    natureza,
    fornecedor: e.fornecedor,
    cliente: e.cliente,
    notaEntrada: e.notaEntrada,
    devolucao: null,
    localEstoque: null,
    referencias: [...new Set([...(chaveEntrada ? [chaveEntrada] : []), ...e.referencias])],
    itens: e.itens.map((i) => {
      const c = cadastro.find((x) => numero(x['id']) === i.insumo);
      return {
        insumo: i.insumo,
        loteInsumo: null,
        notaEntradaItem: null,
        codigo: i.codigo || texto(c?.['codigo']),
        descricao: i.descricao || texto(c?.['nome']).slice(0, 120),
        ncm: i.ncm || texto(c?.['codigo_ncm']),
        unidade: i.unidade,
        quantidade: i.quantidade,
        valorUnitario: i.valorUnitario,
        desconto: i.desconto,
        lote: i.lote,
        fabricacao: i.fabricacao,
        validade: i.validade,
        registroAnvisa: null,
        ...e.tributos,
      };
    }),
  };
}

const emitirNotaMercadoria = (armazem: ArmazemFinanceiro, env: NodeJS.ProcessEnv) =>
  definirOperacao<Entrada, ResultadoOperacao>({
    nome: 'financeiro.emitir_nota_mercadoria',
    tabelas: [
      'natureza_operacao',
      'serie_documento_fiscal',
      'nota_mercadoria',
      'nota_mercadoria_item',
      'tributo_item_nota_mercadoria',
      'referencia_nota_mercadoria',
      'evento_nota_mercadoria',
      'devolucao_fornecedor',
      'arquivo',
    ],
    entrada: esquemaEmitirNotaMercadoria as never,
    async gravar(tx, e, ctx) {
      const est = estabelecimentoDe(ctx);
      const agora = new Date();
      const o =
        e.origem === 'devolucao_fornecedor' ? await origemDevolucao(tx, est, e) : await origemPedido(tx, e);
      const nat = await naturezaDe(tx, o.natureza);
      const emitente = await parte(tx, SQL_EMITENTE, est, 'estabelecimento');
      const destinatario =
        o.fornecedor !== null
          ? await parte(tx, SQL_FORNECEDOR, o.fornecedor, 'fornecedor')
          : await parte(tx, SQL_CLIENTE, o.cliente!, 'cliente');
      const pedido: PedidoNfeSaida = {
        natureza: nat.regra,
        emitente,
        destinatario,
        referencias: o.referencias,
        itens: o.itens,
        valorFrete: e.valorFrete,
        informacaoComplementar: e.informacaoComplementar,
      };
      recusar(conferirNfeSaida(pedido));
      const calculo = calcularNfeSaida(pedido);
      const cfopId = nat.cfopIds[calculo.cfop];
      if (!cfopId) throw recusa('natureza-cfop', `O CFOP ${calculo.cfop} não está no catálogo.`);
      const cert = certificadoNfe(env, emitente.documento, e.destino, agora);
      if (!cert.ok) throw recusa(cert.codigo, cert.motivo);
      const serie = await proximoNumeroNfe(tx, est);
      const chave = chaveAcessoNfe({
        uf: emitente.uf,
        emissao: agora,
        cnpjEmitente: emitente.documento,
        serie: serie.serie,
        numero: serie.numero,
        codigoNumerico: randomInt(1, 99_999_999),
      });
      const homologacao = e.destino === 'simulador';
      const xml = assinarNfe(
        xmlNfeSaida({
          pedido,
          calculo,
          chave,
          serie: serie.serie,
          numero: serie.numero,
          emissao: agora,
          homologacao,
        }),
        cert.cert,
      );
      const retorno = homologacao
        ? simularSefaz({ tipo: 'autorizacao', xml, chave, assinaturaOk: conferirAssinaturaNfe(xml).ok })
        : null;
      const situacao = !retorno ? 'assinada' : retorno.codigo === '100' ? 'autorizada' : 'rejeitada';
      // O XML vai ao disco antes do registro (a chave leva a chave de acesso e o hash; o guardado é imutável).
      const bytes = new TextEncoder().encode(xml);
      const hash = createHash('sha256').update(bytes).digest('hex');
      const chaveArquivo = `nfe/${est}/${chave}-${hash.slice(0, 16)}.xml`;
      try {
        await armazem.guardar(chaveArquivo, bytes, 'application/xml');
      } catch (x) {
        if (!(x instanceof ErroSobrescritaArquivo)) throw x;
      }
      const arquivo = await registrarArquivoGuardado(tx, {
        estabelecimento: est,
        entidade: 'nota_mercadoria',
        entidadeId: null,
        finalidade: 'xml_nota_mercadoria',
        nomeOriginal: `NFe${chave}.xml`,
        tipoMime: 'application/xml',
        tamanhoBytes: bytes.length,
        hash,
        chave: chaveArquivo,
        retencaoAte: retencaoAte(agora),
      });
      const autorizada = situacao === 'autorizada';
      const notaId = await tx.incluir('nota_mercadoria', {
        estabelecimento_id: est,
        serie_documento_fiscal_id: serie.serieId,
        numero: serie.numero,
        modelo_documento: '55',
        ambiente: homologacao ? 'homologacao' : 'producao',
        tipo_operacao: 'saida',
        finalidade_emissao: nat.regra.finalidadeEmissao,
        natureza_operacao_id: nat.id,
        cfop_id: cfopId,
        empresa_fornecedora_id: o.fornecedor,
        cliente_financeiro_id: o.cliente,
        data_emissao: agora,
        data_saida: agora,
        chave_acesso: chave,
        protocolo_autorizacao: autorizada ? retorno!.protocolo : null,
        autorizada_em: autorizada ? agora : null,
        situacao,
        codigo_retorno: retorno?.codigo ?? null,
        mensagem_retorno: retorno?.mensagem ?? 'Assinada; à espera da transmissão à Sefaz.',
        nota_entrada_id: o.notaEntrada,
        devolucao_fornecedor_id: o.devolucao?.id ?? null,
        chave_acesso_referenciada: o.referencias[0] ?? null,
        local_estoque_id: o.localEstoque,
        modalidade_frete: calculo.valorFrete > 0 ? 'emitente' : 'sem_frete',
        valor_produtos: calculo.valorProdutos,
        valor_frete: calculo.valorFrete,
        valor_desconto: calculo.valorDesconto,
        valor_icms: calculo.valorIcms,
        valor_ipi: calculo.valorIpi,
        valor_total: calculo.valorTotal,
        informacao_complementar: e.informacaoComplementar,
        xml_arquivo_id: arquivo.id,
      });
      await ligarArquivo(tx, arquivo, notaId);
      const tributos = await tx.consultar(
        "SELECT id, UPPER(codigo) AS codigo FROM tributo WHERE UPPER(codigo) IN ('ICMS','IPI') AND ativo = TRUE",
        [],
      );
      const tributo = (c: string) => tributos.find((t) => texto(t['codigo']) === c)?.['id'] ?? null;
      for (const [i, it] of calculo.itens.entries()) {
        const fonte = o.itens[i]!;
        const itemId = await tx.incluir('nota_mercadoria_item', {
          nota_mercadoria_id: notaId,
          sequencia: it.sequencia,
          insumo_id: fonte.insumo,
          lote_insumo_id: fonte.loteInsumo,
          nota_entrada_item_id: fonte.notaEntradaItem,
          codigo_produto: it.codigo,
          descricao: it.descricao,
          codigo_ncm: it.ncm,
          registro_anvisa: it.registroAnvisa,
          cfop_id: cfopId,
          unidade_comercial: it.unidade,
          quantidade: it.quantidade,
          valor_unitario: it.valorUnitario,
          valor_desconto: it.desconto,
          valor_total: it.valorTotal,
          numero_lote: it.lote,
          data_fabricacao: it.fabricacao,
          data_validade: it.validade,
          situacao_tributaria_icms: it.cstIcms,
          situacao_tributaria_ipi: it.valorIpi > 0 ? '50' : '53',
          situacao_tributaria_pis: '08',
          situacao_tributaria_cofins: '08',
        });
        let seq = 0;
        for (const [c, base, aliq, valor] of [
          ['ICMS', it.baseIcms, it.aliquotaIcms, it.valorIcms],
          ['IPI', it.baseIpi, it.aliquotaIpi, it.valorIpi],
        ] as const) {
          const t = tributo(c);
          if (t === null || valor === 0) continue;
          await tx.incluir('tributo_item_nota_mercadoria', {
            nota_mercadoria_item_id: itemId,
            sequencia: ++seq,
            tributo_id: t,
            situacao_tributaria: c === 'ICMS' ? it.cstIcms : '50',
            valor_base_calculo: base,
            aliquota: aliq,
            valor_tributo: valor,
          });
        }
      }
      for (const r of o.referencias)
        await tx.incluir('referencia_nota_mercadoria', {
          nota_mercadoria_id: notaId,
          referenciada_nota_entrada_id: o.notaEntrada,
          tipo_referencia: nat.regra.tipoReferencia ?? 'outro',
          chave_acesso: r,
          modelo: r.slice(20, 22),
          serie: String(Number(r.slice(22, 25))),
          numero_nota: String(Number(r.slice(25, 34))),
          emitente_cnpj: r.slice(6, 20),
        });
      if (retorno)
        await tx.incluir('evento_nota_mercadoria', {
          nota_mercadoria_id: notaId,
          operacao: 'inclusao',
          tipo_evento: autorizada ? 'autorizacao' : 'rejeicao',
          protocolo: retorno.protocolo,
          codigo_status: retorno.codigo,
          mensagem_retorno: retorno.mensagem,
          arquivo_id: arquivo.id,
          dados: JSON.stringify({
            destino: e.destino,
            origem: e.origem,
            hash,
            certificadoSintetico: cert.sintetico,
          }),
          ocorrido_em: agora,
          usuario_id: ctx.usuario,
        });
      if (autorizada && o.devolucao)
        await tx.alterar('devolucao_fornecedor', o.devolucao.id, o.devolucao.versao, {
          numero_nota_fiscal: String(serie.numero),
          serie_nota_fiscal: String(serie.serie),
          chave_acesso: chave,
          data_emissao: agora.toISOString().slice(0, 10),
          cfop_id: cfopId,
          ...(o.devolucao.situacao === 'rascunho' ? { situacao: 'emitida' } : {}),
        });
      return {
        nota: notaId,
        numero: serie.numero,
        serie: serie.serie,
        chave,
        situacao,
        cfop: calculo.cfop,
        valorTotal: calculo.valorTotal,
        destino: e.destino,
        retorno: retorno?.mensagem ?? null,
      };
    },
    alvo: (_e, r) => ({ tabela: 'nota_mercadoria', id: numero(r['nota']) || null }),
  });

async function notaParaEvento(tx: Tx, est: number, nota: number) {
  const [n] = await tx.consultarParaAtualizar(
    `SELECT id, versao, situacao, ambiente, chave_acesso, autorizada_em, devolucao_fornecedor_id
       FROM nota_mercadoria WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [nota, est],
  );
  if (!n) throw recusa('nota', 'Nota não encontrada.', { campos: ['nota'] });
  return n;
}

function destinoDoEvento(n: Record<string, unknown>, destino: 'simulador' | 'sefaz'): void {
  if (texto(n['ambiente']) === 'producao' || destino !== 'simulador')
    throw recusa(
      'sefaz-indisponivel',
      'A transmissão do evento à Sefaz ainda não está ligada neste ambiente; a nota segue como está.',
    );
}

const cancelarNotaMercadoria = definirOperacao<
  z.infer<typeof esquemaCancelarNotaMercadoria>,
  ResultadoOperacao
>({
  nome: 'financeiro.cancelar_nota_mercadoria',
  tabelas: ['nota_mercadoria', 'evento_nota_mercadoria', 'devolucao_fornecedor'],
  entrada: esquemaCancelarNotaMercadoria as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const agora = new Date();
    const n = await notaParaEvento(tx, est, e.nota);
    recusar(
      conferirCancelamentoNfe({
        situacao: texto(n['situacao']),
        autorizadaEm: n['autorizada_em'] ? new Date(n['autorizada_em'] as string | Date) : null,
        agora,
        justificativa: e.justificativa,
      }),
    );
    const [m] = await tx.consultar(
      'SELECT id FROM motivo_cancelamento_documento_fiscal WHERE id = ? AND ativo = TRUE AND aplica_nota_mercadoria = TRUE',
      [e.motivo],
    );
    if (!m)
      throw recusa('motivo', 'Escolha um motivo de cancelamento ativo para a NF-e.', { campos: ['motivo'] });
    destinoDoEvento(n, e.destino);
    const chave = texto(n['chave_acesso']);
    const ret = simularSefaz({ tipo: 'cancelamento', chave, sequencia: 1 });
    await tx.alterar('nota_mercadoria', e.nota, numero(n['versao']), {
      situacao: 'cancelada',
      cancelada_em: agora,
      motivo_cancelamento_documento_fiscal_id: e.motivo,
      justificativa_cancelamento: e.justificativa,
      codigo_retorno: ret.codigo,
      mensagem_retorno: ret.mensagem,
    });
    await tx.incluir('evento_nota_mercadoria', {
      nota_mercadoria_id: e.nota,
      operacao: 'inclusao',
      tipo_evento: 'cancelamento',
      sequencia_evento: 1,
      protocolo: ret.protocolo,
      codigo_status: ret.codigo,
      mensagem_retorno: ret.mensagem,
      motivo_cancelamento_documento_fiscal_id: e.motivo,
      justificativa: e.justificativa,
      ocorrido_em: agora,
      usuario_id: ctx.usuario,
    });
    // A devolução de origem volta a aceitar nota (a cancelada fica ligada a ela, no histórico).
    const dev = n['devolucao_fornecedor_id'];
    if (dev !== null) {
      const [d] = await tx.consultarParaAtualizar(
        'SELECT versao, chave_acesso FROM devolucao_fornecedor WHERE id = ?',
        [dev],
      );
      if (d && texto(d['chave_acesso']) === chave)
        await tx.alterar('devolucao_fornecedor', numero(dev), numero(d['versao']), {
          numero_nota_fiscal: null,
          serie_nota_fiscal: null,
          chave_acesso: null,
          data_emissao: null,
          cfop_id: null,
        });
    }
    return { nota: e.nota, situacao: 'cancelada', protocolo: ret.protocolo };
  },
  alvo: (e) => ({ tabela: 'nota_mercadoria', id: e.nota }),
});

const corrigirNotaMercadoria = definirOperacao<
  z.infer<typeof esquemaCorrigirNotaMercadoria>,
  ResultadoOperacao
>({
  nome: 'financeiro.corrigir_nota_mercadoria',
  tabelas: ['nota_mercadoria', 'evento_nota_mercadoria'],
  entrada: esquemaCorrigirNotaMercadoria as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const n = await notaParaEvento(tx, est, e.nota);
    const [c] = await tx.consultar(
      "SELECT COUNT(*) AS q FROM evento_nota_mercadoria WHERE nota_mercadoria_id = ? AND tipo_evento = 'carta_correcao'",
      [e.nota],
    );
    const r = conferirCartaCorrecao({
      situacao: texto(n['situacao']),
      texto: e.texto,
      cartasAnteriores: numero(c?.['q']),
    });
    if (!r.ok) return recusar(r.recusa) as never;
    destinoDoEvento(n, e.destino);
    const ret = simularSefaz({
      tipo: 'carta_correcao',
      chave: texto(n['chave_acesso']),
      sequencia: r.sequencia,
    });
    await tx.incluir('evento_nota_mercadoria', {
      nota_mercadoria_id: e.nota,
      operacao: 'inclusao',
      tipo_evento: 'carta_correcao',
      sequencia_evento: r.sequencia,
      protocolo: ret.protocolo,
      codigo_status: ret.codigo,
      mensagem_retorno: ret.mensagem,
      texto_correcao: e.texto,
      dados: JSON.stringify({ condicaoUso: CONDICAO_USO_CCE }),
      ocorrido_em: new Date(),
      usuario_id: ctx.usuario,
    });
    return { nota: e.nota, sequencia: r.sequencia, protocolo: ret.protocolo };
  },
  alvo: (e) => ({ tabela: 'nota_mercadoria', id: e.nota }),
});

export const operacoesNotaMercadoria = (armazem: ArmazemFinanceiro, env: NodeJS.ProcessEnv = process.env) =>
  ({
    'financeiro.emitir_nota_mercadoria': emitirNotaMercadoria(armazem, env),
    'financeiro.cancelar_nota_mercadoria': cancelarNotaMercadoria,
    'financeiro.corrigir_nota_mercadoria': corrigirNotaMercadoria,
  }) as const;
export type OperacaoNotaMercadoria = keyof ReturnType<typeof operacoesNotaMercadoria>;
