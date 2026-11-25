// Restrição de cobertura por fonte pagadora e compatibilidade entre procedimentos (F7, 09-AREA linha 76) sobre o banco
// do cliente. Leituras pelo Leitor e gravações pelo Executor (trilha, autoria e idempotência na mesma transação). As
// regras são do @sgh/dominio-faturamento (cobertura/restricao-cobertura): aqui só se lê, confere pelo domínio e grava.
// - Cadastro: restrição (restricao_cobertura_fonte_pagadora) com os critérios (restricao_cobertura_criterio, trocados
//   por exclusão lógica: o critério antigo fica com excluido_em), pares de compatibilidade (compatibilidade_procedimento)
//   e justificativas padronizadas (justificativa_excecao_cobertura).
// - Exceção do atendimento (restricao_cobertura_excecao): liberação com justificativa, autor e quantidade; revogar só
//   marca excluido_em (a liberação usada fica no histórico).
// - Crítica: no lançamento da conta bloqueia antes da glosa (a exceção libera e fica na memória do item); na prescrição
//   só avisa (o bloqueio vira alerta, para não impedir o ato assistencial).
import {
  avaliarCobertura,
  type CriterioCobertura,
  type ExcecaoCobertura,
  type ItemJaLancado,
  type LancamentoCobertura,
  type ParCompatibilidade,
  type PeriodoCriterio,
  type RestricaoCobertura,
  type ResultadoCobertura,
  TIPOS_ATENDIMENTO_COBERTURA,
  TIPOS_CRITERIO_COBERTURA,
  TIPOS_RELACAO_PROCEDIMENTO,
  TIPOS_RESTRICAO_COBERTURA,
  type TipoAtendimentoCobertura,
  tipoAtendimentoDaNatureza,
  validarExcecaoCobertura,
  validarParCompatibilidade,
  validarRestricaoCobertura,
} from '@sgh/dominio-faturamento';
import {
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';

type Linha = Record<string, unknown>;
type Consulta = Pick<Leitor, 'consultar' | 'uma'>;

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const txn = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const b = (v: unknown) => v === true || v === 1 || v === '1';
const dataIso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
const hora = (v: unknown) => (v === null || v === undefined ? null : String(v).slice(0, 5));
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');

function exigirValido(erros: Record<string, string>) {
  const campos = Object.keys(erros);
  if (campos.length) throw recusa('entrada-invalida', Object.values(erros).join(' '), { campos });
}
function estDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.', { campos: [] });
  return ctx.estabelecimento;
}

// ── Leitura das regras ───────────────────────────────────────────────────────────────────────────────

const COLUNAS_RESTRICAO = `r.id, r.versao, r.estabelecimento_id, r.descricao, r.fonte_pagadora_id, r.plano_fonte_pagadora_id,
  r.item_faturavel_id, r.grupo_faturamento_id, r.tabela_preco_id, r.tipo_restricao, r.acao, r.tipo_atendimento,
  r.valor_limite, r.quantidade_limite, r.mensagem, r.vigencia_inicio, r.vigencia_fim, r.ativo`;

function criterioDe(c: Linha): CriterioCobertura & { id: number; sequencia: number } {
  return {
    id: n(c['id']),
    sequencia: n(c['sequencia']),
    tipo: String(c['tipo_criterio']) as CriterioCobertura['tipo'],
    setorId: nn(c['setor_funcional_id']),
    idadeMinima: nn(c['idade_minima']),
    idadeMaxima: nn(c['idade_maxima']),
    horaInicio: hora(c['hora_inicio']),
    horaFim: hora(c['hora_fim']),
    diaSemana: nn(c['dia_semana']),
    profissionalId: nn(c['profissional_id']),
    prestadorId: nn(c['prestador_terceiro_id']),
    prestadorProfissionalId: nn(c['prestador_profissional_id']),
    planoId: nn(c['plano_fonte_pagadora_id']),
    empresaId: nn(c['empresa_pessoa_juridica_id']),
    quantidadeMaxima: nn(c['quantidade_maxima']),
    periodo: txn(c['periodo']) as PeriodoCriterio | null,
    tipoAtendimento: txn(c['tipo_atendimento']) as TipoAtendimentoCobertura | null,
  };
}

async function criteriosDas(l: Consulta, ids: number[]) {
  if (!ids.length) return new Map<number, ReturnType<typeof criterioDe>[]>();
  const linhas = await l.consultar<Linha>(
    `SELECT c.*, p.profissional_id AS prestador_profissional_id
       FROM restricao_cobertura_criterio c
       LEFT JOIN prestador_terceiro p ON p.id = c.prestador_terceiro_id
      WHERE c.restricao_cobertura_fonte_pagadora_id IN (${lista(ids.length)}) AND c.excluido_em IS NULL
      ORDER BY c.restricao_cobertura_fonte_pagadora_id, c.sequencia`,
    ids,
  );
  const m = new Map<number, ReturnType<typeof criterioDe>[]>();
  for (const c of linhas) {
    const k = n(c['restricao_cobertura_fonte_pagadora_id']);
    m.set(k, [...(m.get(k) ?? []), criterioDe(c)]);
  }
  return m;
}

function restricaoDe(r: Linha, criterios: CriterioCobertura[]): RestricaoCobertura & { versao: number } {
  return {
    id: n(r['id']),
    versao: n(r['versao']),
    descricao: String(r['descricao']),
    estabelecimentoId: nn(r['estabelecimento_id']),
    fontePagadoraId: n(r['fonte_pagadora_id']),
    planoId: nn(r['plano_fonte_pagadora_id']),
    itemId: nn(r['item_faturavel_id']),
    grupoId: nn(r['grupo_faturamento_id']),
    tabelaId: nn(r['tabela_preco_id']),
    tipo: String(r['tipo_restricao']) as RestricaoCobertura['tipo'],
    acao: String(r['acao']) === 'alertar' ? 'alertar' : 'bloquear',
    tipoAtendimento: txn(r['tipo_atendimento']) as TipoAtendimentoCobertura | null,
    valorLimite: nn(r['valor_limite']),
    quantidadeLimite: nn(r['quantidade_limite']),
    mensagem: txn(r['mensagem']),
    vigenciaInicio: dataIso(r['vigencia_inicio']) ?? '',
    vigenciaFim: dataIso(r['vigencia_fim']),
    ativo: b(r['ativo']),
    criterios,
  };
}

