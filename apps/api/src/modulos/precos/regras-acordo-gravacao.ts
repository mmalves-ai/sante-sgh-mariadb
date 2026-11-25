// Gravação das seis regras do acordo com a fonte pagadora (06-FAT linha 1) no banco do cliente, pelo Executor (trilha,
// autoria e idempotência na mesma transação). As regras de validação são do @sgh/dominio-preco (regras-acordo); aqui
// se valida pelo domínio, confere as referências no escopo da sessão e grava.
// - Incluir: a regra nova vale para o estabelecimento da sessão. A regra anterior com a mesma chave que ainda vale no
//   novo início é encerrada na véspera (nada se apaga); a que começa no mesmo dia ou depois recusa.
// - Encerrar: só a vigência, nunca antes de hoje nem de uma regra já encerrada no passado (o histórico não muda).
// O desconto por grupo e o alto custo pertencem ao acordo (contrato) da fonte no estabelecimento: o acordo é o
// vigente no início da regra (ou o mais recente).
import {
  diaAnterior,
  type ErrosRegra,
  validarAltoCusto,
  validarDescontoGrupo,
  validarEncerramentoRegra,
  validarIsento,
  validarPercentualCobranca,
  validarTeto,
  validarViaAcesso,
} from '@sgh/dominio-preco';
import {
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';

type Linha = Record<string, unknown>;

const id = z.number().int().positive();
const idN = id.nullable().default(null);
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const numN = z.number().finite().nullable().default(null);
const dataIso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);

function exigirValido(erros: ErrosRegra) {
  const campos = Object.keys(erros);
  if (campos.length) throw recusa('entrada-invalida', Object.values(erros).join(' '), { campos });
}

function estDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.', { campos: [] });
  return ctx.estabelecimento;
}

async function existe(
  tx: TxOperacao,
  tabela: string,
  valor: number | null,
  campo: string,
  doEstabelecimento: number | null = null,
) {
  if (valor === null) return;
  const r = await tx.uma(
    `SELECT id FROM ${tabela} WHERE id = ?${doEstabelecimento === null ? '' : ' AND estabelecimento_id = ?'}`,
    doEstabelecimento === null ? [valor] : [valor, doEstabelecimento],
  );
  if (!r)
    throw recusa('referencia-inexistente', `O registro informado em ${campo} não existe.`, {
      campos: [campo],
    });
}

/** O plano é da fonte pagadora da regra (ou da fonte que recebe o excedente). */
async function planoDaFonte(tx: TxOperacao, plano: number | null, fonte: number, campo: string) {
  if (plano === null) return;
  const r = await tx.uma('SELECT id FROM plano_fonte_pagadora WHERE id = ? AND fonte_pagadora_id = ?', [
    plano,
    fonte,
  ]);
  if (!r) throw recusa('referencia-inexistente', 'O plano não é dessa fonte pagadora.', { campos: [campo] });
}

async function hojeDoBanco(tx: TxOperacao): Promise<string> {
  const r = await tx.uma<Linha>("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoje", []);
  return r?.['hoje'] ? String(r['hoje']) : new Date().toISOString().slice(0, 10);
}

/** O acordo da fonte no estabelecimento: o vigente no início da regra, senão o mais recente. */
async function acordoDaFonte(tx: TxOperacao, fonte: number, est: number, inicio: string): Promise<number> {
  const r = await tx.uma<Linha>(
    `SELECT id FROM contrato_fonte_pagadora
      WHERE fonte_pagadora_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
      ORDER BY (vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)) DESC, vigencia_inicio DESC, id DESC
      LIMIT 1`,
    [fonte, est, inicio, inicio],
  );
  if (!r)
    throw recusa(
      'sem-acordo',
      'A fonte pagadora não tem acordo neste estabelecimento: cadastre o contrato antes das regras.',
      { campos: [] },
    );
  return Number(r['id']);
}

const nulo = (c: string) => `(${c} <=> ?)`;

/**
 * Encerra na véspera do novo início a regra da mesma chave que ainda vale nele (nada se apaga). A que começa no mesmo
 * dia ou depois recusa: as vigências ficariam sobrepostas.
 */
