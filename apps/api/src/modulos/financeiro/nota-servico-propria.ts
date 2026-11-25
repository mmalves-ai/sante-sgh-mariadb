// F3.8, 07-FIN linha 113: o ciclo da nota de serviço no banco próprio, pelo executor do @sgh/nucleo (trilha, outbox e
// idempotência na mesma transação). A emissão é sempre um lote (uma ou muitas faturas do mesmo jeito): cada nota
// entra em nota_servico com o tomador como saiu, as deduções da base com o comprovante (deducao_nota_servico), os
// tributos destacados (tributo_nota_servico, quando o tributo está no cadastro) e os eventos (evento_nota_servico).
// Cancelar e substituir exigem motivo do catálogo do cliente, justificativa e o prazo do município (regra do ISS do
// município do estabelecimento; vazio, o padrão do produto). Nada é apagado: a nota fica "cancelada" ou "substituida"
// e a substituta aponta para a original. As regras são do @sgh/dominio-financeiro (nfse.ts, nfse-ciclo.ts).
// Fora de produção a prefeitura é o simulador (a nota sai autorizada com número sintético, em ambiente de
// homologação); em produção a nota fica com o RPS gerado, à espera do provedor municipal (porta de integração).
import { createHash } from 'node:crypto';
import { centavos } from '@sgh/contratos/regras-financeiro';
import {
  calcularNfseComDeducoes,
  conferirCancelamentoNfse,
  conferirLoteNfse,
  conferirParametroNfse,
  conferirSubstituicaoNfse,
  type MotivoCatalogoNfse,
  type NfseComDeducoes,
  type PedidoNfseCompleto,
  PRAZO_NFSE_PADRAO_DIAS,
  type RecusaFinanceiro,
  simularPrefeitura,
  TIPOS_DEDUCAO_NFSE,
  xmlNfseCompleta,
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
import { instanteIso, numero, texto, versaoTexto } from './vocabulario.js';

const id = z.number().int().positive();
const dinheiro = z.number().min(0).max(999_999_999);
const hojeIso = () => new Date().toISOString().slice(0, 10);
/** A nota que ocupa a fatura: outra emissão para a mesma fatura só pela substituição. */
const ATIVAS = "('rps_gerado','enviada','autorizada')";
const SEQUENCIA_RPS = 'nota_servico_rps';
const SEQUENCIA_LOTE = 'lote_nota_servico';

function recusar(r: RecusaFinanceiro | null): void {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: r.campos } : {});
}
function estabelecimentoDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return ctx.estabelecimento;
}
const digitos = (v: unknown, n: number): string | null => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === n ? d : null;
};

// ── Entradas ───────────────────────────────────────────────────────────────────────────────────────────────────

const esquemaNota = z
  .object({
    tituloReceber: id.nullable().default(null),
    conta: id.nullable().default(null),
    momento: z.enum(['apresentacao', 'recebimento']).default('apresentacao'),
    classificacao: z.string().trim().max(10),
    itemServico: z.string().trim().max(20),
    discriminacao: z.string().trim().max(2000).default(''),
    valorServicos: dinheiro,
    aliquotaIss: z.number().min(0).max(100),
    issRetido: z.boolean().default(false),
    retencoes: z
      .object({
        ir: dinheiro.default(0),
        pis: dinheiro.default(0),
        cofins: dinheiro.default(0),
        csll: dinheiro.default(0),
        inss: dinheiro.default(0),
      })
      .strict()
      .default({ ir: 0, pis: 0, cofins: 0, csll: 0, inss: 0 }),
    deducoes: z
      .array(
        z
          .object({
            tipo: z.enum(TIPOS_DEDUCAO_NFSE),
            descricao: z.string().trim().max(150),
            documento: z.string().trim().max(60).nullable().default(null),
            valor: z.number().max(999_999_999),
          })
          .strict(),
      )
      .max(20)
      .default([]),
  })
  .strict();
type NotaEntrada = z.infer<typeof esquemaNota>;
/** O destino é decidido pelo servidor (ambiente), nunca pela tela. */
const destino = z.enum(['simulador', 'prefeitura']).default('simulador');

export const esquemaEmitirNotasServico = z.object({ destino, notas: z.array(esquemaNota).max(200) }).strict();
export const esquemaCancelarNotaServico = z
  .object({ nota: id, motivo: id, justificativa: z.string().trim().max(500) })
  .strict();
export const esquemaSubstituirNotaServico = z
  .object({ nota: id, motivo: id, justificativa: z.string().trim().max(500), destino, nova: esquemaNota })
  .strict();
export const esquemaPrazoNotaServico = z
  .object({
    prazoCancelamentoDias: z.number(),
    prazoSubstituicaoDias: z.number(),
    /** Só na primeira vez, quando o município ainda não tem regra do ISS: a alíquota geral (%). */
    aliquota: z.number().min(0).max(5).nullable().default(null),
  })
  .strict();

// ── Leituras ───────────────────────────────────────────────────────────────────────────────────────────────────

interface Municipio {
  readonly id: number;
  readonly ibge: string;
  readonly nome: string;
}

