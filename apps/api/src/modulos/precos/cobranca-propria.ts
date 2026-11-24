// Cobrança por fonte pagadora sobre o banco do cliente (06-FAT linhas 6, 8 e 9). Leituras para a porta de preços e
// gravações pelo Executor (trilha, autoria e idempotência na mesma transação). As regras são do @sgh/dominio-preco
// (cobranca-fonte): aqui só se lê, valida pelo domínio e grava.
// - Linha 6: mat/med pela referência de mercado (item_referencia_matmed e preco_referencia_matmed por edição em
//   edicao_referencia_matmed, o espelho licenciado da ADR 0006): o item, o preço de fábrica e o máximo ao consumidor
//   na data, a tabela de mat/med escolhe qual cobra; equivalência do item com a operadora
//   (equivalencia_matmed_fonte_pagadora) e com a TUSS (equivalencia_matmed_tuss).
// - Linha 8: credenciamento de cobrança (credenciamento_cobranca, no estabelecimento) e exceção por procedimento,
//   equipe ou plano (excecao_credenciamento); a conferência da cobrança devolve se pode cobrar e por quê.
// - Linha 9: de-para do item do hospital para o código da fonte pagadora (equivalencia_item_fonte_pagadora).
// Nada se apaga: a equivalência ou o credenciamento substituídos têm a vigência encerrada na véspera do novo.
import {
  type ConferenciaCobranca,
  type CredenciamentoCobranca,
  conferirCobranca,
  diaAnterior,
  type EquivalenciaItemFonte,
  escolherEquivalencia,
  type ExcecaoCredenciamento,
  precoReferenciaNaData,
  quantidadeNaFonte,
  type TipoAtendimentoCobranca,
  validarCredenciamentoCobranca,
  validarEquivalencia,
  validarExcecaoCredenciamento,
  valorDaReferencia,
} from '@sgh/dominio-preco';
import {
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { FiltroConvenio, ItemMatmedPreco, Pagina, VigenciaValor } from './tipos.js';

type Linha = Record<string, unknown>;

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const tx_ = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const txn = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const dataIso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
const colunas = (cs: [string, string][]) => cs.map(([campo, rotulo]) => ({ campo, rotulo }));
const lista = (conv: FiltroConvenio): number[] | null =>
  conv == null ? null : typeof conv === 'number' ? [conv] : [...conv];
const emLista = (campo: string, l: readonly number[]) => ` AND ${campo} IN (${l.map(() => '?').join(', ')})`;
const versaoEdicao = (v: unknown) => Number(String(v ?? '').replace(/\D/g, '') || 0) || null;

// ── Linha 6: referência de mercado de mat/med ───────────────────────────────────────────────────────

interface TabelaMatmed {
  readonly referencia: string;
  readonly base: 'pf' | 'pmc' | null;
}

async function tabelaMatmed(l: Leitor, est: number, tab: number): Promise<TabelaMatmed | null> {
  const t = await l.uma<Linha>(
    `SELECT referencia, preco_referencia FROM tabela_preco
      WHERE id = ? AND (estabelecimento_id IS NULL OR estabelecimento_id = ?) AND excluido_em IS NULL`,
    [tab, est],
  );
  if (!t) return null;
  const referencia = tx_(t['referencia']);
  if (referencia !== 'brasindice' && referencia !== 'simpro') return null;
  const b = txn(t['preco_referencia']);
  return { referencia, base: b === 'pf' || b === 'pmc' ? b : null };
}

const SQL_ITEM_REF = `
  SELECT i.id, i.codigo_referencia, i.descricao, i.apresentacao, i.situacao, i.codigo_tuss,
         p.vigencia_inicio, p.operacao, p.preco_fabrica, p.preco_maximo_consumidor, p.edicao_referencia_matmed_id,
         e.numero_edicao
    FROM item_referencia_matmed i
    LEFT JOIN preco_referencia_matmed p ON p.id = (
      SELECT p2.id FROM preco_referencia_matmed p2
       WHERE p2.item_referencia_matmed_id = i.id AND p2.vigencia_inicio <= ?
       ORDER BY p2.vigencia_inicio DESC, p2.edicao_referencia_matmed_id DESC LIMIT 1)
    LEFT JOIN edicao_referencia_matmed e ON e.id = p.edicao_referencia_matmed_id
   WHERE i.fonte_referencia = ? AND i.excluido_em IS NULL`;

function itemRefDe(r: Linha, base: 'pf' | 'pmc' | null): ItemMatmedPreco {
  const p = precoReferenciaNaData(
    r['vigencia_inicio'] == null
      ? []
      : [
          {
            edicaoId: n(r['edicao_referencia_matmed_id']),
            vigenciaInicio: dataIso(r['vigencia_inicio']) ?? '',
            operacao: tx_(r['operacao']),
            pf: nn(r['preco_fabrica']),
            pmc: nn(r['preco_maximo_consumidor']),
          },
        ],
    '9999-12-31',
  );
  return {
    id: n(r['id']),
    codigo: n(r['id']),
    nome: [tx_(r['descricao']), txn(r['apresentacao'])].filter(Boolean).join(' · '),
    classificacao: null,
    unidade: null,
    referencia: txn(r['codigo_referencia']),
    situacao: txn(r['situacao']),
    vigencia: p ? p.vigenciaInicio : null,
    valor: valorDaReferencia(p, base),
    pmc: p?.pmc ?? null,
    pf: p?.pf ?? null,
    edicao: p ? versaoEdicao(r['numero_edicao']) : null,
  };
}

export async function itensMatmedPropria(
  l: Leitor,
  est: number,
  tab: number,
  f: { busca?: string; pagina: number; porPagina: number; data: string },
): Promise<{ itens: ItemMatmedPreco[]; total: number }> {
  const t = await tabelaMatmed(l, est, tab);
  if (!t) return { itens: [], total: 0 };
  const busca = (f.busca ?? '').trim();
  const filtro = busca ? ' AND (i.descricao LIKE ? OR i.codigo_referencia = ? OR i.codigo_tuss = ?)' : '';
  const pb = busca ? [`%${busca}%`, busca, busca] : [];
  const total = await l.uma<Linha>(
    `SELECT COUNT(*) AS total FROM item_referencia_matmed i WHERE i.fonte_referencia = ? AND i.excluido_em IS NULL${filtro}`,
    [t.referencia, ...pb],
  );
  const ls = await l.consultar(`${SQL_ITEM_REF}${filtro} ORDER BY i.descricao, i.id LIMIT ? OFFSET ?`, [
    f.data,
    t.referencia,
    ...pb,
    f.porPagina,
    f.pagina * f.porPagina,
  ]);
  return { itens: ls.map((r) => itemRefDe(r, t.base)), total: n(total?.['total']) };
}

export async function itemMatmedPropria(
  l: Leitor,
  est: number,
  tab: number,
  cod: number,
  data: string,
): Promise<ItemMatmedPreco | null> {
  const t = await tabelaMatmed(l, est, tab);
  if (!t) return null;
  const r = await l.uma<Linha>(`${SQL_ITEM_REF} AND i.id = ?`, [data, t.referencia, cod]);
  return r ? itemRefDe(r, t.base) : null;
}

export async function vigenciasMatmedPropria(
  l: Leitor,
  est: number,
  tab: number,
  cod: number,
): Promise<VigenciaValor[]> {
  const t = await tabelaMatmed(l, est, tab);
  if (!t) return [];
  const ls = await l.consultar(
    `SELECT p.vigencia_inicio, p.operacao, p.preco_fabrica, p.preco_maximo_consumidor, p.edicao_referencia_matmed_id,
            e.numero_edicao
       FROM preco_referencia_matmed p JOIN item_referencia_matmed i ON i.id = p.item_referencia_matmed_id
       JOIN edicao_referencia_matmed e ON e.id = p.edicao_referencia_matmed_id
      WHERE i.id = ? AND i.fonte_referencia = ?
      ORDER BY p.vigencia_inicio DESC, p.edicao_referencia_matmed_id DESC`,
    [cod, t.referencia],
    { teto: 1_000 },
  );
  return ls.map((r) => {
    const exclusao = tx_(r['operacao']) === 'exclusao';
    const pf = exclusao ? null : nn(r['preco_fabrica']);
    const pmc = exclusao ? null : nn(r['preco_maximo_consumidor']);
    return {
      data: dataIso(r['vigencia_inicio']) ?? '',
      valor: exclusao ? null : t.base === 'pf' ? pf : (pmc ?? pf),
      pf,
      pmc,
      edicao: versaoEdicao(r['numero_edicao']),
    };
  });
}

/** Equivalências do item de referência: código em cada operadora e termo TUSS, com vigência (o histórico inteiro). */
export async function equivalenciasMatmedPropria(l: Leitor, item: number): Promise<Pagina> {
  const ops = await l.consultar(
    `SELECT 'operadora' AS tipo, f.nome AS destino, q.codigo_na_fonte AS codigo, q.descricao_na_fonte AS descricao,
            q.fator_conversao AS fator, q.vigencia_inicio, q.vigencia_fim
       FROM equivalencia_matmed_fonte_pagadora q JOIN fonte_pagadora f ON f.id = q.fonte_pagadora_id
      WHERE q.item_referencia_matmed_id = ? AND q.excluido_em IS NULL
     UNION ALL
     SELECT 'tuss', 'TUSS', t.codigo_termo, t.descricao, NULL, q.vigencia_inicio, q.vigencia_fim
       FROM equivalencia_matmed_tuss q JOIN termo_terminologia t ON t.id = q.termo_terminologia_id
      WHERE q.item_referencia_matmed_id = ? AND q.excluido_em IS NULL
      ORDER BY 1, 6 DESC`,
    [item, item],
    { teto: 500 },
  );
  return {
    colunas: colunas([
      ['tipo', 'Equivalência'],
      ['destino', 'Operadora ou terminologia'],
      ['codigo', 'Código'],
      ['descricao', 'Descrição'],
      ['fator', 'Fator de conversão'],
      ['inicio', 'Vigência: início'],
      ['fim', 'Vigência: fim'],
    ]),
    itens: ops.map((r) => ({
      tipo: tx_(r['tipo']),
      destino: tx_(r['destino']),
      codigo: tx_(r['codigo']),
      descricao: txn(r['descricao']),
      fator: nn(r['fator']),
      inicio: dataIso(r['vigencia_inicio']),
      fim: dataIso(r['vigencia_fim']),
    })),
    total: ops.length,
  };
}

// ── Linha 9: de-para do item do hospital ──────────────────────────────────────────────────────────

const COLUNAS_DE_PARA = colunas([
  ['id', 'Id'],
  ['convenio', 'Convênio'],
  ['convenioNome', 'Nome do convênio'],
  ['item', 'Item do hospital'],
  ['itemNome', 'Descrição do item'],
  ['grupo', 'Grupo de faturamento'],
  ['plano', 'Plano'],
  ['tipoConta', 'Tipo de conta'],
  ['atendimento', 'Atendimento'],
  ['codigo', 'Código na fonte pagadora'],
  ['descricao', 'Descrição na fonte pagadora'],
  ['fatorMultiplicacao', 'Multiplica'],
  ['fatorDivisao', 'Divide'],
  ['inicio', 'Vigência: início'],
  ['fim', 'Vigência: fim'],
  ['versao', 'Versão'],
]);

export async function deParaPropria(
  l: Leitor,
  conv: FiltroConvenio,
  exame: string | null,
  pagina: number,
  porPagina: number,
): Promise<Pagina> {
  const ls = lista(conv);
  if (ls && ls.length === 0) return { colunas: COLUNAS_DE_PARA, itens: [], total: 0 };
  let filtro = ls ? emLista('q.fonte_pagadora_id', ls) : '';
  const p: unknown[] = [...(ls ?? [])];
  if (exame) {
    filtro += ' AND (i.codigo LIKE ? OR q.codigo_cobranca LIKE ?)';
    p.push(`${exame}%`, `${exame}%`);
  }
  const base = `FROM equivalencia_item_fonte_pagadora q JOIN fonte_pagadora f ON f.id = q.fonte_pagadora_id
      LEFT JOIN item_faturavel i ON i.id = q.item_faturavel_id
      LEFT JOIN grupo_faturamento g ON g.id = q.grupo_faturamento_id
      LEFT JOIN plano_fonte_pagadora pl ON pl.id = q.plano_fonte_pagadora_id
      LEFT JOIN tipo_conta tc ON tc.id = q.tipo_conta_id
     WHERE q.excluido_em IS NULL${filtro}`;
  const total = await l.uma<Linha>(`SELECT COUNT(*) AS total ${base}`, p);
  const rs = await l.consultar(
    `SELECT q.*, f.nome AS convenio_nome, i.codigo AS item_codigo, i.descricao AS item_nome, g.descricao AS grupo_nome,
            pl.descricao AS plano_nome, tc.descricao AS tipo_conta_nome ${base}
      ORDER BY f.nome, i.codigo, q.vigencia_inicio DESC, q.id LIMIT ? OFFSET ?`,
    [...p, porPagina, pagina * porPagina],
  );
  return {
    colunas: COLUNAS_DE_PARA,
    itens: rs.map((r) => ({
      id: n(r['id']),
      convenio: n(r['fonte_pagadora_id']),
      convenioNome: tx_(r['convenio_nome']),
      item: txn(r['item_codigo']),
      itemNome: txn(r['item_nome']),
      grupo: txn(r['grupo_nome']),
      plano: txn(r['plano_nome']),
      tipoConta: txn(r['tipo_conta_nome']),
      atendimento: tx_(r['tipo_atendimento']),
      codigo: tx_(r['codigo_cobranca']),
      descricao: txn(r['descricao_cobranca']),
      fatorMultiplicacao: nn(r['fator_multiplicacao']),
      fatorDivisao: nn(r['fator_divisao']),
      inicio: dataIso(r['vigencia_inicio']),
      fim: dataIso(r['vigencia_fim']),
      versao: n(r['versao']),
    })),
    total: n(total?.['total']),
  };
}

// ── Linha 8: credenciamento de cobrança e exceção ─────────────────────────────────────────────────

const COLUNAS_CREDENCIAMENTO = colunas([
  ['id', 'Id'],
  ['convenio', 'Convênio'],
  ['convenioNome', 'Nome do convênio'],
  ['quem', 'Profissional ou prestador'],
  ['plano', 'Plano'],
  ['tipoConta', 'Tipo de conta'],
  ['grupoAto', 'Ato'],
  ['codigo', 'Código na fonte pagadora'],
  ['recebeDireto', 'Recebe direto da fonte'],
  ['inicio', 'Vigência: início'],
  ['fim', 'Vigência: fim'],
  ['versao', 'Versão'],
]);

const QUEM = `COALESCE(pr.nome_exibicao, pt.nome)`;

export async function credenciamentoPropria(
  l: Leitor,
  est: number,
  conv: FiltroConvenio,
  pagina: number,
  porPagina: number,
  profissional?: string | null,
): Promise<Pagina> {
  const ls = lista(conv);
  if (ls && ls.length === 0) return { colunas: COLUNAS_CREDENCIAMENTO, itens: [], total: 0 };
  let filtro = ls ? emLista('c.fonte_pagadora_id', ls) : '';
  const p: unknown[] = [est, ...(ls ?? [])];
  const prof = (profissional ?? '').trim();
  if (prof) {
    filtro += ` AND ${QUEM} LIKE ?`;
    p.push(`%${prof}%`);
  }
  const base = `FROM credenciamento_cobranca c JOIN fonte_pagadora f ON f.id = c.fonte_pagadora_id
      LEFT JOIN profissional pr ON pr.id = c.profissional_id
      LEFT JOIN prestador_terceiro pt ON pt.id = c.prestador_terceiro_id
      LEFT JOIN plano_fonte_pagadora pl ON pl.id = c.plano_fonte_pagadora_id
      LEFT JOIN tipo_conta tc ON tc.id = c.tipo_conta_id
      LEFT JOIN grupo_ato ga ON ga.id = c.grupo_ato_id
     WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL${filtro}`;
  const total = await l.uma<Linha>(`SELECT COUNT(*) AS total ${base}`, p);
  const rs = await l.consultar(
    `SELECT c.*, f.nome AS convenio_nome, ${QUEM} AS quem, pl.descricao AS plano_nome, tc.descricao AS tipo_conta_nome,
            ga.descricao AS grupo_ato_nome ${base}
      ORDER BY f.nome, quem, c.vigencia_inicio DESC, c.id LIMIT ? OFFSET ?`,
    [...p, porPagina, pagina * porPagina],
  );
  return {
    colunas: COLUNAS_CREDENCIAMENTO,
    itens: rs.map((r) => ({
      id: n(r['id']),
      convenio: n(r['fonte_pagadora_id']),
      convenioNome: tx_(r['convenio_nome']),
      quem: txn(r['quem']),
      plano: txn(r['plano_nome']) ?? 'Todos',
      tipoConta: txn(r['tipo_conta_nome']) ?? 'Todos',
      grupoAto: txn(r['grupo_ato_nome']) ?? 'Todos',
      codigo: txn(r['codigo_na_fonte']),
      recebeDireto: r['recebe_direto_da_fonte'] ? 'Sim' : 'Não',
      inicio: dataIso(r['vigencia_inicio']),
      fim: dataIso(r['vigencia_fim']),
      versao: n(r['versao']),
    })),
    total: n(total?.['total']),
  };
}

/** As exceções ao credenciamento do estabelecimento (as da fonte pedida e as que valem para todas as fontes). */
export async function excecoesCredenciamentoPropria(
  l: Leitor,
  est: number,
  conv: FiltroConvenio,
): Promise<Pagina> {
  const ls = lista(conv);
  const filtro = ls
    ? ls.length
      ? ` AND (x.fonte_pagadora_id IS NULL${ls.length ? ` OR x.fonte_pagadora_id IN (${ls.map(() => '?').join(', ')})` : ''})`
      : ' AND x.fonte_pagadora_id IS NULL'
    : '';
  const rs = await l.consultar(
    `SELECT x.*, f.nome AS convenio_nome, COALESCE(pr.nome_exibicao, pt.nome, eq.nome) AS quem,
            i.codigo AS item_codigo, i.descricao AS item_nome, g.descricao AS grupo_nome, pl.descricao AS plano_nome
       FROM excecao_credenciamento x
       LEFT JOIN fonte_pagadora f ON f.id = x.fonte_pagadora_id
       LEFT JOIN credenciamento_cobranca c ON c.id = x.credenciamento_cobranca_id
       LEFT JOIN profissional pr ON pr.id = COALESCE(x.profissional_id, c.profissional_id)
       LEFT JOIN prestador_terceiro pt ON pt.id = COALESCE(x.prestador_terceiro_id, c.prestador_terceiro_id)
       LEFT JOIN equipe_profissional eq ON eq.id = x.equipe_profissional_id
       LEFT JOIN item_faturavel i ON i.id = x.item_faturavel_id
       LEFT JOIN grupo_faturamento g ON g.id = x.grupo_faturamento_id
       LEFT JOIN plano_fonte_pagadora pl ON pl.id = x.plano_fonte_pagadora_id
      WHERE x.estabelecimento_id = ?${filtro}
      ORDER BY x.vigencia_inicio DESC, x.id DESC`,
    [est, ...(ls ?? [])],
    { teto: 2_000 },
  );
  return {
    colunas: colunas([
      ['id', 'Id'],
      ['convenioNome', 'Convênio'],
      ['quem', 'Profissional, prestador ou equipe'],
      ['procedimento', 'Procedimento ou grupo'],
      ['plano', 'Plano'],
      ['atendimento', 'Atendimento'],
      ['efeito', 'Efeito'],
      ['motivo', 'Motivo'],
      ['inicio', 'Vigência: início'],
      ['fim', 'Vigência: fim'],
      ['versao', 'Versão'],
    ]),
    itens: rs.map((r) => ({
      id: n(r['id']),
      convenioNome: txn(r['convenio_nome']) ?? 'Todos',
      quem: txn(r['quem']),
      procedimento:
        txn(r['item_codigo']) !== null
          ? `${tx_(r['item_codigo'])} · ${tx_(r['item_nome'])}`
          : (txn(r['grupo_nome']) ?? 'Todos'),
      plano: txn(r['plano_nome']) ?? 'Todos',
      atendimento: tx_(r['tipo_atendimento']),
      efeito: tx_(r['efeito']) === 'proibe' ? 'Proíbe' : 'Permite',
      motivo: txn(r['motivo']),
      inicio: dataIso(r['vigencia_inicio']),
      fim: dataIso(r['vigencia_fim']),
      versao: n(r['versao']),
    })),
    total: rs.length,
  };
}

// ── Conferência da cobrança (guia e lançamento) ──────────────────────────────────────────────────

export const esquemaConferenciaCobranca = z.object({
  fontePagadoraId: z.number().int().positive(),
  planoId: z.number().int().positive().nullable(),
  itemId: z.number().int().positive(),
  profissionalId: z.number().int().positive().nullable(),
  prestadorId: z.number().int().positive().nullable(),
  equipeIds: z.array(z.number().int().positive()).max(20).default([]),
  tipoContaId: z.number().int().positive().nullable(),
  tipoAtendimento: z.enum(['ambulatorial', 'internacao', 'urgencia', 'externo']).nullable(),
  quantidade: z.number().positive().default(1),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type PedidoConferenciaCobranca = z.infer<typeof esquemaConferenciaCobranca>;

export interface ResultadoConferenciaCobranca {
  readonly codigo: string;
  readonly descricao: string | null;
  readonly quantidade: number;
  readonly equivalenciaId: number | null;
  /** Unidade da fonte pagadora e percentual de cobrança do de-para (nulos: sem de-para ou sem ajuste). */
  readonly unidade: string | null;
  readonly percentualCobranca: number | null;
  readonly credenciamento: ConferenciaCobranca;
  /** Código do prestador (ou do profissional) na fonte pagadora, do credenciamento escolhido: vai na guia. */
  readonly codigoPrestadorNaFonte: string | null;
  readonly avisos: readonly string[];
}

export function equivalenciaDe(r: Linha): EquivalenciaItemFonte {
  return {
    id: n(r['id']),
    itemId: nn(r['item_faturavel_id']),
    grupoId: nn(r['grupo_faturamento_id']),
    planoId: nn(r['plano_fonte_pagadora_id']),
    tipoContaId: nn(r['tipo_conta_id']),
    tipoAtendimento: tx_(r['tipo_atendimento']),
    codigo: tx_(r['codigo_cobranca']),
    descricao: txn(r['descricao_cobranca']),
    fatorMultiplicacao: n(r['fator_multiplicacao']),
    fatorDivisao: n(r['fator_divisao']),
    percentual: nn(r['percentual_cobranca']),
    vigenciaInicio: dataIso(r['vigencia_inicio']) ?? '',
    vigenciaFim: dataIso(r['vigencia_fim']),
  };
}

/**
 * O que vai para a guia da fonte pagadora: o código e a quantidade pelo de-para e se quem executou pode cobrar o item
 * (credenciamento e exceção). Sem de-para, vai o código do hospital com aviso.
 */
export async function conferirCobrancaPropria(
  l: Leitor,
  est: number,
  p: PedidoConferenciaCobranca,
): Promise<ResultadoConferenciaCobranca> {
  const item = await l.uma<Linha>(
    'SELECT codigo, descricao, grupo_faturamento_id, grupo_ato_id FROM item_faturavel WHERE id = ?',
    [p.itemId],
  );
  if (!item) throw recusa('item-inexistente', 'O item não existe.', { campos: ['itemId'] });
  const fonte = await l.uma<Linha>('SELECT tipo FROM fonte_pagadora WHERE id = ?', [p.fontePagadoraId]);
  if (!fonte)
    throw recusa('fonte-inexistente', 'A fonte pagadora não existe.', { campos: ['fontePagadoraId'] });
  const plano =
    p.planoId === null
      ? null
      : await l.uma<Linha>('SELECT plano_superior_id FROM plano_fonte_pagadora WHERE id = ?', [p.planoId]);
  const grupoId = nn(item['grupo_faturamento_id']);
  const eqLinhas = await l.consultar(
    `SELECT * FROM equivalencia_item_fonte_pagadora
        WHERE fonte_pagadora_id = ? AND excluido_em IS NULL AND vigencia_inicio <= ?
          AND (vigencia_fim IS NULL OR vigencia_fim >= ?) AND (item_faturavel_id = ? OR grupo_faturamento_id = ?)`,
    [p.fontePagadoraId, p.data, p.data, p.itemId, grupoId ?? 0],
    { teto: 200 },
  );
  const eq = escolherEquivalencia(eqLinhas.map(equivalenciaDe), {
    itemId: p.itemId,
    grupoId,
    planoId: p.planoId,
    planoSuperiorId: nn(plano?.['plano_superior_id']),
    tipoContaId: p.tipoContaId,
    tipoAtendimento: p.tipoAtendimento as TipoAtendimentoCobranca | null,
    data: p.data,
  });
  // Só o recorte da data e de quem cobra: o histórico cresce (nada se apaga) e não pode pesar na conferência.
  const credLinhas = await l.consultar(
    `SELECT * FROM credenciamento_cobranca
      WHERE estabelecimento_id = ? AND fonte_pagadora_id = ? AND excluido_em IS NULL
        AND (profissional_id = ? OR prestador_terceiro_id = ?)
        AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)`,
    [est, p.fontePagadoraId, p.profissionalId ?? 0, p.prestadorId ?? 0, p.data, p.data],
    { teto: 500 },
  );
  const creds: CredenciamentoCobranca[] = credLinhas.map((r) => ({
    id: n(r['id']),
    profissionalId: nn(r['profissional_id']),
    prestadorId: nn(r['prestador_terceiro_id']),
    planoId: nn(r['plano_fonte_pagadora_id']),
    tipoContaId: nn(r['tipo_conta_id']),
    grupoAtoId: nn(r['grupo_ato_id']),
    vigenciaInicio: dataIso(r['vigencia_inicio']) ?? '',
    vigenciaFim: dataIso(r['vigencia_fim']),
  }));
  const equipes = p.equipeIds.length ? p.equipeIds : [0];
  const credIds = creds.length ? creds.map((c) => c.id) : [0];
  const excs: ExcecaoCredenciamento[] = (
    await l.consultar(
      `SELECT * FROM excecao_credenciamento
        WHERE estabelecimento_id = ? AND (fonte_pagadora_id IS NULL OR fonte_pagadora_id = ?)
          AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
          AND (profissional_id = ? OR prestador_terceiro_id = ?
               OR credenciamento_cobranca_id IN (${credIds.map(() => '?').join(', ')})
               OR equipe_profissional_id IN (${equipes.map(() => '?').join(', ')}))`,
      [
        est,
        p.fontePagadoraId,
        p.data,
        p.data,
        p.profissionalId ?? 0,
        p.prestadorId ?? 0,
        ...credIds,
        ...equipes,
      ],
      { teto: 1_000 },
    )
  ).map((r) => ({
    id: n(r['id']),
    credenciamentoId: nn(r['credenciamento_cobranca_id']),
    profissionalId: nn(r['profissional_id']),
    prestadorId: nn(r['prestador_terceiro_id']),
    equipeId: nn(r['equipe_profissional_id']),
    fonteId: nn(r['fonte_pagadora_id']),
    planoId: nn(r['plano_fonte_pagadora_id']),
    tipoAtendimento: tx_(r['tipo_atendimento']),
    grupoId: nn(r['grupo_faturamento_id']),
    itemId: nn(r['item_faturavel_id']),
    efeito: tx_(r['efeito']) === 'proibe' ? 'proibe' : 'permite',
    motivo: txn(r['motivo']),
    vigenciaInicio: dataIso(r['vigencia_inicio']) ?? '',
    vigenciaFim: dataIso(r['vigencia_fim']),
  }));
  const cred = conferirCobranca(creds, excs, {
    fonteId: p.fontePagadoraId,
    particular: tx_(fonte['tipo']) === 'particular',
    profissionalId: p.profissionalId,
    prestadorId: p.prestadorId,
    equipeIds: p.equipeIds,
    planoId: p.planoId,
    planoSuperiorId: nn(plano?.['plano_superior_id']),
    tipoContaId: p.tipoContaId,
    tipoAtendimento: p.tipoAtendimento as TipoAtendimentoCobranca | null,
    itemId: p.itemId,
    grupoId,
    grupoAtoId: nn(item['grupo_ato_id']),
    data: p.data,
  });
  const eqLinha = eq ? eqLinhas.find((r) => n(r['id']) === eq.id) : undefined;
  const credLinha =
    cred.credenciamentoId === null ? undefined : credLinhas.find((r) => n(r['id']) === cred.credenciamentoId);
  const avisos: string[] = [];
  if (!eq) avisos.push('Sem de-para vigente nesta fonte pagadora: vai o código do hospital.');
  if (!cred.permitido && cred.motivo) avisos.push(cred.motivo);
  return {
    codigo: eq ? eq.codigo : tx_(item['codigo']),
    descricao: eq ? (eq.descricao ?? tx_(item['descricao'])) : tx_(item['descricao']),
    quantidade: eq ? quantidadeNaFonte(p.quantidade, eq) : p.quantidade,
    equivalenciaId: eq?.id ?? null,
    unidade: txn(eqLinha?.['unidade_cobranca']),
    percentualCobranca: eq?.percentual ?? null,
    credenciamento: cred,
    codigoPrestadorNaFonte: txn(credLinha?.['codigo_na_fonte']),
    avisos,
  };
}

// ── Gravações ──────────────────────────────────────────────────────────────────────────────────────

const id = z.number().int().positive();
const idN = id.nullable().default(null);
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function exigirValido(erros: Record<string, string>) {
  const campos = Object.keys(erros);
  if (campos.length) throw recusa('entrada-invalida', Object.values(erros).join(' '), { campos });
}

function estDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.', { campos: [] });
  return ctx.estabelecimento;
}

async function existe(tx: TxOperacao, tabela: string, valor: number | null, campo: string) {
  if (valor === null) return;
  const r = await tx.uma(`SELECT id FROM ${tabela} WHERE id = ?`, [valor]);
  if (!r)
    throw recusa('referencia-inexistente', `O registro informado em ${campo} não existe.`, {
      campos: [campo],
    });
}

/**
 * Encerra pela véspera do novo início quem tem a mesma chave e ainda vale no novo início (nada se apaga). Mesmo
 * início: recusa (a chave única do banco é a vigência).
 */
async function encerrarAnteriores(
  tx: TxOperacao,
  tabela: string,
  where: string,
  p: readonly unknown[],
  inicio: string,
): Promise<number> {
  const ls = await tx.consultarParaAtualizar(
    `SELECT id, versao, vigencia_inicio FROM ${tabela}
      WHERE ${where} AND excluido_em IS NULL AND (vigencia_fim IS NULL OR vigencia_fim >= ?)`,
    [...p, inicio],
  );
  let n_ = 0;
  for (const r of ls) {
    const ini = dataIso(r['vigencia_inicio']) ?? '';
    if (ini >= inicio)
      throw recusa(
        'vigencia-conflitante',
        'Já existe registro com a mesma chave começando nessa data ou depois: encerre-o ou escolha outra data.',
        { campos: ['vigenciaInicio'] },
      );
    await tx.alterar(tabela, n(r['id']), n(r['versao']), { vigencia_fim: diaAnterior(inicio) });
    n_++;
  }
  return n_;
}

const nulo = (c: string) => `(${c} <=> ?)`;

export const esquemaEquivalenciaItem = z.object({
  fontePagadoraId: id,
  planoId: idN,
  itemId: idN,
  grupoId: idN,
  tipoContaId: idN,
  tipoAtendimento: z.enum(['ambulatorial', 'internacao', 'urgencia', 'externo', 'todos']).default('todos'),
  codigo: z.string().max(40),
  descricao: z.string().max(300).nullable().default(null),
  unidade: z.string().max(15).nullable().default(null),
  fatorMultiplicacao: z.number().default(1),
  fatorDivisao: z.number().default(1),
  percentual: z.number().nullable().default(null),
  vigenciaInicio: data,
  vigenciaFim: data.nullable().default(null),
});

export const opGravarEquivalenciaItem = definirOperacao({
  nome: 'preco.gravar-equivalencia-item',
  tabelas: ['equivalencia_item_fonte_pagadora'],
  entrada: esquemaEquivalenciaItem,
  async gravar(tx, e) {
    exigirValido(validarEquivalencia(e));
    await existe(tx, 'fonte_pagadora', e.fontePagadoraId, 'fontePagadoraId');
    await existe(tx, 'item_faturavel', e.itemId, 'itemId');
    await existe(tx, 'grupo_faturamento', e.grupoId, 'grupoId');
    await existe(tx, 'plano_fonte_pagadora', e.planoId, 'planoId');
    await existe(tx, 'tipo_conta', e.tipoContaId, 'tipoContaId');
    const encerradas = await encerrarAnteriores(
      tx,
      'equivalencia_item_fonte_pagadora',
      `fonte_pagadora_id = ? AND ${nulo('item_faturavel_id')} AND ${nulo('grupo_faturamento_id')}
        AND ${nulo('plano_fonte_pagadora_id')} AND ${nulo('tipo_conta_id')} AND tipo_atendimento = ?`,
      [e.fontePagadoraId, e.itemId, e.grupoId, e.planoId, e.tipoContaId, e.tipoAtendimento],
      e.vigenciaInicio,
    );
    const novo = await tx.incluir('equivalencia_item_fonte_pagadora', {
      fonte_pagadora_id: e.fontePagadoraId,
      plano_fonte_pagadora_id: e.planoId,
      item_faturavel_id: e.itemId,
      grupo_faturamento_id: e.grupoId,
      tipo_conta_id: e.tipoContaId,
      tipo_atendimento: e.tipoAtendimento,
      codigo_cobranca: e.codigo.trim(),
      descricao_cobranca: e.descricao,
      unidade_cobranca: e.unidade,
      fator_multiplicacao: e.fatorMultiplicacao,
      fator_divisao: e.fatorDivisao,
      percentual_cobranca: e.percentual,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim,
    });
    return { id: novo, encerradas };
  },
  alvo: (_e, s) => ({ tabela: 'equivalencia_item_fonte_pagadora', id: s.id }),
});

const esquemaEncerrar = z.object({
  id,
  versao: z.number().int().positive(),
  vigenciaFim: data,
  motivo: z.string().max(500).nullable().default(null),
});

/**
 * Encerra a vigência sem reescrever o passado: o fim não recua para antes de hoje (contas já lançadas usaram o
 * registro), registro encerrado no passado não muda, e o fim não avança por cima do sucessor da mesma chave.
 */
function opEncerrar(nome: string, tabela: string, porEstabelecimento: boolean, chave: readonly string[]) {
  return definirOperacao({
    nome,
    tabelas: [tabela],
    entrada: esquemaEncerrar,
    async gravar(tx, e, ctx) {
      const r = await tx.uma<Linha>(
        // Coluna repetida no SELECT faz o conector do MariaDB recusar o resultado (nome duplicado): a chave pode já
        // trazer o estabelecimento.
        `SELECT vigencia_inicio, vigencia_fim${[...new Set([...(porEstabelecimento ? ['estabelecimento_id'] : []), ...chave])].map((c) => `, ${c}`).join('')}
           FROM ${tabela} WHERE id = ?`,
        [e.id],
      );
      if (!r || (porEstabelecimento && n(r['estabelecimento_id']) !== estDe(ctx)))
        throw recusa('nao-encontrado', 'O registro não existe neste estabelecimento.', { campos: ['id'] });
      const inicio = dataIso(r['vigencia_inicio']) ?? '';
      const fimAtual = dataIso(r['vigencia_fim']);
      if (e.vigenciaFim < inicio)
        throw recusa('vigencia-invalida', 'O fim da vigência não pode ser antes do início.', {
          campos: ['vigenciaFim'],
        });
      const hoje =
        txn((await tx.uma<Linha>("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoje", []))?.['hoje']) ??
        new Date().toISOString().slice(0, 10);
      if (fimAtual !== null && fimAtual < hoje)
        throw recusa(
          'vigencia-encerrada',
          'O registro já foi encerrado no passado: o histórico não se reescreve. Grave um novo registro a partir de hoje.',
          { campos: ['id'] },
        );
      if (e.vigenciaFim < hoje)
        throw recusa(
          'vigencia-retroativa',
          'O fim da vigência não pode ser antes de hoje: contas já lançadas usaram este registro. Para corrigir, grave um novo registro a partir de hoje.',
          { campos: ['vigenciaFim'] },
        );
      if (chave.length) {
        const sucessor = await tx.uma<Linha>(
          `SELECT id FROM ${tabela}
            WHERE id <> ? AND ${chave.map(nulo).join(' AND ')}
              AND vigencia_inicio > ? AND vigencia_inicio <= ?${tabela === 'excecao_credenciamento' ? '' : ' AND excluido_em IS NULL'}
            LIMIT 1`,
          [e.id, ...chave.map((c) => r[c] ?? null), inicio, e.vigenciaFim],
        );
        if (sucessor)
          throw recusa(
            'vigencia-conflitante',
            'Já existe registro com a mesma chave começando antes desse fim: as vigências ficariam sobrepostas.',
            { campos: ['vigenciaFim'] },
          );
      }
      const versao = await tx.alterar(tabela, e.id, e.versao, { vigencia_fim: e.vigenciaFim });
      return { id: e.id, versao };
    },
    alvo: (e) => ({ tabela, id: e.id }),
    trilha: (e) => (e.motivo?.trim() ? { motivo: e.motivo.trim() } : {}),
  });
}

export const opEncerrarEquivalenciaItem = opEncerrar(
  'preco.encerrar-equivalencia-item',
  'equivalencia_item_fonte_pagadora',
  false,
  [
    'fonte_pagadora_id',
    'item_faturavel_id',
    'grupo_faturamento_id',
    'plano_fonte_pagadora_id',
    'tipo_conta_id',
    'tipo_atendimento',
  ],
);
export const opEncerrarCredenciamentoCobranca = opEncerrar(
  'convenio.encerrar-credenciamento-cobranca',
  'credenciamento_cobranca',
  true,
  [
    'estabelecimento_id',
    'fonte_pagadora_id',
    'profissional_id',
    'prestador_terceiro_id',
    'plano_fonte_pagadora_id',
    'tipo_conta_id',
    'grupo_ato_id',
  ],
);
export const opEncerrarExcecaoCredenciamento = opEncerrar(
  'convenio.encerrar-excecao-credenciamento',
  'excecao_credenciamento',
  true,
  [
    'estabelecimento_id',
    'credenciamento_cobranca_id',
    'profissional_id',
    'prestador_terceiro_id',
    'equipe_profissional_id',
    'fonte_pagadora_id',
    'plano_fonte_pagadora_id',
    'tipo_atendimento',
    'grupo_faturamento_id',
    'item_faturavel_id',
    'efeito',
  ],
);

export const esquemaEquivalenciaMatmed = z.object({
  itemReferenciaId: id,
  fontePagadoraId: idN,
  codigoNaFonte: z.string().max(40).nullable().default(null),
  descricaoNaFonte: z.string().max(150).nullable().default(null),
  unidade: z.string().max(15).nullable().default(null),
  fatorConversao: z.number().default(1),
  termoTussId: idN,
  tipoEquivalenciaTuss: z.enum(['exata', 'aproximada', 'generica']).nullable().default(null),
  vigenciaInicio: data,
});

/** Equivalência do item de referência com a operadora e/ou com o termo TUSS, na mesma transação. */
export const opGravarEquivalenciaMatmed = definirOperacao({
  nome: 'preco.gravar-equivalencia-matmed',
  tabelas: ['equivalencia_matmed_fonte_pagadora', 'equivalencia_matmed_tuss'],
  entrada: esquemaEquivalenciaMatmed,
  async gravar(tx, e) {
    const erros: Record<string, string> = {};
    if (e.fontePagadoraId === null && e.termoTussId === null)
      erros['fontePagadoraId'] = 'Informe a operadora, o termo TUSS ou os dois.';
    if (e.fontePagadoraId !== null) {
      const cod = (e.codigoNaFonte ?? '').trim();
      if (!cod) erros['codigoNaFonte'] = 'Informe o código do item na operadora.';
      else if (cod.length > 20) erros['codigoNaFonte'] = 'O código na operadora tem até 20 caracteres.';
    }
    if (!(e.fatorConversao > 0)) erros['fatorConversao'] = 'O fator de conversão é maior que zero.';
    exigirValido(erros);
    await existe(tx, 'item_referencia_matmed', e.itemReferenciaId, 'itemReferenciaId');
    let operadora: number | null = null;
    let tuss: number | null = null;
    if (e.fontePagadoraId !== null) {
      await existe(tx, 'fonte_pagadora', e.fontePagadoraId, 'fontePagadoraId');
      await encerrarAnteriores(
        tx,
        'equivalencia_matmed_fonte_pagadora',
        'fonte_pagadora_id = ? AND item_referencia_matmed_id = ?',
        [e.fontePagadoraId, e.itemReferenciaId],
        e.vigenciaInicio,
      );
      operadora = await tx.incluir('equivalencia_matmed_fonte_pagadora', {
        fonte_pagadora_id: e.fontePagadoraId,
        item_referencia_matmed_id: e.itemReferenciaId,
        codigo_na_fonte: (e.codigoNaFonte ?? '').trim(),
        descricao_na_fonte: e.descricaoNaFonte,
        unidade: e.unidade,
        fator_conversao: e.fatorConversao,
        vigencia_inicio: e.vigenciaInicio,
      });
    }
    if (e.termoTussId !== null) {
      await existe(tx, 'termo_terminologia', e.termoTussId, 'termoTussId');
      await encerrarAnteriores(
        tx,
        'equivalencia_matmed_tuss',
        'item_referencia_matmed_id = ?',
        [e.itemReferenciaId],
        e.vigenciaInicio,
      );
      tuss = await tx.incluir('equivalencia_matmed_tuss', {
        item_referencia_matmed_id: e.itemReferenciaId,
        termo_terminologia_id: e.termoTussId,
        tipo_equivalencia: e.tipoEquivalenciaTuss,
        vigencia_inicio: e.vigenciaInicio,
      });
    }
    return { id: operadora ?? tuss ?? 0, operadora: operadora ?? 0, tuss: tuss ?? 0 };
  },
  alvo: (e) => ({ tabela: 'item_referencia_matmed', id: e.itemReferenciaId }),
});

export const esquemaCredenciamentoCobranca = z.object({
  fontePagadoraId: id,
  planoId: idN,
  profissionalId: idN,
  prestadorId: idN,
  tipoContaId: idN,
  grupoAtoId: idN,
  codigoNaFonte: z.string().max(40).nullable().default(null),
  recebeDiretoDaFonte: z.boolean().default(false),
  vigenciaInicio: data,
  vigenciaFim: data.nullable().default(null),
});

export const opGravarCredenciamentoCobranca = definirOperacao({
  nome: 'convenio.gravar-credenciamento-cobranca',
  tabelas: ['credenciamento_cobranca'],
  entrada: esquemaCredenciamentoCobranca,
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    exigirValido(validarCredenciamentoCobranca(e));
    await existe(tx, 'fonte_pagadora', e.fontePagadoraId, 'fontePagadoraId');
    await existe(tx, 'plano_fonte_pagadora', e.planoId, 'planoId');
    await existe(tx, 'profissional', e.profissionalId, 'profissionalId');
    await existe(tx, 'prestador_terceiro', e.prestadorId, 'prestadorId');
    await existe(tx, 'tipo_conta', e.tipoContaId, 'tipoContaId');
    await existe(tx, 'grupo_ato', e.grupoAtoId, 'grupoAtoId');
    const encerrados = await encerrarAnteriores(
      tx,
      'credenciamento_cobranca',
      `estabelecimento_id = ? AND fonte_pagadora_id = ? AND ${nulo('profissional_id')} AND ${nulo('prestador_terceiro_id')}
        AND ${nulo('plano_fonte_pagadora_id')} AND ${nulo('tipo_conta_id')} AND ${nulo('grupo_ato_id')}`,
      [est, e.fontePagadoraId, e.profissionalId, e.prestadorId, e.planoId, e.tipoContaId, e.grupoAtoId],
      e.vigenciaInicio,
    );
    const novo = await tx.incluir('credenciamento_cobranca', {
      estabelecimento_id: est,
      fonte_pagadora_id: e.fontePagadoraId,
      plano_fonte_pagadora_id: e.planoId,
      profissional_id: e.profissionalId,
      prestador_terceiro_id: e.prestadorId,
      tipo_conta_id: e.tipoContaId,
      grupo_ato_id: e.grupoAtoId,
      codigo_na_fonte: e.codigoNaFonte?.trim() || null,
      recebe_direto_da_fonte: e.recebeDiretoDaFonte,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim,
    });
    return { id: novo, encerrados };
  },
  alvo: (_e, s) => ({ tabela: 'credenciamento_cobranca', id: s.id }),
});

export const esquemaExcecaoCredenciamento = z.object({
  credenciamentoId: idN,
  profissionalId: idN,
  prestadorId: idN,
  equipeId: idN,
  fontePagadoraId: idN,
  planoId: idN,
  tipoAtendimento: z.string().default('todos'),
  grupoId: idN,
  itemId: idN,
  efeito: z.string(),
  motivo: z.string().max(500).nullable().default(null),
  vigenciaInicio: data,
  vigenciaFim: data.nullable().default(null),
});

export const opGravarExcecaoCredenciamento = definirOperacao({
  nome: 'convenio.gravar-excecao-credenciamento',
  tabelas: ['excecao_credenciamento'],
  entrada: esquemaExcecaoCredenciamento,
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    const erros = validarExcecaoCredenciamento(e);
    if (e.itemId !== null && e.grupoId !== null)
      erros['itemId'] = 'A exceção vale para um procedimento ou para um grupo, não os dois.';
    exigirValido(erros);
    if (e.credenciamentoId !== null) {
      const c = await tx.uma<Linha>('SELECT estabelecimento_id FROM credenciamento_cobranca WHERE id = ?', [
        e.credenciamentoId,
      ]);
      if (!c || n(c['estabelecimento_id']) !== est)
        throw recusa('referencia-inexistente', 'O credenciamento não existe neste estabelecimento.', {
          campos: ['credenciamentoId'],
        });
    }
    await existe(tx, 'profissional', e.profissionalId, 'profissionalId');
    await existe(tx, 'prestador_terceiro', e.prestadorId, 'prestadorId');
    await existe(tx, 'equipe_profissional', e.equipeId, 'equipeId');
    await existe(tx, 'fonte_pagadora', e.fontePagadoraId, 'fontePagadoraId');
    await existe(tx, 'plano_fonte_pagadora', e.planoId, 'planoId');
    await existe(tx, 'grupo_faturamento', e.grupoId, 'grupoId');
    await existe(tx, 'item_faturavel', e.itemId, 'itemId');
    const novo = await tx.incluir('excecao_credenciamento', {
      estabelecimento_id: est,
      credenciamento_cobranca_id: e.credenciamentoId,
      profissional_id: e.profissionalId,
      prestador_terceiro_id: e.prestadorId,
      equipe_profissional_id: e.equipeId,
      fonte_pagadora_id: e.fontePagadoraId,
      plano_fonte_pagadora_id: e.planoId,
      tipo_atendimento: e.tipoAtendimento,
      grupo_faturamento_id: e.grupoId,
      item_faturavel_id: e.itemId,
      efeito: e.efeito,
      motivo: e.motivo?.trim() || null,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim,
    });
    return { id: novo };
  },
  alvo: (_e, s) => ({ tabela: 'excecao_credenciamento', id: s.id }),
  trilha: (e) => (e.motivo ? { motivo: e.motivo } : {}),
});

export const OPERACOES_COBRANCA = {
  'equivalencia-item': opGravarEquivalenciaItem,
  'equivalencia-item.encerrar': opEncerrarEquivalenciaItem,
  'equivalencia-matmed': opGravarEquivalenciaMatmed,
  credenciamento: opGravarCredenciamentoCobranca,
  'credenciamento.encerrar': opEncerrarCredenciamentoCobranca,
  excecao: opGravarExcecaoCredenciamento,
  'excecao.encerrar': opEncerrarExcecaoCredenciamento,
} as const;
export type NomeOperacaoCobranca = keyof typeof OPERACOES_COBRANCA;

/** Executa a gravação da cobrança pelo Executor (trilha, autoria e idempotência). */
export async function gravarCobranca(
  executor: Executor,
  nome: NomeOperacaoCobranca,
  ctx: ContextoOperacao,
  entrada: unknown,
): Promise<Record<string, unknown>> {
  const op = OPERACOES_COBRANCA[nome] as Parameters<Executor['executar']>[0];
  const r = await executor.executar(op, ctx.cliente, entrada, ctx);
  return r.resultado as Record<string, unknown>;
}