async function encerrarAnteriores(
  tx: TxOperacao,
  tabela: string,
  chave: Readonly<Record<string, unknown>>,
  inicio: string,
): Promise<number> {
  const cols = Object.keys(chave);
  const ls = await tx.consultarParaAtualizar(
    `SELECT id, versao, vigencia_inicio FROM ${tabela}
      WHERE ${cols.map(nulo).join(' AND ')} AND (vigencia_fim IS NULL OR vigencia_fim >= ?)`,
    [...cols.map((c) => chave[c] ?? null), inicio],
  );
  let n = 0;
  for (const r of ls) {
    if ((dataIso(r['vigencia_inicio']) ?? '') >= inicio)
      throw recusa(
        'vigencia-conflitante',
        'Já existe regra igual começando nessa data ou depois: encerre-a ou escolha outra data.',
        { campos: ['vigenciaInicio'] },
      );
    await tx.alterar(tabela, Number(r['id']), Number(r['versao']), { vigencia_fim: diaAnterior(inicio) });
    n++;
  }
  return n;
}

const comum = {
  fonteId: id,
  vigenciaInicio: data,
  vigenciaFim: data.nullable().default(null),
  motivoAlteracao: z.string().max(500).nullable().default(null),
};
const trilhaMotivo = (e: { motivoAlteracao: string | null }) =>
  e.motivoAlteracao?.trim() ? { motivo: e.motivoAlteracao.trim() } : {};

// ── 1) Percentual por componente ─────────────────────────────────────────────────────────────────────

export const esquemaPercentual = z.object({
  ...comum,
  tabelaId: id,
  planoId: idN,
  itemId: idN,
  grupoId: idN,
  funcaoEquipeId: idN,
  tipoContaId: idN,
  componente: z.string().max(30),
  tipoPaciente: z.string().max(20).default('todos'),
  percentual: numN,
  valorFixo: numN,
  quantidadeFixa: numN,
});

export const opIncluirPercentual = definirOperacao({
  nome: 'convenio.incluir-regra-percentual',
  tabelas: ['regra_percentual_cobranca'],
  entrada: esquemaPercentual,
  async gravar(tx, e, ctx) {
    exigirValido(validarPercentualCobranca(e));
    const est = estDe(ctx);
    await existe(tx, 'fonte_pagadora', e.fonteId, 'fonteId');
    await existe(tx, 'tabela_preco', e.tabelaId, 'tabelaId', est);
    await planoDaFonte(tx, e.planoId, e.fonteId, 'planoId');
    await existe(tx, 'item_faturavel', e.itemId, 'itemId');
    await existe(tx, 'grupo_faturamento', e.grupoId, 'grupoId');
    await existe(tx, 'funcao_equipe_cobranca', e.funcaoEquipeId, 'funcaoEquipeId');
    await existe(tx, 'tipo_conta', e.tipoContaId, 'tipoContaId');
    const contrato = await acordoDaFonte(tx, e.fonteId, est, e.vigenciaInicio).catch(() => null);
    const chave = {
      estabelecimento_id: est,
      fonte_pagadora_id: e.fonteId,
      tabela_preco_id: e.tabelaId,
      componente: e.componente,
      tipo_paciente: e.tipoPaciente,
      plano_fonte_pagadora_id: e.planoId,
      item_faturavel_id: e.itemId,
      grupo_faturamento_id: e.grupoId,
      funcao_equipe_cobranca_id: e.funcaoEquipeId,
      tipo_conta_id: e.tipoContaId,
    };
    const encerradas = await encerrarAnteriores(tx, 'regra_percentual_cobranca', chave, e.vigenciaInicio);
    const novo = await tx.incluir('regra_percentual_cobranca', {
      ...chave,
      contrato_fonte_pagadora_id: contrato,
      percentual: e.percentual,
      valor_fixo: e.valorFixo,
      quantidade_fixa: e.quantidadeFixa,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim,
    });
    return { id: novo, encerradas };
  },
  alvo: (_e, s) => ({ tabela: 'regra_percentual_cobranca', id: s.id }),
  trilha: trilhaMotivo,
});