async function municipioDoEstabelecimento(l: Leitor, est: number): Promise<Municipio | null> {
  const m = await l.uma<Record<string, unknown>>(
    `SELECT m.id, m.codigo_ibge, m.nome FROM estabelecimento e JOIN municipio_ibge m ON m.id = e.municipio_ibge_id
      WHERE e.id = ?`,
    [est],
  );
  return m ? { id: numero(m['id']), ibge: texto(m['codigo_ibge']), nome: texto(m['nome']) } : null;
}

/** A regra do ISS vigente do município (a geral antes da de um serviço), com os prazos; sem regra, o padrão. */
async function regraDoMunicipio(l: Leitor, est: number, municipio: number, dia: string) {
  const r = await l.uma<Record<string, unknown>>(
    `SELECT id, versao, aliquota, retido_tomador, prazo_cancelamento_dias, prazo_substituicao_dias
       FROM regra_iss_municipio
      WHERE estabelecimento_id = ? AND municipio_ibge_id = ? AND ativo = TRUE AND vigencia_inicio <= ?
        AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
      ORDER BY (servico_lc116_id IS NULL) DESC, vigencia_inicio DESC LIMIT 1`,
    [est, municipio, dia, dia],
  );
  const prazo = (v: unknown) => (v === null || v === undefined ? PRAZO_NFSE_PADRAO_DIAS : numero(v));
  return {
    regra: r ? numero(r['id']) : null,
    versao: r ? numero(r['versao']) : 0,
    aliquota: r ? numero(r['aliquota']) : null,
    issRetido: r ? Boolean(Number(r['retido_tomador'])) : false,
    prazoCancelamentoDias: prazo(r?.['prazo_cancelamento_dias']),
    prazoSubstituicaoDias: prazo(r?.['prazo_substituicao_dias']),
    padrao: !r || r['prazo_cancelamento_dias'] === null || r['prazo_substituicao_dias'] === null,
  };
}

/** O que a tela precisa antes de emitir: o município do estabelecimento, a alíquota e os prazos dele. */
export async function parametrosNotaServico(l: Leitor, est: number) {
  const municipio = await municipioDoEstabelecimento(l, est);
  const regra = municipio ? await regraDoMunicipio(l, est, municipio.id, hojeIso()) : null;
  return {
    municipio: municipio ? { ibge: municipio.ibge, nome: municipio.nome } : null,
    aliquota: regra?.aliquota ?? null,
    issRetido: regra?.issRetido ?? false,
    prazoCancelamentoDias: regra?.prazoCancelamentoDias ?? PRAZO_NFSE_PADRAO_DIAS,
    prazoSubstituicaoDias: regra?.prazoSubstituicaoDias ?? PRAZO_NFSE_PADRAO_DIAS,
    prazoPadrao: regra?.padrao ?? true,
    temRegra: !!regra?.regra,
  };
}

/** Os motivos ativos do catálogo do cliente que valem para a nota de serviço. */
export async function motivosNotaServico(l: Leitor) {
  const linhas = await l.consultar(
    `SELECT id, codigo, descricao, justificativa_padrao FROM motivo_cancelamento_documento_fiscal
      WHERE ativo = TRUE AND aplica_nota_servico = TRUE ORDER BY descricao LIMIT 200`,
    [],
  );
  return linhas.map((r) => ({
    id: numero(r['id']),
    codigo: texto(r['codigo']),
    descricao: texto(r['descricao']),
    justificativaPadrao: r['justificativa_padrao'] === null ? null : texto(r['justificativa_padrao']),
  }));
}

/** As faturas (títulos a receber vivos) do estabelecimento que ainda não têm nota ativa: a seleção do lote. */
export async function faturasSemNotaServico(l: Leitor, est: number) {
  const linhas = await l.consultar(
    `SELECT t.id, t.numero, t.numero_documento, DATE_FORMAT(t.data_emissao, '%Y-%m-%d') AS emissao, t.valor_bruto,
            t.situacao, COALESCE(f.nome, pf.nome, c.nome) AS devedor
       FROM titulo_receber t
       LEFT JOIN fonte_pagadora f ON f.id = t.fonte_pagadora_id
       LEFT JOIN paciente p ON p.id = t.paciente_id
       LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
       LEFT JOIN cliente_financeiro c ON c.id = t.cliente_financeiro_id
      WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL AND t.situacao NOT IN ('cancelado','renegociado')
        AND NOT EXISTS (SELECT 1 FROM nota_servico n WHERE n.titulo_receber_id = t.id AND n.excluido_em IS NULL
                         AND n.situacao IN ${ATIVAS})
      ORDER BY t.data_emissao DESC, t.id DESC LIMIT 200`,
    [est],
  );
  return linhas.map((r) => ({
    titulo: numero(r['id']),
    numero: texto(r['numero']),
    documento: texto(r['numero_documento']),
    emissao: texto(r['emissao']),
    valor: numero(r['valor_bruto']),
    situacao: texto(r['situacao']),
    devedor: texto(r['devedor']),
  }));
}