async function restricoesDaFonte(l: Consulta, est: number, fonte: number) {
  const linhas = await l.consultar<Linha>(
    `SELECT ${COLUNAS_RESTRICAO} FROM restricao_cobertura_fonte_pagadora r
      WHERE r.fonte_pagadora_id = ? AND r.ativo = 1 AND (r.estabelecimento_id IS NULL OR r.estabelecimento_id = ?)`,
    [fonte, est],
  );
  const crit = await criteriosDas(
    l,
    linhas.map((r) => n(r['id'])),
  );
  return linhas.map((r) => restricaoDe(r, crit.get(n(r['id'])) ?? []));
}

function parDe(p: Linha): ParCompatibilidade & { versao: number } {
  return {
    id: n(p['id']),
    versao: n(p['versao']),
    fontePagadoraId: nn(p['fonte_pagadora_id']),
    itemId: n(p['item_faturavel_id']),
    relacionadoId: n(p['relacionado_item_faturavel_id']),
    tipo: String(p['tipo_relacao']) as ParCompatibilidade['tipo'],
    exigeItem: b(p['exige_item']),
    quantidadeLimite: nn(p['quantidade_limite']),
    validadeDias: nn(p['validade_dias']),
    vigenciaInicio: dataIso(p['vigencia_inicio']) ?? '',
    vigenciaFim: dataIso(p['vigencia_fim']),
    ativo: b(p['ativo']),
  };
}

async function paresDoItem(l: Consulta, item: number, fonte: number) {
  const linhas = await l.consultar<Linha>(
    `SELECT * FROM compatibilidade_procedimento
      WHERE ativo = 1 AND (fonte_pagadora_id IS NULL OR fonte_pagadora_id = ?)
        AND (item_faturavel_id = ? OR relacionado_item_faturavel_id = ?)`,
    [fonte, item, item],
  );
  return linhas.map(parDe);
}

async function excecoesDoAtendimento(l: Consulta, atendimento: number): Promise<ExcecaoCobertura[]> {
  const linhas = await l.consultar<Linha>(
    `SELECT id, restricao_cobertura_fonte_pagadora_id, item_faturavel_id, grupo_faturamento_id, quantidade_autorizada,
            aplica_internacao, aplica_ambulatorial, aplica_externo, aplica_urgencia, aplica_domiciliar
       FROM restricao_cobertura_excecao WHERE atendimento_id = ? AND excluido_em IS NULL`,
    [atendimento],
  );
  return linhas.map((x) => ({
    id: n(x['id']),
    restricaoId: nn(x['restricao_cobertura_fonte_pagadora_id']),
    itemId: nn(x['item_faturavel_id']),
    grupoId: nn(x['grupo_faturamento_id']),
    quantidadeAutorizada: nn(x['quantidade_autorizada']),
    tiposAtendimento: TIPOS_ATENDIMENTO_COBERTURA.filter((t) => b(x[`aplica_${t}`])),
  }));
}

// ── Contexto do atendimento (idade, carteira, tipo) ──────────────────────────────────────────────────

interface ContextoAtendimento {
  atendimento: number;
  paciente: number;
  fonte: number;
  plano: number | null;
  natureza: string;
  nascimento: string | null;
  empresa: number | null;
  autorizado: boolean;
  conta: number | null;
}

const idadeEm = (nasc: string | null, data: string): number | null => {
  if (!nasc) return null;
  const [an, mn, dn] = nasc.split('-').map(Number);
  const [a, m, d] = data.split('-').map(Number);
  return a! - an! - (m! < mn! || (m === mn && d! < dn!) ? 1 : 0);
};

async function contextoDaConta(l: Consulta, est: number, conta: number): Promise<ContextoAtendimento> {
  const c = await l.uma<Linha>(
    `SELECT c.id, c.atendimento_id, c.paciente_id, c.fonte_pagadora_id, c.plano_fonte_pagadora_id, c.natureza,
            c.senha_autorizacao, c.guia_fonte_pagadora_id, pf.data_nascimento, cp.empresa_pessoa_juridica_id
       FROM conta_hospitalar c
       JOIN paciente p ON p.id = c.paciente_id
       JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
       LEFT JOIN cobertura_paciente cp ON cp.id = c.cobertura_paciente_id
      WHERE c.id = ? AND c.estabelecimento_id = ?`,
    [conta, est],
  );
  if (!c) throw recusa('nao-encontrado', 'A conta não existe neste estabelecimento.', { campos: ['conta'] });
  return {
    atendimento: n(c['atendimento_id']),
    paciente: n(c['paciente_id']),
    fonte: n(c['fonte_pagadora_id']),
    plano: nn(c['plano_fonte_pagadora_id']),
    natureza: String(c['natureza']),
    nascimento: dataIso(c['data_nascimento']),
    empresa: nn(c['empresa_pessoa_juridica_id']),
    autorizado: txn(c['senha_autorizacao']) !== null || c['guia_fonte_pagadora_id'] != null,
    conta: n(c['id']),
  };
}

/** A conta aberta do atendimento (a mais recente) ou, sem conta, o próprio atendimento. */
async function contextoDoAtendimento(l: Consulta, est: number, atendimento: number) {
  const c = await l.uma<Linha>(
    `SELECT id FROM conta_hospitalar WHERE atendimento_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
        AND situacao NOT IN ('cancelada') ORDER BY id DESC LIMIT 1`,
    [atendimento, est],
  );
  if (c) return contextoDaConta(l, est, n(c['id']));
  const a = await l.uma<Linha>(
    `SELECT a.id, a.paciente_id, a.fonte_pagadora_id, pf.data_nascimento
       FROM atendimento a JOIN paciente p ON p.id = a.paciente_id JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
      WHERE a.id = ? AND a.estabelecimento_id = ?`,
    [atendimento, est],
  );
  if (!a)
    throw recusa('nao-encontrado', 'O atendimento não existe neste estabelecimento.', {
      campos: ['atendimentoId'],
    });
  return {
    atendimento: n(a['id']),
    paciente: n(a['paciente_id']),
    fonte: n(a['fonte_pagadora_id']),
    plano: null,
    natureza: 'ambulatorial',
    nascimento: dataIso(a['data_nascimento']),
    empresa: null,
    autorizado: false,
    conta: null,
  } satisfies ContextoAtendimento;
}

