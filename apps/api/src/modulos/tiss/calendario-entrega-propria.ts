// Cadastro do calendário de entrega da fatura por convênio (06-FAT linha 31, F3.7): as janelas em que a fonte pagadora
// recebe a fatura de cada competência, o pagamento previsto (data fixa ou prazo em dias) e se a janela é restritiva (o
// registro do protocolo fora dela recusa). Grava calendario_entrega_fatura (12_FAT/01) pelo executor do núcleo, com a
// trilha, a autoria e a idempotência na mesma transação; a regra é do domínio (@sgh/dominio-faturamento,
// tiss/calendario-entrega.ts: validarJanelaEntrega e conferirSobreposicaoJanela). A janela nunca é apagada: inativar
// tira do painel de prazos e da conferência do protocolo, e o histórico fica.
// Melhoria: incluir de novo a janela inativada (mesma competência e mesmo início) reativa a linha, sem duplicar; duas
// janelas ativas da mesma competência não se sobrepõem.
// Sem o banco próprio (fonte sintética de desenvolvimento), a mesma regra roda na CalendarioEntregaMemoria, que a porta
// em memória do TISS usa no painel de prazos.
import type { JanelaCalendarioLida } from '@sgh/contratos';
import {
  conferirSobreposicaoJanela,
  type JanelaEntrega,
  pagamentoPrevistoDaJanela,
  type RecusaCalendario,
  situacaoDaJanela,
  validarJanelaEntrega,
} from '@sgh/dominio-faturamento';
import {
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z, ZodError } from 'zod';

type Linha = Record<string, unknown>;

/** Hoje (AAAA-MM-DD) no fuso dos estabelecimentos. */
const hojeLocal = (agora = new Date()): string =>
  agora.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const TABELA = 'calendario_entrega_fatura';

const data = z.string().max(10);
const campos = {
  /** AAAA-MM da competência. */
  competencia: z.string().max(7),
  inicio: data,
  fim: data,
  pagamentoPrevisto: data.nullish(),
  prazoPagamentoDias: z.number().int().min(0).max(999).nullish(),
  restritivo: z.boolean().default(false),
  observacao: z.string().trim().max(500).default(''),
};
export const esquemaIncluirJanela = z.object({ convenio: z.number().int().positive(), ...campos });
export const esquemaAlterarJanela = z.object({
  id: z.number().int().positive(),
  versao: z.number().int().positive(),
  ...campos,
});
export const esquemaInativarJanela = z.object({
  id: z.number().int().positive(),
  versao: z.number().int().positive(),
});
type IncluirJanela = z.infer<typeof esquemaIncluirJanela>;
type AlterarJanela = z.infer<typeof esquemaAlterarJanela>;

export type AcaoCalendario = 'incluir' | 'alterar' | 'inativar';

export interface FiltroCalendario {
  /** Convênios do escopo do usuário (null: sem restrição). */
  readonly convenios: readonly number[] | null;
  readonly inativas: boolean;
}

export interface CtxCalendario {
  readonly cliente: string;
  readonly estabelecimento: number | null;
  readonly correlacao: string;
}

/** O que o controller usa: a fonte própria (MariaDB) ou a memória da fonte sintética. */
export interface FonteCalendarioEntrega {
  listar(c: CtxCalendario, f: FiltroCalendario): Promise<JanelaCalendarioLida[]>;
  convenioDaJanela(c: CtxCalendario, id: number): Promise<number | null>;
  gravar(acao: AcaoCalendario, ctx: ContextoOperacao, entrada: unknown): Promise<Record<string, unknown>>;
}

/** A janela do domínio a partir da entrada (competência AAAA-MM vira o primeiro dia do mês). */
function janelaDaEntrada(e: Omit<IncluirJanela, 'convenio'>): JanelaEntrega {
  return {
    competencia: `${e.competencia}-01`,
    entregaInicio: e.inicio,
    entregaFim: e.fim,
    pagamentoPrevisto: e.pagamentoPrevisto || null,
    prazoPagamentoDias: e.prazoPagamentoDias ?? null,
    restritivo: e.restritivo,
  };
}