/** As notas do estabelecimento, da mais nova para a mais antiga, com o que a linha da tela mostra. */
export async function notasServico(l: Leitor, est: number, situacao: string | null = null) {
  const linhas = await l.consultar(
    `SELECT n.id, n.versao, n.numero_rps, n.numero_nota, n.ambiente, n.data_emissao, n.titulo_receber_id,
            n.conta_hospitalar_id, n.tomador_nome, n.valor_servicos, n.valor_deducoes, n.base_calculo, n.aliquota_iss,
            n.valor_iss, n.iss_retido, n.valor_liquido, n.situacao, n.substitui_nota_servico_id, n.cancelada_em,
            lo.numero_lote, t.numero AS titulo_numero,
            (SELECT s.id FROM nota_servico s WHERE s.substitui_nota_servico_id = n.id AND s.excluido_em IS NULL
              ORDER BY s.id DESC LIMIT 1) AS substituta
       FROM nota_servico n
       LEFT JOIN lote_nota_servico lo ON lo.id = n.lote_nota_servico_id
       LEFT JOIN titulo_receber t ON t.id = n.titulo_receber_id
      WHERE n.estabelecimento_id = ? AND n.excluido_em IS NULL AND (? IS NULL OR n.situacao = ?)
      ORDER BY n.id DESC LIMIT 300`,
    [est, situacao, situacao],
  );
  return linhas.map((r) => ({
    id: numero(r['id']),
    versao: versaoTexto(r['versao']),
    rps: numero(r['numero_rps']),
    numero: r['numero_nota'] === null ? null : texto(r['numero_nota']),
    ambiente: texto(r['ambiente']),
    emitidaEm: instanteIso(r['data_emissao']),
    tituloReceber: r['titulo_receber_id'] === null ? null : numero(r['titulo_receber_id']),
    tituloNumero: r['titulo_numero'] === null ? null : texto(r['titulo_numero']),
    conta: r['conta_hospitalar_id'] === null ? null : numero(r['conta_hospitalar_id']),
    tomador: texto(r['tomador_nome']),
    valorServicos: numero(r['valor_servicos']),
    valorDeducoes: numero(r['valor_deducoes']),
    baseCalculo: numero(r['base_calculo']),
    aliquotaIss: numero(r['aliquota_iss']),
    valorIss: numero(r['valor_iss']),
    issRetido: Boolean(Number(r['iss_retido'])),
    valorLiquido: numero(r['valor_liquido']),
    situacao: texto(r['situacao']),
    lote: r['numero_lote'] === null ? null : numero(r['numero_lote']),
    substitui: r['substitui_nota_servico_id'] === null ? null : numero(r['substitui_nota_servico_id']),
    substituta: r['substituta'] === null ? null : numero(r['substituta']),
  }));
}

/** O histórico da nota: os eventos na ordem em que aconteceram, as deduções e os tributos destacados. */
export async function historicoNotaServico(l: Leitor, est: number, nota: number) {
  const n = await l.uma<Record<string, unknown>>(
    'SELECT id, numero_nota, situacao FROM nota_servico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [nota, est],
  );
  if (!n) return null;
  const eventos = await l.consultar(
    `SELECT e.id, e.tipo_evento, e.ocorrido_em, e.protocolo, e.motivo, e.substituta_nota_servico_id,
            m.descricao AS motivo_catalogo, u.nome AS usuario
       FROM evento_nota_servico e
       LEFT JOIN motivo_cancelamento_documento_fiscal m ON m.id = e.motivo_cancelamento_documento_fiscal_id
       LEFT JOIN usuario u ON u.id = e.usuario_id
      WHERE e.nota_servico_id = ? ORDER BY e.id LIMIT 200`,
    [nota],
  );
  const deducoes = await l.consultar(
    `SELECT sequencia, tipo, descricao, valor, comprovante_numero FROM deducao_nota_servico
      WHERE nota_servico_id = ? AND excluido_em IS NULL ORDER BY sequencia LIMIT 50`,
    [nota],
  );
  const tributos = await l.consultar(
    `SELECT tr.codigo, x.retido, x.valor_base_calculo, x.aliquota, x.valor_tributo, x.classificacao_tributaria
       FROM tributo_nota_servico x JOIN tributo tr ON tr.id = x.tributo_id
      WHERE x.nota_servico_id = ? AND x.excluido_em IS NULL ORDER BY x.sequencia LIMIT 20`,
    [nota],
  );
  return {
    nota,
    numero: n['numero_nota'] === null ? null : texto(n['numero_nota']),
    situacao: texto(n['situacao']),
    eventos: eventos.map((e) => ({
      id: numero(e['id']),
      tipo: texto(e['tipo_evento']),
      em: instanteIso(e['ocorrido_em']),
      protocolo: e['protocolo'] === null ? null : texto(e['protocolo']),
      motivo: e['motivo_catalogo'] === null ? null : texto(e['motivo_catalogo']),
      justificativa: e['motivo'] === null ? null : texto(e['motivo']),
      substituta: e['substituta_nota_servico_id'] === null ? null : numero(e['substituta_nota_servico_id']),
      usuario: e['usuario'] === null ? null : texto(e['usuario']),
    })),
    deducoes: deducoes.map((d) => ({
      sequencia: numero(d['sequencia']),
      tipo: texto(d['tipo']),
      descricao: texto(d['descricao']),
      valor: numero(d['valor']),
      documento: d['comprovante_numero'] === null ? null : texto(d['comprovante_numero']),
    })),
    tributos: tributos.map((x) => ({
      tributo: texto(x['codigo']),
      retido: Boolean(Number(x['retido'])),
      base: numero(x['valor_base_calculo']),
      aliquota: numero(x['aliquota']),
      valor: numero(x['valor_tributo']),
      classificacao: x['classificacao_tributaria'] === null ? null : texto(x['classificacao_tributaria']),
    })),
  };
}