// ── 2) Desconto ou acréscimo por grupo de despesa ────────────────────────────────────────────────────

export const esquemaDesconto = z.object({
  ...comum,
  grupoId: id,
  subgrupoId: idN,
  acrescimo: z.number().finite().default(0),
  desconto: z.number().finite().default(0),
  descricaoAcrescimo: z.string().max(60).nullable().default(null),
  descricaoDesconto: z.string().max(60).nullable().default(null),
  regimes: z.array(z.string()).default(['ambulatorial', 'externo', 'internacao', 'urgencia', 'domiciliar']),
  sobre: z.array(z.string()).default(['honorario', 'custo_operacional', 'filme']),
  destacaNaFatura: z.boolean().default(false),
});

export const opIncluirDesconto = definirOperacao({
  nome: 'convenio.incluir-regra-desconto-grupo',
  tabelas: ['regra_desconto_grupo'],
  entrada: esquemaDesconto,
  async gravar(tx, e, ctx) {
    exigirValido(validarDescontoGrupo(e));
    const est = estDe(ctx);
    await existe(tx, 'grupo_faturamento', e.grupoId, 'grupoId');
    await existe(tx, 'subgrupo_faturamento', e.subgrupoId, 'subgrupoId');
    const contrato = await acordoDaFonte(tx, e.fonteId, est, e.vigenciaInicio);
    const chave = {
      contrato_fonte_pagadora_id: contrato,
      grupo_faturamento_id: e.grupoId,
      subgrupo_faturamento_id: e.subgrupoId,
    };
    const encerradas = await encerrarAnteriores(tx, 'regra_desconto_grupo', chave, e.vigenciaInicio);
    const tem = (l: readonly string[], v: string) => l.includes(v);
    const novo = await tx.incluir('regra_desconto_grupo', {
      ...chave,
      percentual_acrescimo: e.acrescimo,
      percentual_desconto: e.desconto,
      descricao_acrescimo: e.descricaoAcrescimo,
      descricao_desconto: e.descricaoDesconto,
      aplica_ambulatorial: tem(e.regimes, 'ambulatorial'),
      aplica_externo: tem(e.regimes, 'externo'),
      aplica_internacao: tem(e.regimes, 'internacao'),
      aplica_urgencia: tem(e.regimes, 'urgencia'),
      aplica_domiciliar: tem(e.regimes, 'domiciliar'),
      sobre_honorario: tem(e.sobre, 'honorario'),
      sobre_custo_operacional: tem(e.sobre, 'custo_operacional'),
      sobre_filme: tem(e.sobre, 'filme'),
      destaca_na_fatura: e.destacaNaFatura,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim,
    });
    return { id: novo, encerradas };
  },
  alvo: (_e, s) => ({ tabela: 'regra_desconto_grupo', id: s.id }),
  trilha: trilhaMotivo,
});

// ── 3) Via de acesso na cirurgia múltipla ────────────────────────────────────────────────────────────

export const esquemaVia = z.object({
  ...comum,
  descricao: z.string().max(150),
  viaId: id,
  itemId: idN,
  tipoLancamentoId: idN,
  ordem: z.number().int(),
  percentual: z.number().finite(),
  criterio: z.string().max(20).default('maior_valor'),
});

export const opIncluirVia = definirOperacao({
  nome: 'convenio.incluir-regra-via-acesso',
  tabelas: ['regra_via_acesso'],
  entrada: esquemaVia,
  async gravar(tx, e, ctx) {
    exigirValido(validarViaAcesso(e));
    const est = estDe(ctx);
    await existe(tx, 'fonte_pagadora', e.fonteId, 'fonteId');
    await existe(tx, 'via_acesso_cirurgico', e.viaId, 'viaId');
    await existe(tx, 'item_faturavel', e.itemId, 'itemId');
    await existe(tx, 'tipo_lancamento', e.tipoLancamentoId, 'tipoLancamentoId');
    const chave = {
      via_acesso_cirurgico_id: e.viaId,
      fonte_pagadora_id: e.fonteId,
      estabelecimento_id: est,
      item_faturavel_id: e.itemId,
      ordem_procedimento: e.ordem,
    };
    const encerradas = await encerrarAnteriores(tx, 'regra_via_acesso', chave, e.vigenciaInicio);
    const novo = await tx.incluir('regra_via_acesso', {
      ...chave,
      descricao: e.descricao.trim(),
      tipo_lancamento_id: e.tipoLancamentoId,
      percentual: e.percentual,
      criterio_ordem: e.criterio,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim,
    });
    return { id: novo, encerradas };
  },
  alvo: (_e, s) => ({ tabela: 'regra_via_acesso', id: s.id }),
  trilha: trilhaMotivo,
});