const INICIO_JANELA: Record<Exclude<PeriodoCriterio, 'atendimento'>, string> = {
  dia: 'DATE(?)',
  semana: 'DATE_SUB(DATE(?), INTERVAL WEEKDAY(?) DAY)',
  mes: "DATE_FORMAT(?, '%Y-%m-01')",
  ano: "DATE_FORMAT(?, '%Y-01-01')",
};

/** O que o atendimento já tem do item (por janela) e os itens da conta, para quantidades e compatibilidade. */
async function historicoDoItem(l: Consulta, ctxA: ContextoAtendimento, item: number, data: string) {
  const naConta: ItemJaLancado[] = ctxA.conta
    ? (
        await l.consultar<Linha>(
          `SELECT item_faturavel_id, DATE(realizado_em) AS dia, quantidade FROM conta_hospitalar_item
            WHERE conta_hospitalar_id = ? AND situacao <> 'estornado' AND excluido_em IS NULL`,
          [ctxA.conta],
        )
      ).map((x) => ({
        itemId: n(x['item_faturavel_id']),
        data: dataIso(x['dia']) ?? data,
        quantidade: n(x['quantidade']),
      }))
    : [];
  const anteriores: Partial<Record<PeriodoCriterio, number>> = {
    atendimento: naConta.filter((x) => x.itemId === item).reduce((s, x) => s + x.quantidade, 0),
  };
  for (const [p, inicio] of Object.entries(INICIO_JANELA) as [
    Exclude<PeriodoCriterio, 'atendimento'>,
    string,
  ][]) {
    const params = p === 'semana' ? [data, data] : [data];
    const r = await l.uma<Linha>(
      `SELECT COALESCE(SUM(i.quantidade), 0) AS q FROM conta_hospitalar_item i
         JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id
        WHERE c.paciente_id = ? AND c.fonte_pagadora_id = ? AND i.item_faturavel_id = ? AND i.situacao <> 'estornado'
          AND i.excluido_em IS NULL AND i.realizado_em >= ${inicio} AND DATE(i.realizado_em) <= DATE(?)`,
      [ctxA.paciente, ctxA.fonte, item, ...params, data],
    );
    anteriores[p] = n(r?.['q']);
  }
  return { naConta, anteriores };
}

export interface PedidoCobertura {
  readonly contexto: 'lancamento' | 'prescricao';
  readonly itemId: number;
  readonly grupoId: number | null;
  readonly tabelaId: number | null;
  readonly data: string;
  readonly hora: string;
  readonly setorId: number | null;
  readonly profissionalId: number | null;
  readonly quantidade: number;
  readonly valorTotal: number | null;
  readonly justificado: boolean;
}

async function avaliar(
  l: Consulta,
  est: number,
  ctxA: ContextoAtendimento,
  p: PedidoCobertura,
): Promise<ResultadoCobertura> {
  const restricoes = await restricoesDaFonte(l, est, ctxA.fonte);
  const pares = await paresDoItem(l, p.itemId, ctxA.fonte);
  if (!restricoes.length && !pares.length) return { situacao: 'livre', achados: [] };
  const excecoes = await excecoesDoAtendimento(l, ctxA.atendimento);
  const hist = await historicoDoItem(l, ctxA, p.itemId, p.data);
  const lanc: LancamentoCobertura = {
    contexto: p.contexto,
    estabelecimentoId: est,
    fontePagadoraId: ctxA.fonte,
    planoId: ctxA.plano,
    itemId: p.itemId,
    grupoId: p.grupoId,
    tabelaId: p.tabelaId,
    data: p.data,
    hora: p.hora,
    setorId: p.setorId,
    idade: idadeEm(ctxA.nascimento, p.data),
    profissionalId: p.profissionalId,
    empresaId: ctxA.empresa,
    tipoAtendimento: tipoAtendimentoDaNatureza(ctxA.natureza),
    quantidade: p.quantidade,
    valorTotal: p.valorTotal,
    autorizado: ctxA.autorizado,
    justificado: p.justificado,
    anteriores: hist.anteriores,
    naConta: hist.naConta,
  };
  return avaliarCobertura(lanc, restricoes, excecoes, pares);
}

/**
 * O item faturável do que se confere: pelo id, pelo código, ou (na prescrição) pelo item prescritível, cujo item
 * faturável próprio vale antes do item faturável do insumo ligado; o cuidado de enfermagem vai pelo item prescritível
 * ligado a ele. Sem ligação, não há o que conferir (o item é livre para a cobertura).
 */
async function itemFaturavelDoPedido(
  l: Consulta,
  it: {
    codigo?: string | undefined;
    itemId?: number | undefined;
    itemPrescritivelId?: number | undefined;
    cuidadoId?: number | undefined;
  },
): Promise<Linha | null> {
  if (it.itemId)
    return l.uma<Linha>(
      'SELECT id, codigo, descricao, grupo_faturamento_id FROM item_faturavel WHERE id = ?',
      [it.itemId],
    );
  if (it.codigo)
    return l.uma<Linha>(
      'SELECT id, codigo, descricao, grupo_faturamento_id FROM item_faturavel WHERE codigo = ? AND excluido_em IS NULL LIMIT 1',
      [it.codigo],
    );
  const prescritivel = it.itemPrescritivelId
    ? it.itemPrescritivelId
    : it.cuidadoId
      ? nn(
          (
            await l.uma<Linha>('SELECT item_prescritivel_id FROM cuidado_enfermagem WHERE id = ?', [
              it.cuidadoId,
            ])
          )?.['item_prescritivel_id'],
        )
      : null;
  if (!prescritivel) return null;
  return l.uma<Linha>(
    `SELECT f.id, f.codigo, f.descricao, f.grupo_faturamento_id
       FROM item_prescritivel ip
       LEFT JOIN insumo s ON s.id = ip.insumo_id
       JOIN item_faturavel f ON f.id = COALESCE(ip.item_faturavel_id, s.item_faturavel_id) AND f.excluido_em IS NULL
      WHERE ip.id = ?`,
    [prescritivel],
  );
}