// ── Gravação ───────────────────────────────────────────────────────────────────────────────────────────────────

type Tx = TxOperacao;

interface Tomador {
  readonly tipo: 'pessoa_fisica' | 'pessoa_juridica';
  readonly nome: string;
  readonly documento: string;
  readonly pessoaFisica: number | null;
  readonly pessoaJuridica: number | null;
  readonly fontePagadora: number | null;
  readonly clienteFinanceiro: number | null;
  readonly atendimento: number | null;
  readonly conta: number | null;
  readonly fatura: number | null;
  readonly titulo: { readonly id: number; readonly versao: number } | null;
}

const idOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : numero(v));

/** O tomador da nota, lido do cadastro pela fatura (título a receber) ou pela conta do particular. */
async function tomadorDaNota(
  tx: Tx,
  est: number,
  n: NotaEntrada,
  rotulo: string,
  campo: string,
): Promise<Tomador> {
  let pessoa: Record<string, unknown> | null | undefined;
  let base: Omit<Tomador, 'tipo' | 'nome' | 'documento' | 'pessoaFisica' | 'pessoaJuridica'>;
  if (n.tituloReceber !== null) {
    const [t] = await tx.consultarParaAtualizar(
      `SELECT id, versao, situacao, tipo_devedor, fonte_pagadora_id, paciente_id, cliente_financeiro_id,
              conta_hospitalar_id, fatura_fonte_pagadora_id, atendimento_id
         FROM titulo_receber WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [n.tituloReceber, est],
      { teto: 1 },
    );
    if (!t || ['cancelado', 'renegociado'].includes(texto(t['situacao'])))
      throw recusa('titulo-inexistente', `${rotulo}a fatura não existe ou foi cancelada.`, {
        campos: [campo],
      });
    const tipo = texto(t['tipo_devedor']);
    pessoa =
      tipo === 'fonte_pagadora'
        ? await tx.uma(
            `SELECT COALESCE(j.razao_social, f.nome) AS nome, NULL AS cpf, j.cnpj, NULL AS pf, j.id AS pj
               FROM fonte_pagadora f LEFT JOIN pessoa_juridica j ON j.id = f.pessoa_juridica_id WHERE f.id = ?`,
            [t['fonte_pagadora_id']],
          )
        : tipo === 'paciente'
          ? await tx.uma(
              `SELECT f.nome, f.cpf, NULL AS cnpj, f.id AS pf, NULL AS pj
                 FROM paciente p JOIN pessoa_fisica f ON f.id = p.pessoa_fisica_id WHERE p.id = ?`,
              [t['paciente_id']],
            )
          : await tx.uma(
              'SELECT nome, cpf, cnpj, pessoa_fisica_id AS pf, pessoa_juridica_id AS pj FROM cliente_financeiro WHERE id = ?',
              [t['cliente_financeiro_id']],
            );
    base = {
      fontePagadora: idOuNulo(t['fonte_pagadora_id']),
      clienteFinanceiro: idOuNulo(t['cliente_financeiro_id']),
      atendimento: idOuNulo(t['atendimento_id']),
      conta: idOuNulo(t['conta_hospitalar_id']),
      fatura: idOuNulo(t['fatura_fonte_pagadora_id']),
      titulo: { id: numero(t['id']), versao: numero(t['versao']) },
    };
  } else {
    const c = await tx.uma<Record<string, unknown>>(
      `SELECT c.id, c.atendimento_id, f.nome, f.cpf, f.id AS pf
         FROM conta_hospitalar c JOIN paciente p ON p.id = c.paciente_id
         JOIN pessoa_fisica f ON f.id = p.pessoa_fisica_id
        WHERE c.id = ? AND c.estabelecimento_id = ?`,
      [n.conta, est],
    );
    if (!c) throw recusa('conta-inexistente', `${rotulo}a conta não existe.`, { campos: [campo] });
    pessoa = { nome: c['nome'], cpf: c['cpf'], cnpj: null, pf: c['pf'], pj: null };
    base = {
      fontePagadora: null,
      clienteFinanceiro: null,
      atendimento: idOuNulo(c['atendimento_id']),
      conta: numero(c['id']),
      fatura: null,
      titulo: null,
    };
  }
  if (!pessoa)
    throw recusa('devedor-inexistente', `${rotulo}o devedor da fatura não existe mais no cadastro.`);
  const cnpj = digitos(pessoa['cnpj'], 14);
  const cpf = digitos(pessoa['cpf'], 11);
  if (!cnpj && !cpf)
    throw recusa(
      'tomador-sem-documento',
      `${rotulo}o tomador não tem CPF nem CNPJ no cadastro; complete o cadastro antes de emitir a nota.`,
      { campos: [campo] },
    );
  return {
    ...base,
    tipo: cnpj ? 'pessoa_juridica' : 'pessoa_fisica',
    nome: texto(pessoa['nome']).slice(0, 250),
    documento: (cnpj ?? cpf) as string,
    pessoaFisica: cnpj ? null : idOuNulo(pessoa['pf']),
    pessoaJuridica: cnpj ? idOuNulo(pessoa['pj']) : null,
  };
}

const pedidoDe = (n: NotaEntrada): PedidoNfseCompleto => n;

interface NotaGravada {
  readonly id: number;
  readonly rps: number;
  readonly numero: string | null;
  readonly calculo: NfseComDeducoes;
}

/** Grava UMA nota já conferida: a nota, as deduções, os tributos destacados, os eventos e a ligação com a fatura. */
async function incluirNota(
  tx: Tx,
  ctx: ContextoOperacao,
  p: {
    est: number;
    municipio: Municipio;
    nota: NotaEntrada;
    tomador: Tomador;
    lote: number | null;
    paraOnde: 'simulador' | 'prefeitura';
    substitui: { id: number; numero: string | null } | null;
    agora: Date;
  },
): Promise<NotaGravada> {
  const { nota: n, tomador, agora } = p;
  const calculo = calcularNfseComDeducoes(n);
  const rps = (await tx.proximoNumero(SEQUENCIA_RPS)).valor;
  const xml = xmlNfseCompleta({
    ...calculo,
    numeroRps: String(rps),
    tomador: tomador.documento,
    itemServico: n.itemServico,
    substitui: p.substitui ? (p.substitui.numero ?? String(p.substitui.id)) : null,
  });
  const simulada = p.paraOnde === 'simulador' ? simularPrefeitura(xml, rps) : null;
  const dia = agora.toISOString().slice(0, 10);
  const notaId = await tx.incluir('nota_servico', {
    estabelecimento_id: p.est,
    lote_nota_servico_id: p.lote,
    numero_rps: rps,
    numero_nota: simulada?.numero ?? null,
    ambiente: simulada ? 'homologacao' : 'producao',
    data_emissao: agora,
    competencia: `${dia.slice(0, 7)}-01`,
    municipio_prestacao_id: p.municipio.id,
    tipo_tomador: tomador.tipo,
    pessoa_fisica_id: tomador.pessoaFisica,
    pessoa_juridica_id: tomador.pessoaJuridica,
    fonte_pagadora_id: tomador.fontePagadora,
    cliente_financeiro_id: tomador.clienteFinanceiro,
    tomador_nome: tomador.nome,
    tomador_documento: tomador.documento,
    atendimento_id: tomador.atendimento,
    conta_hospitalar_id: tomador.conta,
    fatura_fonte_pagadora_id: tomador.fatura,
    titulo_receber_id: tomador.titulo?.id ?? null,
    discriminacao: n.discriminacao || `Serviços de saúde (item ${n.itemServico} da lista de serviços)`,
    valor_servicos: calculo.valorServicos,
    valor_deducoes: calculo.valorDeducoes,
    base_calculo: calculo.baseCalculo,
    aliquota_iss: n.aliquotaIss,
    valor_iss: calculo.valorIss,
    iss_retido: calculo.issRetido,
    valor_pis: centavos(n.retencoes.pis),
    valor_cofins: centavos(n.retencoes.cofins),
    valor_inss: centavos(n.retencoes.inss),
    valor_ir: centavos(n.retencoes.ir),
    valor_csll: centavos(n.retencoes.csll),
    valor_liquido: calculo.valorLiquido,
    situacao: simulada ? 'autorizada' : 'rps_gerado',
    substitui_nota_servico_id: p.substitui?.id ?? null,
  });
  for (const [i, d] of n.deducoes.entries())
    await tx.incluir('deducao_nota_servico', {
      nota_servico_id: notaId,
      sequencia: i + 1,
      tipo: d.tipo,
      descricao: d.descricao,
      valor: centavos(d.valor),
      comprovante_numero: d.documento || null,
    });
  // Os tributos destacados entram quando o tributo existe no cadastro do cliente (pelo código); os valores do ISS
  // ficam sempre na própria nota, e os do IBS e da CBS, também no evento da emissão.
  const destacados = [
    { codigo: 'ISS', aliquota: n.aliquotaIss, valor: calculo.valorIss, retido: calculo.issRetido },
    { codigo: 'IBS', aliquota: 0.1, valor: calculo.valorIbs, retido: false },
    { codigo: 'CBS', aliquota: 0.9, valor: calculo.valorCbs, retido: false },
  ];
  const cadastrados = await tx.consultar(
    "SELECT id, UPPER(codigo) AS codigo FROM tributo WHERE UPPER(codigo) IN ('ISS','IBS','CBS') AND ativo = TRUE",
    [],
  );
  let sequencia = 0;
  for (const d of destacados) {
    const tributo = cadastrados.find((c) => texto(c['codigo']) === d.codigo);
    if (!tributo) continue;
    await tx.incluir('tributo_nota_servico', {
      nota_servico_id: notaId,
      sequencia: ++sequencia,
      tributo_id: tributo['id'],
      classificacao_tributaria: d.codigo === 'ISS' ? null : n.classificacao || null,
      retido: d.retido,
      valor_base_calculo: calculo.baseCalculo,
      aliquota: d.aliquota,
      valor_tributo: d.valor,
    });
  }
  const evento = (tipo: string, extra: Record<string, unknown> = {}) =>
    tx.incluir('evento_nota_servico', {
      nota_servico_id: notaId,
      operacao: 'inclusao',
      tipo_evento: tipo,
      ocorrido_em: agora,
      usuario_id: ctx.usuario,
      ...extra,
    });
  await evento('emissao', {
    dados: JSON.stringify({
      momento: n.momento,
      classificacao: n.classificacao,
      itemServico: n.itemServico,
      valorIbs: calculo.valorIbs,
      valorCbs: calculo.valorCbs,
      retencoesFederais: calculo.retencoesFederais,
      destino: p.paraOnde,
      hashXml: createHash('sha256').update(xml).digest('hex'),
    }),
  });
  if (simulada)
    await evento('autorizacao', {
      protocolo: simulada.numero,
      mensagem_retorno: 'Autorizada pelo simulador da prefeitura (fora de produção).',
    });
  if (tomador.titulo)
    await tx.alterar('titulo_receber', tomador.titulo.id, tomador.titulo.versao, { nota_servico_id: notaId });
  return { id: notaId, rps, numero: simulada?.numero ?? null, calculo };
}

async function municipioExigido(tx: Tx, est: number): Promise<Municipio> {
  const m = await municipioDoEstabelecimento(tx, est);
  if (!m)
    throw recusa(
      'municipio-estabelecimento',
      'O estabelecimento está sem município no cadastro: informe-o antes de emitir a nota de serviço.',
    );
  return m;
}

async function garantirNumeracao(tx: Tx, ctx: ContextoOperacao, est: number, agora: Date): Promise<void> {
  // A linha da numeração do RPS serializa as emissões do estabelecimento (a mesma fatura não ganha duas notas).
  for (const tipo of [SEQUENCIA_RPS, SEQUENCIA_LOTE])
    await garantirSequencia(tx, { tipo, estabelecimento: est, prefixo: '' }, { usuario: ctx.usuario, agora });
}

const emitirNotasServico = definirOperacao<z.infer<typeof esquemaEmitirNotasServico>, ResultadoOperacao>({
  nome: 'financeiro.emitir_notas_servico',
  tabelas: [
    'lote_nota_servico',
    'nota_servico',
    'deducao_nota_servico',
    'tributo_nota_servico',
    'evento_nota_servico',
    'titulo_receber',
    'sequencia_negocio',
  ],
  entrada: esquemaEmitirNotasServico as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const agora = new Date();
    const municipio = await municipioExigido(tx, est);
    await garantirNumeracao(tx, ctx, est, agora);
    const numeroLote = (await tx.proximoNumero(SEQUENCIA_LOTE)).valor;
    const titulos = e.notas.flatMap((n) => (n.tituloReceber === null ? [] : [n.tituloReceber]));
    const contas = e.notas.flatMap((n) => (n.tituloReceber === null && n.conta !== null ? [n.conta] : []));
    const ph = (v: readonly number[]) => (v.length ? v.map(() => '?').join(', ') : 'NULL');
    const ativas = await tx.consultar(
      `SELECT titulo_receber_id, conta_hospitalar_id FROM nota_servico
        WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao IN ${ATIVAS}
          AND (titulo_receber_id IN (${ph(titulos)})
               OR (titulo_receber_id IS NULL AND conta_hospitalar_id IN (${ph(contas)})))`,
      [est, ...titulos, ...contas],
    );
    recusar(
      conferirLoteNfse(
        e.notas.map(pedidoDe),
        ativas.map((a) => ({
          tituloReceber: idOuNulo(a['titulo_receber_id']),
          conta: a['titulo_receber_id'] === null ? idOuNulo(a['conta_hospitalar_id']) : null,
        })),
      ),
    );
    const tomadores: Tomador[] = [];
    for (const [i, n] of e.notas.entries())
      tomadores.push(
        await tomadorDaNota(
          tx,
          est,
          n,
          `Nota ${i + 1}: `,
          `notas.${i}.${n.tituloReceber !== null ? 'tituloReceber' : 'conta'}`,
        ),
      );
    const calculos = e.notas.map((n) => calcularNfseComDeducoes(n));
    const dia = agora.toISOString().slice(0, 10);
    const simulador = e.destino === 'simulador';
    const lote = await tx.incluir('lote_nota_servico', {
      estabelecimento_id: est,
      numero_lote: numeroLote,
      versao_leiaute: '1.00',
      metodo_envio: 'sincrono',
      quantidade_rps: e.notas.length,
      valor_total_servicos: centavos(calculos.reduce((s, c) => s + c.valorServicos, 0)),
      valor_total_deducoes: centavos(calculos.reduce((s, c) => s + c.valorDeducoes, 0)),
      data_inicio: dia,
      data_fim: dia,
      protocolo: simulador ? `SIM-L${numeroLote}` : null,
      enviado_em: simulador ? agora : null,
      recebido_em: simulador ? agora : null,
      situacao: simulador ? 'processado' : 'gerado',
      mensagem_retorno: simulador ? 'Lote processado pelo simulador da prefeitura (fora de produção).' : null,
    });
    const gravadas: NotaGravada[] = [];
    for (const [i, n] of e.notas.entries())
      gravadas.push(
        await incluirNota(tx, ctx, {
          est,
          municipio,
          nota: n,
          tomador: tomadores[i] as Tomador,
          lote,
          paraOnde: e.destino,
          substitui: null,
          agora,
        }),
      );
    // O resultado da operação é plano (vai à trilha e à idempotência): as notas saem pela ordem do pedido.
    return {
      lote,
      numeroLote,
      quantidade: gravadas.length,
      valorServicos: centavos(calculos.reduce((s, c) => s + c.valorServicos, 0)),
      valorLiquido: centavos(gravadas.reduce((s, g) => s + g.calculo.valorLiquido, 0)),
      destino: e.destino,
      notas: gravadas.map((g) => g.id).join(','),
      numeros: gravadas.map((g) => g.numero ?? '').join(','),
    };
  },
  alvo: (_e, r) => ({ tabela: 'lote_nota_servico', id: numero(r['lote']) || null }),
});

/** A nota a alterar, travada, com o motivo lido do catálogo e os prazos do município onde o serviço foi prestado. */
async function notaParaAlterar(tx: Tx, est: number, nota: number, motivoId: number) {
  const [n] = await tx.consultarParaAtualizar(
    `SELECT id, versao, situacao, numero_nota, DATE_FORMAT(data_emissao, '%Y-%m-%d') AS emitida, titulo_receber_id,
            conta_hospitalar_id, municipio_prestacao_id
       FROM nota_servico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [nota, est],
    { teto: 1 },
  );
  if (!n) throw recusa('nota-inexistente', 'A nota não existe.', { campos: ['nota'] });
  const m = await tx.uma<Record<string, unknown>>(
    'SELECT id, codigo, ativo, aplica_nota_servico FROM motivo_cancelamento_documento_fiscal WHERE id = ?',
    [motivoId],
  );
  const motivo: MotivoCatalogoNfse | null = m
    ? {
        id: numero(m['id']),
        codigo: texto(m['codigo']),
        ativo: Boolean(Number(m['ativo'])),
        aplicaNotaServico: Boolean(Number(m['aplica_nota_servico'])),
      }
    : null;
  const hoje = hojeIso();
  const prazos = await regraDoMunicipio(tx, est, numero(n['municipio_prestacao_id']), hoje);
  const titulo = idOuNulo(n['titulo_receber_id']);
  return {
    linha: n,
    motivo,
    hoje,
    prazos,
    emitida: {
      situacao: texto(n['situacao']),
      emitidaEm: texto(n['emitida']),
      tituloReceber: titulo,
      // A nota da fatura guarda também a conta de origem; para a regra, o alvo é a fatura.
      conta: titulo === null ? idOuNulo(n['conta_hospitalar_id']) : null,
    },
  };
}

/** A fatura deixa de apontar para a nota encerrada (ou passa a apontar para a substituta). */
async function religarFatura(tx: Tx, titulo: number | null, de: number, para: number | null): Promise<void> {
  if (titulo === null) return;
  const [t] = await tx.consultarParaAtualizar(
    'SELECT id, versao, nota_servico_id FROM titulo_receber WHERE id = ?',
    [titulo],
    { teto: 1 },
  );
  if (t && idOuNulo(t['nota_servico_id']) === de)
    await tx.alterar('titulo_receber', titulo, numero(t['versao']), { nota_servico_id: para });
}

const cancelarNotaServico = definirOperacao<z.infer<typeof esquemaCancelarNotaServico>, ResultadoOperacao>({
  nome: 'financeiro.cancelar_nota_servico',
  tabelas: ['nota_servico', 'evento_nota_servico', 'titulo_receber'],
  entrada: esquemaCancelarNotaServico as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const a = await notaParaAlterar(tx, est, e.nota, e.motivo);
    recusar(
      conferirCancelamentoNfse(a.emitida, a.motivo, e.justificativa, a.hoje, a.prazos.prazoCancelamentoDias),
    );
    const agora = new Date();
    await tx.alterar('nota_servico', e.nota, numero(a.linha['versao']), {
      situacao: 'cancelada',
      cancelada_em: agora,
      motivo_cancelamento_documento_fiscal_id: e.motivo,
    });
    const evento = await tx.incluir('evento_nota_servico', {
      nota_servico_id: e.nota,
      operacao: 'alteracao',
      tipo_evento: 'cancelamento',
      motivo_cancelamento_documento_fiscal_id: e.motivo,
      motivo: e.justificativa,
      ocorrido_em: agora,
      usuario_id: ctx.usuario,
    });
    await religarFatura(tx, a.emitida.tituloReceber, e.nota, null);
    return { nota: e.nota, situacao: 'cancelada', evento };
  },
  alvo: (e) => ({ tabela: 'nota_servico', id: e.nota }),
});