// ── 4) Item isento ───────────────────────────────────────────────────────────────────────────────────

export const esquemaIsento = z.object({
  ...comum,
  itemId: idN,
  grupoId: idN,
  planoId: idN,
  regimeId: idN,
  motivo: z.string().max(500),
});

export const opIncluirIsento = definirOperacao({
  nome: 'convenio.incluir-item-isento',
  tabelas: ['item_isento_cobranca'],
  entrada: esquemaIsento,
  async gravar(tx, e, ctx) {
    exigirValido(validarIsento(e));
    const est = estDe(ctx);
    await existe(tx, 'fonte_pagadora', e.fonteId, 'fonteId');
    await existe(tx, 'item_faturavel', e.itemId, 'itemId');
    await existe(tx, 'grupo_faturamento', e.grupoId, 'grupoId');
    await planoDaFonte(tx, e.planoId, e.fonteId, 'planoId');
    await existe(tx, 'regime_atendimento', e.regimeId, 'regimeId');
    const contrato = await acordoDaFonte(tx, e.fonteId, est, e.vigenciaInicio).catch(() => null);
    const chave = {
      estabelecimento_id: est,
      fonte_pagadora_id: e.fonteId,
      item_faturavel_id: e.itemId,
      grupo_faturamento_id: e.grupoId,
      plano_fonte_pagadora_id: e.planoId,
      regime_atendimento_id: e.regimeId,
    };
    const encerradas = await encerrarAnteriores(tx, 'item_isento_cobranca', chave, e.vigenciaInicio);
    const novo = await tx.incluir('item_isento_cobranca', {
      ...chave,
      contrato_fonte_pagadora_id: contrato,
      motivo: e.motivo.trim(),
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim,
    });
    return { id: novo, encerradas };
  },
  alvo: (_e, s) => ({ tabela: 'item_isento_cobranca', id: s.id }),
  trilha: trilhaMotivo,
});

// ── 5) Teto de cobrança ──────────────────────────────────────────────────────────────────────────────

export const esquemaTeto = z.object({
  ...comum,
  planoId: idN,
  abrangencia: z.string().max(30),
  itemId: idN,
  grupoId: idN,
  valorTeto: numN,
  quantidadeMaxima: numN,
  ocorrenciasMaximas: numN,
  acao: z.string().max(30).default('alertar'),
  excedenteFonteId: idN,
  excedentePlanoId: idN,
});

export const opIncluirTeto = definirOperacao({
  nome: 'convenio.incluir-teto-cobranca',
  tabelas: ['teto_cobranca'],
  entrada: esquemaTeto,
  async gravar(tx, e, ctx) {
    exigirValido(validarTeto(e));
    const est = estDe(ctx);
    await existe(tx, 'fonte_pagadora', e.fonteId, 'fonteId');
    await planoDaFonte(tx, e.planoId, e.fonteId, 'planoId');
    await existe(tx, 'item_faturavel', e.itemId, 'itemId');
    await existe(tx, 'grupo_faturamento', e.grupoId, 'grupoId');
    await existe(tx, 'fonte_pagadora', e.excedenteFonteId, 'excedenteFonteId');
    if (e.excedenteFonteId !== null)
      await planoDaFonte(tx, e.excedentePlanoId, e.excedenteFonteId, 'excedentePlanoId');
    const chave = {
      estabelecimento_id: est,
      fonte_pagadora_id: e.fonteId,
      plano_fonte_pagadora_id: e.planoId,
      abrangencia: e.abrangencia,
      item_faturavel_id: e.itemId,
      grupo_faturamento_id: e.grupoId,
    };
    const encerradas = await encerrarAnteriores(tx, 'teto_cobranca', chave, e.vigenciaInicio);
    const novo = await tx.incluir('teto_cobranca', {
      ...chave,
      valor_teto: e.valorTeto,
      quantidade_maxima: e.quantidadeMaxima,
      ocorrencias_maximas: e.ocorrenciasMaximas,
      acao: e.acao,
      excedente_fonte_pagadora_id: e.excedenteFonteId,
      excedente_plano_fonte_pagadora_id: e.excedentePlanoId,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim,
    });
    return { id: novo, encerradas };
  },
  alvo: (_e, s) => ({ tabela: 'teto_cobranca', id: s.id }),
  trilha: trilhaMotivo,
});