/** Tabelas que a crítica lê no lançamento (o lançamento não grava nelas). */
export const TABELAS_COBERTURA_LANCAMENTO = [
  'restricao_cobertura_fonte_pagadora',
  'restricao_cobertura_criterio',
  'restricao_cobertura_excecao',
  'compatibilidade_procedimento',
] as const;

/**
 * A crítica no lançamento da conta: bloqueio recusa ('cobertura-restrita', nada é gravado); alerta e liberação por
 * exceção voltam para a memória do item.
 */
export async function conferirCoberturaNoLancamento(
  tx: TxOperacao,
  est: number,
  conta: number,
  p: Omit<PedidoCobertura, 'contexto'>,
): Promise<ResultadoCobertura | null> {
  const ctxA = await contextoDaConta(tx, est, conta);
  const r = await avaliar(tx, est, ctxA, { ...p, contexto: 'lancamento' });
  const bloqueio = r.achados.find((a) => a.efeito === 'bloqueio');
  if (bloqueio)
    throw recusa('cobertura-restrita', `${bloqueio.motivo} Registre a exceção do atendimento para liberar.`, {
      campos: ['codigo'],
    });
  return r.achados.length ? r : null;
}

/** O aviso na prescrição (e a prévia do lançamento): nada bloqueia, só informa. */
export async function avaliarCoberturaPropria(
  l: Leitor,
  est: number,
  pedido: {
    atendimentoId: number;
    contexto: 'lancamento' | 'prescricao';
    data: string;
    hora: string;
    setorId: number | null;
    profissionalId: number | null;
    itens: {
      codigo?: string | undefined;
      itemId?: number | undefined;
      itemPrescritivelId?: number | undefined;
      cuidadoId?: number | undefined;
      quantidade: number;
    }[];
  },
) {
  const ctxA = await contextoDoAtendimento(l, est, pedido.atendimentoId);
  const saida = [];
  for (const it of pedido.itens.slice(0, 50)) {
    const item = await itemFaturavelDoPedido(l, it);
    if (!item) {
      saida.push({
        codigo: it.codigo ?? null,
        itemId: it.itemId ?? null,
        itemPrescritivelId: it.itemPrescritivelId ?? null,
        cuidadoId: it.cuidadoId ?? null,
        situacao: 'livre',
        achados: [],
      });
      continue;
    }
    const r = await avaliar(l, est, ctxA, {
      contexto: pedido.contexto,
      itemId: n(item['id']),
      grupoId: nn(item['grupo_faturamento_id']),
      tabelaId: null,
      data: pedido.data,
      hora: pedido.hora,
      setorId: pedido.setorId,
      profissionalId: pedido.profissionalId,
      quantidade: it.quantidade,
      valorTotal: null,
      justificado: false,
    });
    saida.push({
      codigo: String(item['codigo']),
      itemId: n(item['id']),
      itemPrescritivelId: it.itemPrescritivelId ?? null,
      cuidadoId: it.cuidadoId ?? null,
      descricao: String(item['descricao']),
      ...r,
    });
  }
  return { atendimentoId: ctxA.atendimento, fontePagadoraId: ctxA.fonte, itens: saida };
}

// ── Painel do cadastro ───────────────────────────────────────────────────────────────────────────────

export async function painelCoberturaPropria(l: Leitor, est: number, fonte: number | null) {
  const restr = await l.consultar<Linha>(
    `SELECT ${COLUNAS_RESTRICAO}, f.nome AS fonte_nome, i.codigo AS item_codigo, i.descricao AS item_descricao,
            g.descricao AS grupo_descricao, t.descricao AS tabela_descricao, pl.descricao AS plano_descricao
       FROM restricao_cobertura_fonte_pagadora r
       JOIN fonte_pagadora f ON f.id = r.fonte_pagadora_id
       LEFT JOIN item_faturavel i ON i.id = r.item_faturavel_id
       LEFT JOIN grupo_faturamento g ON g.id = r.grupo_faturamento_id
       LEFT JOIN tabela_preco t ON t.id = r.tabela_preco_id
       LEFT JOIN plano_fonte_pagadora pl ON pl.id = r.plano_fonte_pagadora_id
      WHERE (r.estabelecimento_id IS NULL OR r.estabelecimento_id = ?) AND (? IS NULL OR r.fonte_pagadora_id = ?)
      ORDER BY r.ativo DESC, f.nome, r.descricao LIMIT 500`,
    [est, fonte, fonte],
  );
  const crit = await criteriosDas(
    l,
    restr.map((r) => n(r['id'])),
  );
  const pares = await l.consultar<Linha>(
    `SELECT p.*, a.codigo AS item_codigo, a.descricao AS item_descricao, b.codigo AS relacionado_codigo,
            b.descricao AS relacionado_descricao, f.nome AS fonte_nome
       FROM compatibilidade_procedimento p
       JOIN item_faturavel a ON a.id = p.item_faturavel_id
       JOIN item_faturavel b ON b.id = p.relacionado_item_faturavel_id
       LEFT JOIN fonte_pagadora f ON f.id = p.fonte_pagadora_id
      WHERE (? IS NULL OR p.fonte_pagadora_id IS NULL OR p.fonte_pagadora_id = ?)
      ORDER BY p.ativo DESC, a.codigo LIMIT 500`,
    [fonte, fonte],
  );
  const justificativas = await l.consultar<Linha>(
    'SELECT id, codigo, descricao, texto_padrao FROM justificativa_excecao_cobertura WHERE ativo = 1 ORDER BY descricao',
    [],
  );
  const fontes = await l.consultar<Linha>(
    'SELECT id, nome FROM fonte_pagadora WHERE excluido_em IS NULL ORDER BY nome LIMIT 500',
    [],
  );
  const planos = fonte
    ? await l.consultar<Linha>(
        'SELECT id, descricao FROM plano_fonte_pagadora WHERE fonte_pagadora_id = ? ORDER BY descricao',
        [fonte],
      )
    : [];
  const setores = await l.consultar<Linha>(
    'SELECT id, nome FROM setor_funcional WHERE estabelecimento_id = ? AND ativo = 1 AND excluido_em IS NULL ORDER BY nome',
    [est],
  );
  const grupos = await l.consultar<Linha>(
    'SELECT id, descricao FROM grupo_faturamento ORDER BY descricao',
    [],
  );
  const tabelas = await l.consultar<Linha>(
    'SELECT id, descricao FROM tabela_preco WHERE (estabelecimento_id IS NULL OR estabelecimento_id = ?) ORDER BY descricao LIMIT 300',
    [est],
  );
  const prestadores = await l.consultar<Linha>(
    'SELECT id, nome FROM prestador_terceiro WHERE estabelecimento_id = ? AND ativo = 1 AND excluido_em IS NULL ORDER BY nome LIMIT 500',
    [est],
  );
  return {
    restricoes: restr.map((r) => ({
      ...restricaoDe(r, crit.get(n(r['id'])) ?? []),
      fonteNome: String(r['fonte_nome']),
      planoDescricao: txn(r['plano_descricao']),
      itemCodigo: txn(r['item_codigo']),
      itemDescricao: txn(r['item_descricao']),
      grupoDescricao: txn(r['grupo_descricao']),
      tabelaDescricao: txn(r['tabela_descricao']),
    })),
    pares: pares.map((p) => ({
      ...parDe(p),
      itemCodigo: String(p['item_codigo']),
      itemDescricao: String(p['item_descricao']),
      relacionadoCodigo: String(p['relacionado_codigo']),
      relacionadoDescricao: String(p['relacionado_descricao']),
      fonteNome: txn(p['fonte_nome']),
    })),
    opcoes: {
      justificativas: justificativas.map((j) => ({
        id: n(j['id']),
        codigo: String(j['codigo']),
        descricao: String(j['descricao']),
        textoPadrao: txn(j['texto_padrao']),
      })),
      fontes: fontes.map((f) => ({ id: n(f['id']), nome: String(f['nome']) })),
      planos: planos.map((p) => ({ id: n(p['id']), descricao: String(p['descricao']) })),
      setores: setores.map((s) => ({ id: n(s['id']), nome: String(s['nome']) })),
      grupos: grupos.map((g) => ({ id: n(g['id']), descricao: String(g['descricao']) })),
      tabelas: tabelas.map((t) => ({ id: n(t['id']), descricao: String(t['descricao']) })),
      prestadores: prestadores.map((p) => ({ id: n(p['id']), nome: String(p['nome']) })),
    },
  };
}