/** Validação do domínio e sobreposição com as ativas do convênio; a recusa sai com os campos. */
export function regraDaJanela(
  j: JanelaEntrega,
  ativas: readonly (Pick<JanelaEntrega, 'competencia' | 'entregaInicio' | 'entregaFim'> & { id: number })[],
  proprio: number | null,
): RecusaCalendario | null {
  const competencia = /^\d{4}-\d{2}-01$/.test(j.competencia)
    ? null
    : {
        codigo: 'competencia-invalida',
        mensagem: 'Informe a competência no formato AAAA-MM.',
        campos: ['competencia'],
      };
  return competencia ?? validarJanelaEntrega(j) ?? conferirSobreposicaoJanela(j, ativas, proprio);
}

const recusaDe = (r: RecusaCalendario) => recusa(r.codigo, r.mensagem, { campos: [...(r.campos ?? [])] });

function janelaLida(
  r: {
    id: number;
    convenio: number;
    convenioNome: string;
    janela: JanelaEntrega;
    ativo: boolean;
    observacao: string;
    versao: number;
  },
  hoje: string,
): JanelaCalendarioLida {
  return {
    id: r.id,
    convenio: r.convenio,
    convenioNome: r.convenioNome,
    competencia: r.janela.competencia,
    inicio: r.janela.entregaInicio,
    fim: r.janela.entregaFim,
    pagamentoPrevisto: r.janela.pagamentoPrevisto,
    prazoPagamentoDias: r.janela.prazoPagamentoDias,
    pagamentoCalculado: pagamentoPrevistoDaJanela(r.janela),
    restritivo: r.janela.restritivo,
    ativo: r.ativo,
    observacao: r.observacao,
    situacao: situacaoDaJanela(r.janela, hoje),
    versao: r.versao,
  };
}

// ── Banco próprio ──────────────────────────────────────────────────────────────────────────────────────

const COLUNAS = `cal.id, cal.fonte_pagadora_id, fp.nome AS fonte, DATE_FORMAT(cal.competencia, '%Y-%m-%d') AS competencia,
  DATE_FORMAT(cal.entrega_inicio, '%Y-%m-%d') AS inicio, DATE_FORMAT(cal.entrega_fim, '%Y-%m-%d') AS fim,
  DATE_FORMAT(cal.pagamento_previsto, '%Y-%m-%d') AS pagamento, cal.prazo_pagamento_dias, cal.restritivo, cal.ativo,
  cal.observacao, cal.versao`;

function daLinha(r: Linha) {
  return {
    id: Number(r['id']),
    convenio: Number(r['fonte_pagadora_id']),
    convenioNome: String(r['fonte'] ?? ''),
    janela: {
      competencia: String(r['competencia']),
      entregaInicio: String(r['inicio']),
      entregaFim: String(r['fim']),
      pagamentoPrevisto: r['pagamento'] ? String(r['pagamento']) : null,
      prazoPagamentoDias:
        r['prazo_pagamento_dias'] === null || r['prazo_pagamento_dias'] === undefined
          ? null
          : Number(r['prazo_pagamento_dias']),
      restritivo: Boolean(Number(r['restritivo'])),
    },
    ativo: Boolean(Number(r['ativo'])),
    observacao: String(r['observacao'] ?? ''),
    versao: Number(r['versao']),
  };
}

/** As janelas do estabelecimento (as ativas; com `inativas`, todas), por convênio, competência e início. */
export async function listarCalendario(
  l: Leitor,
  est: number,
  f: FiltroCalendario,
  hoje = hojeLocal(),
): Promise<JanelaCalendarioLida[]> {
  if (f.convenios !== null && f.convenios.length === 0) return [];
  const em =
    f.convenios === null ? '' : ` AND cal.fonte_pagadora_id IN (${f.convenios.map(() => '?').join(', ')})`;
  const linhas = await l.consultar<Linha>(
    `SELECT ${COLUNAS} FROM calendario_entrega_fatura cal JOIN fonte_pagadora fp ON fp.id = cal.fonte_pagadora_id
      WHERE cal.estabelecimento_id = ?${f.inativas ? '' : ' AND cal.ativo'}${em}
      ORDER BY fp.nome, cal.fonte_pagadora_id, cal.competencia DESC, cal.entrega_inicio
      LIMIT 1000`,
    [est, ...(f.convenios ?? [])],
  );
  return linhas.map((r) => janelaLida(daLinha(r), hoje));
}