// ── 6) Alto custo ────────────────────────────────────────────────────────────────────────────────────

export const esquemaAltoCusto = z.object({
  ...comum,
  planoId: idN,
  itemId: idN,
  grupoId: idN,
  regra: z.string().max(30),
  valorBase: numN,
  valorNegociado: numN,
});

export const opIncluirAltoCusto = definirOperacao({
  nome: 'convenio.incluir-alto-custo',
  tabelas: ['item_alto_custo_contrato'],
  entrada: esquemaAltoCusto,
  async gravar(tx, e, ctx) {
    exigirValido(validarAltoCusto(e));
    const est = estDe(ctx);
    await planoDaFonte(tx, e.planoId, e.fonteId, 'planoId');
    await existe(tx, 'item_faturavel', e.itemId, 'itemId');
    await existe(tx, 'grupo_faturamento', e.grupoId, 'grupoId');
    const contrato = await acordoDaFonte(tx, e.fonteId, est, e.vigenciaInicio);
    const chave = {
      contrato_fonte_pagadora_id: contrato,
      plano_fonte_pagadora_id: e.planoId,
      item_faturavel_id: e.itemId,
      grupo_faturamento_id: e.grupoId,
      // As três regras do alto custo convivem no mesmo item (preço negociado, autorização e cobrança à parte).
      regra: e.regra,
    };
    const encerradas = await encerrarAnteriores(tx, 'item_alto_custo_contrato', chave, e.vigenciaInicio);
    const novo = await tx.incluir('item_alto_custo_contrato', {
      ...chave,
      valor_base: e.valorBase,
      valor_negociado: e.valorNegociado,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim,
    });
    return { id: novo, encerradas };
  },
  alvo: (_e, s) => ({ tabela: 'item_alto_custo_contrato', id: s.id }),
  trilha: trilhaMotivo,
});

// ── Encerrar a vigência ──────────────────────────────────────────────────────────────────────────────

const esquemaEncerrar = z.object({
  fonteId: id,
  id,
  versao: z.number().int().positive(),
  vigenciaFim: data,
  motivoAlteracao: z.string().max(500).nullable().default(null),
});

/** Como achar a regra no escopo: pela própria linha (estabelecimento e fonte) ou pelo acordo a que pertence. */
const ESCOPO_REGRA = {
  percentual: {
    tabela: 'regra_percentual_cobranca',
    sql: 'SELECT r.vigencia_inicio, r.vigencia_fim FROM regra_percentual_cobranca r WHERE r.id = ? AND r.estabelecimento_id = ? AND r.fonte_pagadora_id = ?',
  },
  desconto: {
    tabela: 'regra_desconto_grupo',
    sql: `SELECT r.vigencia_inicio, r.vigencia_fim FROM regra_desconto_grupo r
            JOIN contrato_fonte_pagadora k ON k.id = r.contrato_fonte_pagadora_id
           WHERE r.id = ? AND k.estabelecimento_id = ? AND k.fonte_pagadora_id = ?`,
  },
  via: {
    tabela: 'regra_via_acesso',
    sql: 'SELECT r.vigencia_inicio, r.vigencia_fim FROM regra_via_acesso r WHERE r.id = ? AND r.estabelecimento_id = ? AND r.fonte_pagadora_id = ?',
  },
  isento: {
    tabela: 'item_isento_cobranca',
    sql: 'SELECT r.vigencia_inicio, r.vigencia_fim FROM item_isento_cobranca r WHERE r.id = ? AND r.estabelecimento_id = ? AND r.fonte_pagadora_id = ?',
  },
  teto: {
    tabela: 'teto_cobranca',
    sql: 'SELECT r.vigencia_inicio, r.vigencia_fim FROM teto_cobranca r WHERE r.id = ? AND r.estabelecimento_id = ? AND r.fonte_pagadora_id = ?',
  },
  'alto-custo': {
    tabela: 'item_alto_custo_contrato',
    sql: `SELECT r.vigencia_inicio, r.vigencia_fim FROM item_alto_custo_contrato r
            JOIN contrato_fonte_pagadora k ON k.id = r.contrato_fonte_pagadora_id
           WHERE r.id = ? AND k.estabelecimento_id = ? AND k.fonte_pagadora_id = ?`,
  },
} as const;