/** Busca de item faturável por código ou descrição (a tela nunca pede id digitado). */
export async function buscarItensCobertura(l: Leitor, termo: string) {
  const t = termo.trim();
  if (t.length < 2) return [];
  const linhas = await l.consultar<Linha>(
    `SELECT id, codigo, descricao, grupo_faturamento_id FROM item_faturavel
      WHERE excluido_em IS NULL AND (codigo LIKE ? OR descricao LIKE ?) ORDER BY codigo LIMIT 30`,
    [`${t}%`, `%${t}%`],
  );
  return linhas.map((x) => ({
    id: n(x['id']),
    codigo: String(x['codigo']),
    descricao: String(x['descricao']),
    grupoId: nn(x['grupo_faturamento_id']),
  }));
}

/** As exceções do atendimento (visão do paciente), com a fonte e as restrições que podem ser liberadas. */
export async function excecoesAtendimentoPropria(l: Leitor, est: number, atendimento: number) {
  const ctxA = await contextoDoAtendimento(l, est, atendimento);
  const linhas = await l.consultar<Linha>(
    `SELECT x.id, x.versao, x.restricao_cobertura_fonte_pagadora_id, x.item_faturavel_id, x.grupo_faturamento_id,
            x.quantidade_autorizada, x.numero_guia, x.observacao, x.autorizado_em, x.excluido_em,
            x.aplica_internacao, x.aplica_ambulatorial, x.aplica_externo, x.aplica_urgencia, x.aplica_domiciliar,
            j.descricao AS justificativa, u.nome AS autor, i.codigo AS item_codigo, i.descricao AS item_descricao,
            g.descricao AS grupo_descricao, r.descricao AS restricao_descricao
       FROM restricao_cobertura_excecao x
       JOIN justificativa_excecao_cobertura j ON j.id = x.justificativa_excecao_cobertura_id
       JOIN usuario u ON u.id = x.autorizado_por_usuario_id
       LEFT JOIN item_faturavel i ON i.id = x.item_faturavel_id
       LEFT JOIN grupo_faturamento g ON g.id = x.grupo_faturamento_id
       LEFT JOIN restricao_cobertura_fonte_pagadora r ON r.id = x.restricao_cobertura_fonte_pagadora_id
      WHERE x.atendimento_id = ? AND x.estabelecimento_id = ? ORDER BY x.autorizado_em DESC`,
    [atendimento, est],
  );
  const restricoes = await restricoesDaFonte(l, est, ctxA.fonte);
  return {
    atendimentoId: ctxA.atendimento,
    fontePagadoraId: ctxA.fonte,
    tipoAtendimento: tipoAtendimentoDaNatureza(ctxA.natureza),
    excecoes: linhas.map((x) => ({
      id: n(x['id']),
      versao: n(x['versao']),
      restricaoId: nn(x['restricao_cobertura_fonte_pagadora_id']),
      restricaoDescricao: txn(x['restricao_descricao']),
      itemId: nn(x['item_faturavel_id']),
      itemCodigo: txn(x['item_codigo']),
      itemDescricao: txn(x['item_descricao']),
      grupoDescricao: txn(x['grupo_descricao']),
      quantidadeAutorizada: nn(x['quantidade_autorizada']),
      numeroGuia: txn(x['numero_guia']),
      observacao: txn(x['observacao']),
      justificativa: String(x['justificativa']),
      autor: String(x['autor']),
      autorizadoEm:
        x['autorizado_em'] instanceof Date ? x['autorizado_em'].toISOString() : String(x['autorizado_em']),
      revogada: x['excluido_em'] !== null,
      tiposAtendimento: TIPOS_ATENDIMENTO_COBERTURA.filter((t) => b(x[`aplica_${t}`])),
    })),
    restricoes: restricoes
      .filter((r) => r.acao === 'bloquear')
      .map((r) => ({ id: r.id, descricao: r.descricao, itemId: r.itemId, grupoId: r.grupoId })),
  };
}