const substituirNotaServico = definirOperacao<
  z.infer<typeof esquemaSubstituirNotaServico>,
  ResultadoOperacao
>({
  nome: 'financeiro.substituir_nota_servico',
  tabelas: [
    'nota_servico',
    'deducao_nota_servico',
    'tributo_nota_servico',
    'evento_nota_servico',
    'titulo_receber',
    'sequencia_negocio',
  ],
  entrada: esquemaSubstituirNotaServico as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const agora = new Date();
    const municipio = await municipioExigido(tx, est);
    await garantirNumeracao(tx, ctx, est, agora);
    const a = await notaParaAlterar(tx, est, e.nota, e.motivo);
    recusar(
      conferirSubstituicaoNfse(
        a.emitida,
        a.motivo,
        e.justificativa,
        a.hoje,
        a.prazos.prazoSubstituicaoDias,
        pedidoDe(e.nova),
      ),
    );
    const campo = e.nova.tituloReceber !== null ? 'nova.tituloReceber' : 'nova.conta';
    const tomador = await tomadorDaNota(tx, est, e.nova, '', campo);
    // A original sai de cena antes de a substituta entrar: a fatura nunca fica com duas notas ativas.
    await tx.alterar('nota_servico', e.nota, numero(a.linha['versao']), {
      situacao: 'substituida',
      motivo_cancelamento_documento_fiscal_id: e.motivo,
    });
    const nova = await incluirNota(tx, ctx, {
      est,
      municipio,
      nota: e.nova,
      tomador,
      lote: null,
      paraOnde: e.destino,
      substitui: {
        id: e.nota,
        numero: a.linha['numero_nota'] === null ? null : texto(a.linha['numero_nota']),
      },
      agora,
    });
    const evento = await tx.incluir('evento_nota_servico', {
      nota_servico_id: e.nota,
      operacao: 'alteracao',
      tipo_evento: 'substituicao',
      substituta_nota_servico_id: nova.id,
      motivo_cancelamento_documento_fiscal_id: e.motivo,
      motivo: e.justificativa,
      ocorrido_em: agora,
      usuario_id: ctx.usuario,
    });
    return {
      nota: e.nota,
      situacao: 'substituida',
      substituta: nova.id,
      rps: nova.rps,
      numero: nova.numero,
      liquido: nova.calculo.valorLiquido,
      evento,
    };
  },
  alvo: (e) => ({ tabela: 'nota_servico', id: e.nota }),
});