async function ativasDoConvenio(
  tx: Leitor,
  est: number,
  convenio: number,
  competencia: string,
): Promise<{ id: number; competencia: string; entregaInicio: string; entregaFim: string }[]> {
  return (
    await tx.consultar<Linha>(
      `SELECT id, DATE_FORMAT(competencia, '%Y-%m-%d') AS competencia, DATE_FORMAT(entrega_inicio, '%Y-%m-%d') AS inicio,
              DATE_FORMAT(entrega_fim, '%Y-%m-%d') AS fim
         FROM calendario_entrega_fatura
        WHERE estabelecimento_id = ? AND fonte_pagadora_id = ? AND competencia = ? AND ativo`,
      [est, convenio, competencia],
    )
  ).map((r) => ({
    id: Number(r['id']),
    competencia: String(r['competencia']),
    entregaInicio: String(r['inicio']),
    entregaFim: String(r['fim']),
  }));
}

const colunasDaJanela = (j: JanelaEntrega, observacao: string) => ({
  competencia: j.competencia,
  entrega_inicio: j.entregaInicio,
  entrega_fim: j.entregaFim,
  pagamento_previsto: j.pagamentoPrevisto,
  prazo_pagamento_dias: j.prazoPagamentoDias,
  restritivo: j.restritivo,
  observacao: observacao || null,
});

function exigirEstabelecimento(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return ctx.estabelecimento;
}