// ── Gravações ───────────────────────────────────────────────────────────────────────────────────────

const id = z.number().int().positive();
const idNulo = id.nullable().default(null);
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const horaZ = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .nullable()
  .default(null);

const esquemaCriterio = z
  .object({
    tipo: z.enum(TIPOS_CRITERIO_COBERTURA),
    setorId: idNulo,
    idadeMinima: z.number().int().min(0).max(150).nullable().default(null),
    idadeMaxima: z.number().int().min(0).max(150).nullable().default(null),
    horaInicio: horaZ,
    horaFim: horaZ,
    diaSemana: z.number().int().min(1).max(7).nullable().default(null),
    profissionalId: idNulo,
    prestadorId: idNulo,
    planoId: idNulo,
    empresaId: idNulo,
    quantidadeMaxima: z.number().positive().max(99_999).nullable().default(null),
    periodo: z.enum(['dia', 'semana', 'mes', 'ano', 'atendimento']).nullable().default(null),
    tipoAtendimento: z.enum(TIPOS_ATENDIMENTO_COBERTURA).nullable().default(null),
  })
  .strict();

const esquemaRestricao = z
  .object({
    id: idNulo,
    versao: z.number().int().positive().nullable().default(null),
    todosEstabelecimentos: z.boolean().default(false),
    descricao: z.string().trim().min(1).max(150),
    fontePagadoraId: id,
    planoId: idNulo,
    itemId: idNulo,
    grupoId: idNulo,
    tabelaId: idNulo,
    tipo: z.enum(TIPOS_RESTRICAO_COBERTURA),
    acao: z.enum(['bloquear', 'alertar']).default('bloquear'),
    tipoAtendimento: z.enum(TIPOS_ATENDIMENTO_COBERTURA).nullable().default(null),
    valorLimite: z.number().positive().max(99_999_999).nullable().default(null),
    quantidadeLimite: z.number().positive().max(99_999).nullable().default(null),
    mensagem: z.string().trim().max(500).nullable().default(null),
    vigenciaInicio: data,
    vigenciaFim: data.nullable().default(null),
    ativo: z.boolean().default(true),
    criterios: z.array(esquemaCriterio).max(20).default([]),
  })
  .strict();

async function exigirExiste(
  tx: TxOperacao,
  sql: string,
  valor: number | null,
  campo: string,
  rotulo: string,
) {
  if (valor !== null && !(await tx.uma(sql, [valor])))
    throw recusa('referencia-inexistente', `${rotulo} não existe.`, { campos: [campo] });
}

export const opGravarRestricao = definirOperacao({
  nome: 'faturamento.gravar-restricao-cobertura',
  tabelas: ['restricao_cobertura_fonte_pagadora', 'restricao_cobertura_criterio'],
  entrada: esquemaRestricao,
  alvo: (_e, s) => ({ tabela: 'restricao_cobertura_fonte_pagadora', id: Number(s['id']) }),
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    exigirValido(validarRestricaoCobertura(e));
    await exigirExiste(
      tx,
      'SELECT id FROM fonte_pagadora WHERE id = ?',
      e.fontePagadoraId,
      'fontePagadoraId',
      'A fonte pagadora',
    );
    if (
      e.planoId !== null &&
      !(await tx.uma('SELECT id FROM plano_fonte_pagadora WHERE id = ? AND fonte_pagadora_id = ?', [
        e.planoId,
        e.fontePagadoraId,
      ]))
    )
      throw recusa('referencia-inexistente', 'O plano não é desta fonte pagadora.', { campos: ['planoId'] });
    await exigirExiste(tx, 'SELECT id FROM item_faturavel WHERE id = ?', e.itemId, 'itemId', 'O item');
    await exigirExiste(tx, 'SELECT id FROM grupo_faturamento WHERE id = ?', e.grupoId, 'grupoId', 'O grupo');
    await exigirExiste(tx, 'SELECT id FROM tabela_preco WHERE id = ?', e.tabelaId, 'tabelaId', 'A tabela');
    for (const [i, c] of e.criterios.entries()) {
      if (c.tipo === 'setor')
        if (
          !(await tx.uma('SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ?', [
            c.setorId,
            est,
          ]))
        )
          throw recusa('referencia-inexistente', 'O setor não existe neste estabelecimento.', {
            campos: [`criterios.${i}`],
          });
      if (c.tipo === 'prestador')
        await exigirExiste(
          tx,
          'SELECT id FROM prestador_terceiro WHERE id = ?',
          c.prestadorId,
          `criterios.${i}`,
          'O prestador',
        );
      if (c.tipo === 'profissional')
        await exigirExiste(
          tx,
          'SELECT id FROM profissional WHERE id = ?',
          c.profissionalId,
          `criterios.${i}`,
          'O profissional',
        );
    }
    const valores = {
      estabelecimento_id: e.todosEstabelecimentos ? null : est,
      descricao: e.descricao,
      fonte_pagadora_id: e.fontePagadoraId,
      plano_fonte_pagadora_id: e.planoId,
      item_faturavel_id: e.itemId,
      grupo_faturamento_id: e.grupoId,
      tabela_preco_id: e.tabelaId,
      tipo_restricao: e.tipo,
      acao: e.tipo === 'somente_aviso' ? 'alertar' : e.acao,
      tipo_atendimento: e.tipoAtendimento,
      valor_limite: e.tipo === 'limite_valor' ? e.valorLimite : null,
      quantidade_limite: e.tipo === 'limite_quantidade' ? e.quantidadeLimite : null,
      mensagem: e.mensagem,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim,
      ativo: e.ativo ? 1 : 0,
    };
    let rid: number;
    if (e.id === null) rid = await tx.incluir('restricao_cobertura_fonte_pagadora', valores);
    else {
      const atual = await tx.uma<Linha>(
        'SELECT id, estabelecimento_id FROM restricao_cobertura_fonte_pagadora WHERE id = ?',
        [e.id],
      );
      if (!atual || (atual['estabelecimento_id'] !== null && n(atual['estabelecimento_id']) !== est))
        throw recusa('nao-encontrado', 'A restrição não existe.', { campos: ['id'] });
      if (e.versao === null)
        throw recusa('entrada-invalida', 'Informe a versão lida.', { campos: ['versao'] });
      await tx.alterar('restricao_cobertura_fonte_pagadora', e.id, e.versao, valores);
      rid = e.id;
    }
    // Os critérios são trocados: o antigo fica com excluido_em (histórico); a sequência continua depois do último.
    const antigos = await tx.consultar<Linha>(
      'SELECT id, versao FROM restricao_cobertura_criterio WHERE restricao_cobertura_fonte_pagadora_id = ? AND excluido_em IS NULL',
      [rid],
    );
    for (const a of antigos)
      await tx.alterar('restricao_cobertura_criterio', n(a['id']), n(a['versao']), {
        excluido_em: new Date(),
        excluido_por: ctx.usuario,
      });
    const ult = await tx.uma<Linha>(
      'SELECT COALESCE(MAX(sequencia), 0) AS s FROM restricao_cobertura_criterio WHERE restricao_cobertura_fonte_pagadora_id = ?',
      [rid],
    );
    let seq = n(ult?.['s']);
    for (const c of e.criterios) {
      seq += 1;
      await tx.incluir('restricao_cobertura_criterio', {
        restricao_cobertura_fonte_pagadora_id: rid,
        sequencia: seq,
        tipo_criterio: c.tipo,
        setor_funcional_id: c.tipo === 'setor' ? c.setorId : null,
        idade_minima: c.tipo === 'faixa_idade' ? c.idadeMinima : null,
        idade_maxima: c.tipo === 'faixa_idade' ? c.idadeMaxima : null,
        hora_inicio: c.tipo === 'horario' ? c.horaInicio : null,
        hora_fim: c.tipo === 'horario' ? c.horaFim : null,
        dia_semana: c.tipo === 'horario' ? c.diaSemana : null,
        profissional_id: c.tipo === 'profissional' ? c.profissionalId : null,
        prestador_terceiro_id: c.tipo === 'prestador' ? c.prestadorId : null,
        plano_fonte_pagadora_id: c.tipo === 'plano' ? c.planoId : null,
        empresa_pessoa_juridica_id: c.tipo === 'empresa_carteira' ? c.empresaId : null,
        quantidade_maxima: c.tipo === 'quantidade_periodo' ? c.quantidadeMaxima : null,
        periodo: c.tipo === 'quantidade_periodo' ? c.periodo : null,
        tipo_atendimento: c.tipo === 'tipo_atendimento' ? c.tipoAtendimento : null,
      });
    }
    return { id: rid, criterios: e.criterios.length };
  },
});