/**
 * Encerra a vigência da regra do estabelecimento da sessão e da fonte pedida. A regra de todos os estabelecimentos
 * (estabelecimento nulo) não se encerra de dentro de um estabelecimento: some como "não encontrada".
 */
function opEncerrarRegra(nome: string, tipo: keyof typeof ESCOPO_REGRA) {
  const { tabela, sql } = ESCOPO_REGRA[tipo];
  return definirOperacao({
    nome,
    tabelas: [tabela],
    entrada: esquemaEncerrar,
    async gravar(tx, e, ctx) {
      const r = await tx.uma<Linha>(sql, [e.id, estDe(ctx), e.fonteId]);
      if (!r)
        throw recusa('nao-encontrado', 'A regra não existe neste estabelecimento e nesta fonte pagadora.', {
          campos: ['id'],
        });
      exigirValido(
        validarEncerramentoRegra(
          dataIso(r['vigencia_inicio']) ?? '',
          dataIso(r['vigencia_fim']),
          e.vigenciaFim,
          await hojeDoBanco(tx),
        ),
      );
      const versao = await tx.alterar(tabela, e.id, e.versao, { vigencia_fim: e.vigenciaFim });
      return { id: e.id, versao };
    },
    alvo: (e) => ({ tabela, id: e.id }),
    trilha: trilhaMotivo,
  });
}

export const OPERACOES_REGRAS_ACORDO = {
  percentual: opIncluirPercentual,
  'percentual.encerrar': opEncerrarRegra('convenio.encerrar-regra-percentual', 'percentual'),
  desconto: opIncluirDesconto,
  'desconto.encerrar': opEncerrarRegra('convenio.encerrar-regra-desconto-grupo', 'desconto'),
  via: opIncluirVia,
  'via.encerrar': opEncerrarRegra('convenio.encerrar-regra-via-acesso', 'via'),
  isento: opIncluirIsento,
  'isento.encerrar': opEncerrarRegra('convenio.encerrar-item-isento', 'isento'),
  teto: opIncluirTeto,
  'teto.encerrar': opEncerrarRegra('convenio.encerrar-teto-cobranca', 'teto'),
  'alto-custo': opIncluirAltoCusto,
  'alto-custo.encerrar': opEncerrarRegra('convenio.encerrar-alto-custo', 'alto-custo'),
} as const;
export type NomeOperacaoRegraAcordo = keyof typeof OPERACOES_REGRAS_ACORDO;

/** Gravação das regras do acordo pelo Executor (trilha, autoria e idempotência). */
export class GravadorRegrasAcordo {
  private readonly executor: Executor;
  constructor(nucleo: NucleoProprio) {
    this.executor = nucleo.criarExecutor({});
  }
  async gravar(
    nome: NomeOperacaoRegraAcordo,
    ctx: ContextoOperacao,
    entrada: unknown,
  ): Promise<Record<string, unknown>> {
    const op = OPERACOES_REGRAS_ACORDO[nome] as Parameters<Executor['executar']>[0];
    const r = await this.executor.executar(op, ctx.cliente, entrada, ctx);
    return r.resultado as Record<string, unknown>;
  }
}