const definirPrazoNotaServico = definirOperacao<z.infer<typeof esquemaPrazoNotaServico>, ResultadoOperacao>({
  nome: 'financeiro.definir_prazo_nota_servico',
  tabelas: ['regra_iss_municipio'],
  entrada: esquemaPrazoNotaServico as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const municipio = await municipioExigido(tx, est);
    recusar(
      conferirParametroNfse({
        municipioIbge: municipio.ibge,
        prazoCancelamentoDias: e.prazoCancelamentoDias,
        prazoSubstituicaoDias: e.prazoSubstituicaoDias,
      }),
    );
    const hoje = hojeIso();
    const prazos = {
      prazo_cancelamento_dias: e.prazoCancelamentoDias,
      prazo_substituicao_dias: e.prazoSubstituicaoDias,
    };
    // O prazo é do município: vale para todas as regras vigentes dele (a geral e as de cada serviço).
    const vigentes = await tx.consultarParaAtualizar(
      `SELECT id, versao FROM regra_iss_municipio
        WHERE estabelecimento_id = ? AND municipio_ibge_id = ? AND ativo = TRUE AND vigencia_inicio <= ?
          AND (vigencia_fim IS NULL OR vigencia_fim >= ?) ORDER BY id`,
      [est, municipio.id, hoje, hoje],
      { teto: 500 },
    );
    if (vigentes.length === 0) {
      if (e.aliquota === null)
        throw recusa(
          'aliquota-obrigatoria',
          'O município ainda não tem regra do ISS: informe a alíquota geral junto com os prazos.',
          { campos: ['aliquota'] },
        );
      const regra = await tx.incluir('regra_iss_municipio', {
        estabelecimento_id: est,
        municipio_ibge_id: municipio.id,
        aliquota: e.aliquota,
        vigencia_inicio: hoje,
        ...prazos,
      });
      return { regra, regras: 1, criada: true, ...e };
    }
    for (const r of vigentes)
      await tx.alterar('regra_iss_municipio', numero(r['id']), numero(r['versao']), prazos);
    return { regra: numero(vigentes[0]?.['id']), regras: vigentes.length, criada: false, ...e };
  },
  alvo: (_e, r) => ({ tabela: 'regra_iss_municipio', id: numero(r['regra']) || null }),
});

/** As operações desta parte, pelo nome da rota. */
export const OPERACOES_NOTA_SERVICO = {
  'financeiro.emitirNotasServico': emitirNotasServico,
  'financeiro.cancelarNotaServico': cancelarNotaServico,
  'financeiro.substituirNotaServico': substituirNotaServico,
  'financeiro.definirPrazoNotaServico': definirPrazoNotaServico,
} as const;