const esquemaPar = z
  .object({
    id: idNulo,
    versao: z.number().int().positive().nullable().default(null),
    fontePagadoraId: idNulo,
    itemId: id,
    relacionadoId: id,
    tipo: z.enum(TIPOS_RELACAO_PROCEDIMENTO),
    exigeItem: z.boolean().default(false),
    verificaAutorizacao: z.boolean().default(false),
    quantidadeLimite: z.number().positive().max(99_999).nullable().default(null),
    validadeDias: z.number().int().min(0).max(3650).nullable().default(null),
    vigenciaInicio: data,
    vigenciaFim: data.nullable().default(null),
    ativo: z.boolean().default(true),
  })
  .strict();

export const opGravarPar = definirOperacao({
  nome: 'faturamento.gravar-compatibilidade-procedimento',
  tabelas: ['compatibilidade_procedimento'],
  entrada: esquemaPar,
  alvo: (_e, s) => ({ tabela: 'compatibilidade_procedimento', id: Number(s['id']) }),
  async gravar(tx, e) {
    exigirValido(validarParCompatibilidade(e));
    await exigirExiste(
      tx,
      'SELECT id FROM item_faturavel WHERE id = ?',
      e.itemId,
      'itemId',
      'O procedimento',
    );
    await exigirExiste(
      tx,
      'SELECT id FROM item_faturavel WHERE id = ?',
      e.relacionadoId,
      'relacionadoId',
      'O relacionado',
    );
    await exigirExiste(
      tx,
      'SELECT id FROM fonte_pagadora WHERE id = ?',
      e.fontePagadoraId,
      'fontePagadoraId',
      'A fonte pagadora',
    );
    const valores = {
      fonte_pagadora_id: e.fontePagadoraId,
      item_faturavel_id: e.itemId,
      relacionado_item_faturavel_id: e.relacionadoId,
      tipo_relacao: e.tipo,
      exige_item: e.tipo !== 'incompativel' && e.exigeItem ? 1 : 0,
      verifica_autorizacao: e.verificaAutorizacao ? 1 : 0,
      quantidade_limite: e.quantidadeLimite,
      validade_dias: e.validadeDias,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim,
      ativo: e.ativo ? 1 : 0,
    };
    const repetido = await tx.uma<Linha>(
      `SELECT id FROM compatibilidade_procedimento
        WHERE item_faturavel_id = ? AND relacionado_item_faturavel_id = ? AND tipo_relacao = ? AND vigencia_inicio = ?
          AND fonte_pagadora_id <=> ? AND id <> ?`,
      [e.itemId, e.relacionadoId, e.tipo, e.vigenciaInicio, e.fontePagadoraId, e.id ?? 0],
    );
    if (repetido)
      throw recusa('duplicado', 'Já existe este par com o mesmo tipo e início de vigência.', {
        campos: ['relacionadoId'],
      });
    if (e.id === null) return { id: await tx.incluir('compatibilidade_procedimento', valores) };
    if (e.versao === null) throw recusa('entrada-invalida', 'Informe a versão lida.', { campos: ['versao'] });
    await tx.alterar('compatibilidade_procedimento', e.id, e.versao, valores);
    return { id: e.id };
  },
});

const esquemaJustificativa = z
  .object({
    codigo: z.string().trim().min(1).max(30),
    descricao: z.string().trim().min(1).max(150),
    textoPadrao: z.string().trim().max(500).nullable().default(null),
  })
  .strict();