export const opIncluirJanela = definirOperacao({
  nome: 'faturamento.incluir-calendario-entrega',
  tabelas: [TABELA],
  entrada: esquemaIncluirJanela,
  async gravar(tx, e, ctx: ContextoOperacao) {
    const est = exigirEstabelecimento(ctx);
    if (!(await tx.uma<Linha>('SELECT id FROM fonte_pagadora WHERE id = ?', [e.convenio])))
      throw recusa('convenio-inexistente', 'O convênio não existe.', { campos: ['convenio'] });
    const j = janelaDaEntrada(e);
    const r = regraDaJanela(j, await ativasDoConvenio(tx, est, e.convenio, j.competencia), null);
    if (r) throw recusaDe(r);
    // A mesma janela inativada antes (mesma competência e início) volta ativa, com os dados novos.
    const [inativa] = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, versao FROM calendario_entrega_fatura
        WHERE estabelecimento_id = ? AND fonte_pagadora_id = ? AND competencia = ? AND entrega_inicio = ?`,
      [est, e.convenio, j.competencia, j.entregaInicio],
    );
    if (inativa) {
      const id = Number(inativa['id']);
      const versao = await tx.alterar(TABELA, id, Number(inativa['versao']), {
        ...colunasDaJanela(j, e.observacao),
        ativo: true,
      });
      return { id, versao, reativada: true };
    }
    const id = await tx.incluir(TABELA, {
      estabelecimento_id: est,
      fonte_pagadora_id: e.convenio,
      ...colunasDaJanela(j, e.observacao),
      ativo: true,
    });
    return { id, versao: 1, reativada: false };
  },
  alvo: (_e, r) => ({ tabela: TABELA, id: Number(r['id']) }),
});

async function travarJanela(tx: TxOperacao, est: number, id: number) {
  const [l] = await tx.consultarParaAtualizar<Linha>(
    `SELECT id, fonte_pagadora_id, ativo, versao FROM calendario_entrega_fatura WHERE id = ? AND estabelecimento_id = ?`,
    [id, est],
  );
  if (!l) throw recusa('janela-inexistente', 'A janela de entrega não existe.');
  return l;
}

export const opAlterarJanela = definirOperacao({
  nome: 'faturamento.alterar-calendario-entrega',
  tabelas: [TABELA],
  entrada: esquemaAlterarJanela,
  async gravar(tx, e: AlterarJanela, ctx: ContextoOperacao) {
    const est = exigirEstabelecimento(ctx);
    const l = await travarJanela(tx, est, e.id);
    if (!Number(l['ativo']))
      throw recusa('janela-inativa', 'A janela está inativa: inclua de novo para reativá-la.');
    const convenio = Number(l['fonte_pagadora_id']);
    const j = janelaDaEntrada(e);
    const r = regraDaJanela(j, await ativasDoConvenio(tx, est, convenio, j.competencia), e.id);
    if (r) throw recusaDe(r);
    const outra = await tx.uma<Linha>(
      `SELECT id FROM calendario_entrega_fatura
        WHERE estabelecimento_id = ? AND fonte_pagadora_id = ? AND competencia = ? AND entrega_inicio = ? AND id <> ?`,
      [est, convenio, j.competencia, j.entregaInicio, e.id],
    );
    if (outra)
      throw recusa(
        'janela-duplicada',
        'Já existe uma janela inativa com essa competência e esse início: inclua para reativá-la.',
        { campos: ['inicio'] },
      );
    const versao = await tx.alterar(TABELA, e.id, e.versao, colunasDaJanela(j, e.observacao));
    return { id: e.id, versao };
  },
  alvo: (e) => ({ tabela: TABELA, id: e.id }),
});

export const opInativarJanela = definirOperacao({
  nome: 'faturamento.inativar-calendario-entrega',
  tabelas: [TABELA],
  entrada: esquemaInativarJanela,
  async gravar(tx, e, ctx: ContextoOperacao) {
    const est = exigirEstabelecimento(ctx);
    const l = await travarJanela(tx, est, e.id);
    if (!Number(l['ativo'])) throw recusa('janela-inativa', 'A janela já está inativa.');
    const versao = await tx.alterar(TABELA, e.id, e.versao, { ativo: false });
    return { id: e.id, versao };
  },
  alvo: (e) => ({ tabela: TABELA, id: e.id }),
});

const OPERACOES = { incluir: opIncluirJanela, alterar: opAlterarJanela, inativar: opInativarJanela } as const;

/** O calendário sobre o banco próprio do cliente. */
export class CalendarioEntregaProprio implements FonteCalendarioEntrega {
  private readonly executor: Executor;
  constructor(private readonly nucleo: NucleoProprio) {
    this.executor = nucleo.criarExecutor({});
  }

  private ler<T>(c: CtxCalendario, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(
      { cliente: c.cliente, estabelecimento: est, correlacao: c.correlacao },
      (l) => fn(l, est),
    );
  }

  listar(c: CtxCalendario, f: FiltroCalendario): Promise<JanelaCalendarioLida[]> {
    return this.ler(c, (l, est) => listarCalendario(l, est, f));
  }

  convenioDaJanela(c: CtxCalendario, id: number): Promise<number | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma<Linha>(
        'SELECT fonte_pagadora_id FROM calendario_entrega_fatura WHERE id = ? AND estabelecimento_id = ?',
        [id, est],
      );
      return r ? Number(r['fonte_pagadora_id']) : null;
    });
  }

  async gravar(acao: AcaoCalendario, ctx: ContextoOperacao, entrada: unknown) {
    const r = await this.executor.executar(
      OPERACOES[acao] as unknown as Parameters<Executor['executar']>[0],
      ctx.cliente,
      entrada,
      ctx,
    );
    return r.resultado as Record<string, unknown>;
  }
}

// ── Memória (fonte sintética de desenvolvimento) ────────────────────────────────────────────────────────

interface RegistroMemoria {
  id: number;
  convenio: number;
  janela: JanelaEntrega;
  ativo: boolean;
  observacao: string;
  versao: number;
}

/** O mesmo cadastro, com a mesma regra, em memória; a porta em memória do TISS lê daqui o painel de prazos. */
export class CalendarioEntregaMemoria implements FonteCalendarioEntrega {
  private readonly janelas = new Map<number, RegistroMemoria>();
  private seq = 0;
  constructor(private readonly nomeDoConvenio: (convenio: number) => string | null) {}

  /** As janelas ativas do convênio (para o painel de prazos e a conferência do protocolo). */
  ativas(convenio: number): JanelaEntrega[] {
    return [...this.janelas.values()].filter((x) => x.ativo && x.convenio === convenio).map((x) => x.janela);
  }

  async listar(_c: CtxCalendario, f: FiltroCalendario): Promise<JanelaCalendarioLida[]> {
    const hoje = hojeLocal();
    return [...this.janelas.values()]
      .filter((x) => (f.inativas || x.ativo) && (f.convenios === null || f.convenios.includes(x.convenio)))
      .sort(
        (a, b) =>
          a.convenio - b.convenio ||
          b.janela.competencia.localeCompare(a.janela.competencia) ||
          a.janela.entregaInicio.localeCompare(b.janela.entregaInicio),
      )
      .map((x) => janelaLida({ ...x, convenioNome: this.nomeDoConvenio(x.convenio) ?? '' }, hoje));
  }

  async convenioDaJanela(_c: CtxCalendario, id: number): Promise<number | null> {
    return this.janelas.get(id)?.convenio ?? null;
  }

  private ativasDe(convenio: number, competencia: string) {
    return [...this.janelas.values()]
      .filter((x) => x.ativo && x.convenio === convenio && x.janela.competencia === competencia)
      .map((x) => ({ id: x.id, ...x.janela }));
  }

  async gravar(acao: AcaoCalendario, _ctx: ContextoOperacao, entrada: unknown) {
    try {
      if (acao === 'incluir') {
        const e = esquemaIncluirJanela.parse(entrada);
        if (this.nomeDoConvenio(e.convenio) === null)
          throw recusa('convenio-inexistente', 'O convênio não existe.', { campos: ['convenio'] });
        const j = janelaDaEntrada(e);
        const r = regraDaJanela(j, this.ativasDe(e.convenio, j.competencia), null);
        if (r) throw recusaDe(r);
        const antiga = [...this.janelas.values()].find(
          (x) =>
            x.convenio === e.convenio &&
            x.janela.competencia === j.competencia &&
            x.janela.entregaInicio === j.entregaInicio,
        );
        if (antiga) {
          Object.assign(antiga, {
            janela: j,
            ativo: true,
            observacao: e.observacao,
            versao: antiga.versao + 1,
          });
          return { id: antiga.id, versao: antiga.versao, reativada: true };
        }
        const id = ++this.seq;
        this.janelas.set(id, {
          id,
          convenio: e.convenio,
          janela: j,
          ativo: true,
          observacao: e.observacao,
          versao: 1,
        });
        return { id, versao: 1, reativada: false };
      }
      const alt = acao === 'alterar' ? esquemaAlterarJanela.parse(entrada) : null;
      const e = alt ?? esquemaInativarJanela.parse(entrada);
      const x = this.janelas.get(e.id);
      if (!x) throw recusa('janela-inexistente', 'A janela de entrega não existe.');
      if (!x.ativo) throw recusa('janela-inativa', 'A janela está inativa.');
      if (x.versao !== e.versao)
        throw recusa('conflito-versao', 'A janela foi alterada por outra pessoa: recarregue.');
      if (alt) {
        const j = janelaDaEntrada(alt);
        const r = regraDaJanela(j, this.ativasDe(x.convenio, j.competencia), alt.id);
        if (r) throw recusaDe(r);
        Object.assign(x, { janela: j, observacao: alt.observacao });
      } else x.ativo = false;
      x.versao += 1;
      return { id: x.id, versao: x.versao };
    } catch (err) {
      if (err instanceof ZodError)
        throw recusa('entrada-invalida', 'Confira os campos da janela de entrega.', {
          campos: err.issues.map((i) => String(i.path[0] ?? '')),
        });
      throw err;
    }
  }
}