export const opGravarJustificativa = definirOperacao({
  nome: 'faturamento.gravar-justificativa-excecao-cobertura',
  tabelas: ['justificativa_excecao_cobertura'],
  entrada: esquemaJustificativa,
  alvo: (_e, s) => ({ tabela: 'justificativa_excecao_cobertura', id: Number(s['id']) }),
  async gravar(tx, e) {
    if (await tx.uma('SELECT id FROM justificativa_excecao_cobertura WHERE codigo = ?', [e.codigo]))
      throw recusa('duplicado', 'Já existe justificativa com esse código.', { campos: ['codigo'] });
    return {
      id: await tx.incluir('justificativa_excecao_cobertura', {
        codigo: e.codigo,
        descricao: e.descricao,
        texto_padrao: e.textoPadrao,
        ativo: 1,
      }),
    };
  },
});

const esquemaExcecao = z
  .object({
    atendimentoId: id,
    restricaoId: idNulo,
    itemId: idNulo,
    grupoId: idNulo,
    justificativaId: id,
    quantidadeAutorizada: z.number().positive().max(99_999).nullable().default(null),
    numeroGuia: z.string().trim().max(20).nullable().default(null),
    senha: z.string().trim().max(20).nullable().default(null),
    observacao: z.string().trim().max(1000).nullable().default(null),
    tiposAtendimento: z.array(z.enum(TIPOS_ATENDIMENTO_COBERTURA)).default([...TIPOS_ATENDIMENTO_COBERTURA]),
  })
  .strict();

export const opRegistrarExcecao = definirOperacao({
  nome: 'faturamento.registrar-excecao-cobertura',
  tabelas: ['restricao_cobertura_excecao'],
  entrada: esquemaExcecao,
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    if (ctx.usuario === null)
      throw recusa('sem-usuario', 'A liberação exige usuário identificado.', { campos: [] });
    exigirValido(validarExcecaoCobertura(e));
    const ctxA = await contextoDoAtendimento(tx, est, e.atendimentoId);
    await exigirExiste(
      tx,
      'SELECT id FROM justificativa_excecao_cobertura WHERE id = ? AND ativo = 1',
      e.justificativaId,
      'justificativaId',
      'A justificativa',
    );
    if (e.restricaoId !== null) {
      const r = await tx.uma<Linha>(
        'SELECT fonte_pagadora_id FROM restricao_cobertura_fonte_pagadora WHERE id = ?',
        [e.restricaoId],
      );
      if (!r || n(r['fonte_pagadora_id']) !== ctxA.fonte)
        throw recusa('referencia-inexistente', 'A restrição não é da fonte pagadora do atendimento.', {
          campos: ['restricaoId'],
        });
    }
    await exigirExiste(tx, 'SELECT id FROM item_faturavel WHERE id = ?', e.itemId, 'itemId', 'O item');
    await exigirExiste(tx, 'SELECT id FROM grupo_faturamento WHERE id = ?', e.grupoId, 'grupoId', 'O grupo');
    const marca = (t: TipoAtendimentoCobertura) => (e.tiposAtendimento.includes(t) ? 1 : 0);
    const novo = await tx.incluir('restricao_cobertura_excecao', {
      estabelecimento_id: est,
      restricao_cobertura_fonte_pagadora_id: e.restricaoId,
      atendimento_id: ctxA.atendimento,
      paciente_id: ctxA.paciente,
      fonte_pagadora_id: ctxA.fonte,
      plano_fonte_pagadora_id: ctxA.plano,
      item_faturavel_id: e.itemId,
      grupo_faturamento_id: e.itemId === null ? e.grupoId : null,
      quantidade_autorizada: e.quantidadeAutorizada,
      numero_guia: e.numeroGuia,
      senha: e.senha,
      justificativa_excecao_cobertura_id: e.justificativaId,
      observacao: e.observacao,
      autorizado_em: new Date(),
      autorizado_por_usuario_id: ctx.usuario,
      aplica_internacao: marca('internacao'),
      aplica_ambulatorial: marca('ambulatorial'),
      aplica_externo: marca('externo'),
      aplica_urgencia: marca('urgencia'),
      aplica_domiciliar: marca('domiciliar'),
    });
    return { id: novo };
  },
  alvo: (e) => ({ tabela: 'atendimento', id: e.atendimentoId }),
});

export const opRevogarExcecao = definirOperacao({
  nome: 'faturamento.revogar-excecao-cobertura',
  tabelas: ['restricao_cobertura_excecao'],
  entrada: z.object({ id, versao: z.number().int().positive() }).strict(),
  alvo: (e) => ({ tabela: 'restricao_cobertura_excecao', id: e.id }),
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    const x = await tx.uma<Linha>(
      'SELECT id, excluido_em FROM restricao_cobertura_excecao WHERE id = ? AND estabelecimento_id = ?',
      [e.id, est],
    );
    if (!x) throw recusa('nao-encontrado', 'A liberação não existe.', { campos: ['id'] });
    if (x['excluido_em'] !== null)
      throw recusa('ja-revogada', 'A liberação já foi revogada.', { campos: [] });
    await tx.alterar('restricao_cobertura_excecao', e.id, e.versao, {
      excluido_em: new Date(),
      excluido_por: ctx.usuario,
    });
    return { id: e.id, revogada: true };
  },
});

export const OPERACOES_COBERTURA = {
  'restricao.gravar': opGravarRestricao,
  'par.gravar': opGravarPar,
  'justificativa.gravar': opGravarJustificativa,
  'excecao.registrar': opRegistrarExcecao,
  'excecao.revogar': opRevogarExcecao,
} as const;
export type NomeOperacaoCobertura = keyof typeof OPERACOES_COBERTURA;

export async function gravarCobertura(
  executor: Executor,
  nome: NomeOperacaoCobertura,
  ctx: ContextoOperacao,
  entrada: unknown,
): Promise<Record<string, unknown>> {
  const op = OPERACOES_COBERTURA[nome] as Parameters<Executor['executar']>[0];
  const r = await executor.executar(op, ctx.cliente, entrada, ctx);
  return r.resultado as Record<string, unknown>;
}
