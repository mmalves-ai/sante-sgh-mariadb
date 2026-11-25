// Gestão estratégica no banco próprio (C2-066, 01-ADM L118), pelo Executor (trilha e idempotência na mesma transação).
// Regras no domínio (@sgh/dominio-qualidade, gestao/gestao-estrategica.ts); aqui ficam leitura e gravação.
//
// - Mapa estratégico (BSC): mapa_estrategico com objetivos (objetivo_estrategico) por perspectiva
//   (perspectiva_estrategica), indicadores ligados (objetivo_estrategico_indicador) e relação de causa e efeito
//   (objetivo_estrategico_relacao). O farol do objetivo sai da última apuração de cada indicador no estabelecimento.
// - Iniciativas: iniciativa_estrategica com objetivos (iniciativa_estrategica_objetivo), participantes
//   (iniciativa_estrategica_participante), ações (iniciativa_estrategica_acao) e horas (apontamento_hora_iniciativa).
//   O progresso da iniciativa é recalculado pelo domínio a cada ação gravada.
// - Reunião de análise crítica: reuniao_analise_critica com participantes e presença, pauta com as análises dos
//   indicadores do período (analise_critica_indicador.reuniao_analise_critica_id), ata e deliberações.
// O que sai do vínculo fica com exclusão lógica (nunca apagado); a ligação desfeita e refeita é reativada.
import {
  analiseNoPeriodo,
  desempenhoObjetivo,
  MENSAGEM_ESTRATEGIA,
  mudarSituacaoAcao,
  mudarSituacaoIniciativa,
  mudarSituacaoReuniao,
  type Presenca,
  progressoIniciativa,
  type RecusaEstrategia,
  reuniaoFechada,
  type SituacaoAcao,
  type SituacaoIniciativa,
  type SituacaoReuniao,
  totalHoras,
  validarAcao,
  validarApontamento,
  validarDeliberacao,
  validarIniciativa,
  validarMapa,
  validarObjetivo,
  validarPresenca,
} from '@sgh/dominio-qualidade';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type Linha,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const dia = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  const d = v as Date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const instante = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);
const recusar = (r: readonly RecusaEstrategia[]) => {
  if (r.length)
    throw recusa(r[0] as string, MENSAGEM_ESTRATEGIA[r[0] as RecusaEstrategia], {
      regras: r.map((codigo) => ({ codigo, mensagem: MENSAGEM_ESTRATEGIA[codigo] })),
    });
};

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dataHora = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/);
const login = z.string().trim().min(1).max(60);
const id = z.number().int().positive();
const textoLongo = z.string().trim().max(20000);
const SIT_INI = ['planejada', 'em_andamento', 'suspensa', 'concluida', 'cancelada'] as const;
const SIT_ACAO = ['pendente', 'em_andamento', 'concluida', 'cancelada'] as const;
const SIT_REU = ['agendada', 'em_preparacao', 'realizada', 'encerrada', 'cancelada'] as const;
const PRIORIDADE = ['baixa', 'media', 'alta', 'critica'] as const;

export const esquemaPerspectiva = z
  .object({
    codigo: z.string().trim().min(1).max(30),
    descricao: z.string().trim().min(1).max(150),
    ordem: z.number().int().min(0).max(999).default(0),
  })
  .strict();
export const esquemaMapa = z
  .object({
    id: id.optional(),
    versao: id.optional(),
    nome: z.string().trim().min(1).max(150),
    descricao: textoLongo.nullable().optional(),
    missao: z.string().trim().max(2000).nullable().optional(),
    visao: z.string().trim().max(2000).nullable().optional(),
    valores: z.string().trim().max(2000).nullable().optional(),
    periodicidade: z.enum(['mensal', 'trimestral', 'semestral', 'anual']).default('mensal'),
    vigenciaInicio: dataIso,
    vigenciaFim: dataIso,
    ativo: z.boolean().default(true),
  })
  .strict();
export const esquemaObjetivo = z
  .object({
    id: id.optional(),
    versao: id.optional(),
    mapa: id,
    perspectiva: id,
    codigo: z.string().trim().min(1).max(30),
    titulo: z.string().trim().min(1).max(240),
    descricao: textoLongo.nullable().optional(),
    responsavel: login.nullable().optional(),
    ordem: z.number().int().min(0).max(999).default(0),
    indicadores: z
      .array(z.object({ indicador: id, peso: z.number().min(0).max(100).nullable().optional() }).strict())
      .max(50),
    causas: z.array(id).max(50).default([]),
  })
  .strict();
export const esquemaIniciativa = z
  .object({
    id: id.optional(),
    versao: id.optional(),
    mapa: id.nullable().optional(),
    codigo: z.string().trim().min(1).max(30).optional(),
    titulo: z.string().trim().min(1).max(240),
    tipo: z.enum(['projeto', 'programa', 'iniciativa']).default('projeto'),
    descricao: textoLongo.nullable().optional(),
    prioridade: z.enum(PRIORIDADE).default('media'),
    responsavel: login,
    patrocinador: login.nullable().optional(),
    inicioPrevisto: dataIso,
    terminoPrevisto: dataIso,
    valorOrcamento: z.number().min(0).max(9_999_999_999_999).nullable().optional(),
    objetivos: z.array(id).max(50).default([]),
    participantes: z
      .array(z.object({ usuario: login, papel: z.enum(['equipe', 'leitor', 'patrocinador']) }).strict())
      .max(100)
      .default([]),
  })
  .strict();
export const esquemaSituacaoIniciativa = z
  .object({ id, versao: id, situacao: z.enum(SIT_INI), resultados: textoLongo.nullable().optional() })
  .strict();
export const esquemaAcao = z
  .object({
    id: id.optional(),
    versao: id.optional(),
    iniciativa: id,
    titulo: z.string().trim().min(1).max(240),
    descricao: textoLongo.nullable().optional(),
    responsavel: login,
    inicioPrevisto: dataIso,
    terminoPrevisto: dataIso,
    duracaoPrevistaMinutos: z.number().int().min(1).max(10_000_000).nullable().optional(),
    prioridade: z.enum(PRIORIDADE).default('media'),
    situacao: z.enum(SIT_ACAO).default('pendente'),
    progresso: z.number().min(0).max(100).nullable().optional(),
  })
  .strict();
export const esquemaApontamento = z
  .object({
    acao: id,
    dataTrabalho: dataIso,
    minutos: z.number().int(),
    classificacao: z.enum(['produtiva', 'extra', 'improdutiva', 'treinamento']).default('produtiva'),
    descricao: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
export const esquemaReuniao = z
  .object({
    id: id.optional(),
    versao: id.optional(),
    titulo: z.string().trim().min(1).max(150),
    mapa: id.nullable().optional(),
    competenciaInicio: dataIso,
    competenciaFim: dataIso,
    inicioPrevisto: dataHora,
    fimPrevisto: dataHora.nullable().optional(),
    local: z.string().trim().max(150).nullable().optional(),
    pauta: textoLongo.nullable().optional(),
    responsavel: login,
    participantes: z
      .array(
        z
          .object({
            usuario: login.nullable().optional(),
            convidado: z.string().trim().min(1).max(150).nullable().optional(),
            papel: z.enum(['coordenador', 'secretario', 'participante', 'convidado']).default('participante'),
          })
          .strict()
          .refine((p) => !!p.usuario !== !!p.convidado, { message: 'usuário ou convidado' }),
      )
      .max(100)
      .default([]),
  })
  .strict();
export const esquemaPauta = z
  .object({ reuniao: id, analises: z.array(id).max(500), retirar: z.array(id).max(500).default([]) })
  .strict();
export const esquemaPresenca = z
  .object({
    reuniao: id,
    presencas: z
      .array(
        z
          .object({
            participante: id,
            presenca: z.enum(['convocado', 'presente', 'ausente', 'ausencia_justificada']),
            justificativa: z.string().trim().max(500).nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export const esquemaDeliberacao = z
  .object({
    id: id.optional(),
    versao: id.optional(),
    reuniao: id,
    descricao: z.string().trim().min(1).max(20000),
    objetivo: id.nullable().optional(),
    indicador: id.nullable().optional(),
    iniciativa: id.nullable().optional(),
    responsavel: login.nullable().optional(),
    prazo: dataIso.nullable().optional(),
    situacao: z.enum(['aberta', 'em_andamento', 'concluida', 'cancelada']).default('aberta'),
  })
  .strict();
export const esquemaSituacaoReuniao = z
  .object({
    id,
    versao: id,
    situacao: z.enum(SIT_REU),
    ata: textoLongo.nullable().optional(),
    realizadaEm: dataHora.optional(),
  })
  .strict();

type E<T extends z.ZodTypeAny> = z.infer<T>;

export interface NucleoEstrategia {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}
export interface ContextoEstrategia {
  readonly hospital: string;
  readonly login: string;
}
export type ContextoGravacaoEstrategia = ContextoEstrategia & {
  readonly correlacao: string;
  readonly chaveIdempotencia: string;
  readonly enderecoIp?: string;
};

const T = {
  persp: 'perspectiva_estrategica',
  mapa: 'mapa_estrategico',
  obj: 'objetivo_estrategico',
  objInd: 'objetivo_estrategico_indicador',
  objRel: 'objetivo_estrategico_relacao',
  ini: 'iniciativa_estrategica',
  iniObj: 'iniciativa_estrategica_objetivo',
  iniPart: 'iniciativa_estrategica_participante',
  acao: 'iniciativa_estrategica_acao',
  horas: 'apontamento_hora_iniciativa',
  reu: 'reuniao_analise_critica',
  reuPart: 'reuniao_analise_critica_participante',
  delib: 'reuniao_analise_critica_deliberacao',
  analise: 'analise_critica_indicador',
} as const;

const naoAchou = (o: string) =>
  new ErroOperacao(404, 'nao-encontrado', 'Não encontrado', `${o} não encontrado.`);

export class GestaoEstrategicaPropria {
  private executorCache: Executor | null = null;
  private get executor(): Executor {
    return (this.executorCache ??= this.nucleo.criarExecutor());
  }

  private readonly ops = {
    perspectiva: definirOperacao<E<typeof esquemaPerspectiva>, { id: number }>({
      nome: 'qualidade.estrategia_perspectiva_gravar',
      tabelas: [T.persp],
      entrada: esquemaPerspectiva as unknown as z.ZodType<E<typeof esquemaPerspectiva>>,
      gravar: (tx, e) => this.gravarPerspectiva(tx, e),
      alvo: (_e, r) => ({ tabela: T.persp, id: r.id }),
    }),
    mapa: definirOperacao<E<typeof esquemaMapa>, { id: number }>({
      nome: 'qualidade.estrategia_mapa_gravar',
      tabelas: [T.mapa],
      entrada: esquemaMapa as unknown as z.ZodType<E<typeof esquemaMapa>>,
      gravar: (tx, e, ctx) => this.gravarMapa(tx, e, ctx),
      alvo: (_e, r) => ({ tabela: T.mapa, id: r.id }),
    }),
    objetivo: definirOperacao<E<typeof esquemaObjetivo>, { id: number }>({
      nome: 'qualidade.estrategia_objetivo_gravar',
      tabelas: [T.obj, T.objInd, T.objRel, T.mapa],
      entrada: esquemaObjetivo as unknown as z.ZodType<E<typeof esquemaObjetivo>>,
      gravar: (tx, e, ctx) => this.gravarObjetivo(tx, e, ctx),
      alvo: (_e, r) => ({ tabela: T.obj, id: r.id }),
    }),
    iniciativa: definirOperacao<E<typeof esquemaIniciativa>, { id: number }>({
      nome: 'qualidade.estrategia_iniciativa_gravar',
      tabelas: [T.ini, T.iniObj, T.iniPart],
      entrada: esquemaIniciativa as unknown as z.ZodType<E<typeof esquemaIniciativa>>,
      gravar: (tx, e, ctx) => this.gravarIniciativa(tx, e, ctx),
      alvo: (_e, r) => ({ tabela: T.ini, id: r.id }),
    }),
    situacaoIniciativa: definirOperacao<E<typeof esquemaSituacaoIniciativa>, { id: number }>({
      nome: 'qualidade.estrategia_iniciativa_situacao',
      tabelas: [T.ini],
      entrada: esquemaSituacaoIniciativa as unknown as z.ZodType<E<typeof esquemaSituacaoIniciativa>>,
      gravar: (tx, e, ctx) => this.situacaoIniciativa(tx, e, ctx),
      alvo: (e) => ({ tabela: T.ini, id: e.id }),
    }),
    acao: definirOperacao<E<typeof esquemaAcao>, { id: number; progressoIniciativa: number }>({
      nome: 'qualidade.estrategia_acao_gravar',
      tabelas: [T.acao, T.ini],
      entrada: esquemaAcao as unknown as z.ZodType<E<typeof esquemaAcao>>,
      gravar: (tx, e, ctx) => this.gravarAcao(tx, e, ctx),
      alvo: (_e, r) => ({ tabela: T.acao, id: r.id }),
    }),
    horas: definirOperacao<E<typeof esquemaApontamento>, { id: number }>({
      nome: 'qualidade.estrategia_horas_apontar',
      tabelas: [T.horas, T.acao, T.ini],
      entrada: esquemaApontamento as unknown as z.ZodType<E<typeof esquemaApontamento>>,
      gravar: (tx, e, ctx) => this.apontar(tx, e, ctx),
      alvo: (_e, r) => ({ tabela: T.horas, id: r.id }),
    }),
    reuniao: definirOperacao<E<typeof esquemaReuniao>, { id: number; numero: string }>({
      nome: 'qualidade.estrategia_reuniao_gravar',
      tabelas: [T.reu, T.reuPart],
      entrada: esquemaReuniao as unknown as z.ZodType<E<typeof esquemaReuniao>>,
      gravar: (tx, e, ctx) => this.reuniaoNaTx(tx, e, ctx),
      alvo: (_e, r) => ({ tabela: T.reu, id: r.id }),
    }),
    pauta: definirOperacao<E<typeof esquemaPauta>, { id: number; vinculadas: number; retiradas: number }>({
      nome: 'qualidade.estrategia_reuniao_pauta',
      tabelas: [T.analise, T.reu],
      entrada: esquemaPauta as unknown as z.ZodType<E<typeof esquemaPauta>>,
      gravar: (tx, e, ctx) => this.pauta(tx, e, ctx),
      alvo: (e) => ({ tabela: T.reu, id: e.reuniao }),
    }),
    presenca: definirOperacao<E<typeof esquemaPresenca>, { id: number }>({
      nome: 'qualidade.estrategia_reuniao_presenca',
      tabelas: [T.reuPart, T.reu],
      entrada: esquemaPresenca as unknown as z.ZodType<E<typeof esquemaPresenca>>,
      gravar: (tx, e, ctx) => this.presenca(tx, e, ctx),
      alvo: (e) => ({ tabela: T.reu, id: e.reuniao }),
    }),
    deliberacao: definirOperacao<E<typeof esquemaDeliberacao>, { id: number }>({
      nome: 'qualidade.estrategia_deliberacao_gravar',
      tabelas: [T.delib, T.reu],
      entrada: esquemaDeliberacao as unknown as z.ZodType<E<typeof esquemaDeliberacao>>,
      gravar: (tx, e, ctx) => this.deliberacaoNaTx(tx, e, ctx),
      alvo: (_e, r) => ({ tabela: T.delib, id: r.id }),
    }),
    situacaoReuniao: definirOperacao<E<typeof esquemaSituacaoReuniao>, { id: number }>({
      nome: 'qualidade.estrategia_reuniao_situacao',
      tabelas: [T.reu, T.analise, T.reuPart],
      entrada: esquemaSituacaoReuniao as unknown as z.ZodType<E<typeof esquemaSituacaoReuniao>>,
      gravar: (tx, e, ctx) => this.situacaoReuniao(tx, e, ctx),
      alvo: (e) => ({ tabela: T.reu, id: e.id }),
    }),
  };

  constructor(
    private readonly nucleo: NucleoEstrategia,
    private readonly cliente: string,
    private readonly hoje: () => string = () => dia(new Date()) as string,
  ) {}

  // ── Contexto ────────────────────────────────────────────────────────────────────────────────────

  private async quem(l: Leitor, c: ContextoEstrategia) {
    const e = await l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
      c.hospital,
    ]);
    if (!e)
      throw new ErroOperacao(
        403,
        'estabelecimento-desconhecido',
        'Estabelecimento',
        'O estabelecimento da sessão não existe no cliente.',
      );
    const u = await l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [c.login]);
    return { estabelecimento: num(e['id']), usuario: u ? num(u['id']) : null };
  }

  private ler<T>(c: ContextoEstrategia, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'qualidade.estrategia' }, async (l) =>
      fn(l, (await this.quem(l, c)).estabelecimento),
    );
  }

  private async exec<S>(
    op: Parameters<Executor['executar']>[0],
    c: ContextoGravacaoEstrategia,
    entrada: unknown,
  ) {
    const q = await this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'qualidade.estrategia' },
      (l) => this.quem(l, c),
    );
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: q.estabelecimento,
      usuario: q.usuario,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
    const r = await this.executor.executar(op, this.cliente, entrada, ctx);
    return { resultado: r.resultado as unknown as S, repetida: r.repetida };
  }

  private async usuario(tx: TxOperacao, l: string): Promise<number> {
    const u = await tx.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [l]);
    if (!u) throw recusa('usuario-desconhecido', `A conta ${l} não existe.`);
    return num(u['id']);
  }

  private async travar(tx: TxOperacao, sql: string, p: unknown[], o: string): Promise<Linha> {
    const [l] = await tx.consultarParaAtualizar(sql, p, { teto: 1 });
    if (!l) throw naoAchou(o);
    return l;
  }

  /**
   * Liga (ou reativa a ligação excluída) e marca como excluída a que saiu; nunca apaga. A tabela vem fixa em quem chama
   * (`atuais`, `alterar` e `incluir`), para o gerador de privilégios ler o nome.
   */
  private async sincronizar(
    atuais: readonly Linha[],
    alvos: readonly { id: number; extra?: Record<string, unknown> }[],
    alterar: (id: number, versao: number, v: Record<string, unknown>) => Promise<number>,
    incluir: (alvo: number, extra: Record<string, unknown>) => Promise<number>,
    usuario: number | null,
  ): Promise<void> {
    const quer = new Map(alvos.map((a) => [a.id, a.extra ?? {}]));
    for (const l of atuais) {
      const alvo = num(l['alvo']);
      const ativo = l['excluido_em'] === null;
      if (quer.has(alvo)) {
        const extra = quer.get(alvo) as Record<string, unknown>;
        if (!ativo || Object.keys(extra).length)
          await alterar(num(l['id']), num(l['versao']), { ...extra, excluido_em: null, excluido_por: null });
        quer.delete(alvo);
      } else if (ativo)
        await alterar(num(l['id']), num(l['versao']), { excluido_em: new Date(), excluido_por: usuario });
    }
    for (const [alvo, extra] of quer) await incluir(alvo, extra);
  }

  // ── Gravação ────────────────────────────────────────────────────────────────────────────────────

  private async gravarPerspectiva(tx: TxOperacao, e: E<typeof esquemaPerspectiva>) {
    const x = await tx.uma('SELECT id FROM perspectiva_estrategica WHERE codigo = ?', [e.codigo]);
    if (x) throw recusa('perspectiva-repetida', 'Já existe perspectiva com esse código.');
    return {
      id: await tx.incluir(T.persp, {
        codigo: e.codigo,
        descricao: e.descricao,
        ordem_padrao: e.ordem,
        ativo: true,
      }),
    };
  }

  private async gravarMapa(tx: TxOperacao, e: E<typeof esquemaMapa>, ctx: ContextoOperacao) {
    recusar(validarMapa(e));
    const valores = {
      nome: e.nome,
      descricao: e.descricao ?? null,
      missao: e.missao ?? null,
      visao: e.visao ?? null,
      valores: e.valores ?? null,
      periodicidade_acompanhamento: e.periodicidade,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim,
      ativo: e.ativo,
    };
    if (e.id) {
      await this.travar(
        tx,
        'SELECT id FROM mapa_estrategico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [e.id, ctx.estabelecimento],
        'Mapa estratégico',
      );
      await tx.alterar(T.mapa, e.id, e.versao ?? 0, valores);
      return { id: e.id };
    }
    return {
      id: await tx.incluir(T.mapa, {
        ...valores,
        estabelecimento_id: ctx.estabelecimento,
        tipo: 'perspectivas',
      }),
    };
  }

  private async gravarObjetivo(tx: TxOperacao, e: E<typeof esquemaObjetivo>, ctx: ContextoOperacao) {
    recusar(validarObjetivo(e.indicadores.map((i) => ({ indicador: i.indicador, peso: i.peso ?? null }))));
    await this.travar(
      tx,
      'SELECT id FROM mapa_estrategico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.mapa, ctx.estabelecimento],
      'Mapa estratégico',
    );
    const p = await tx.uma('SELECT id FROM perspectiva_estrategica WHERE id = ? AND ativo', [e.perspectiva]);
    if (!p) throw recusa('perspectiva-inexistente', 'Perspectiva inexistente ou inativa.');
    for (const i of e.indicadores) {
      const x = await tx.uma('SELECT id FROM indicador WHERE id = ? AND ativo AND excluido_em IS NULL', [
        i.indicador,
      ]);
      if (!x) throw recusa('indicador-inexistente', 'Indicador inexistente ou inativo.');
    }
    const valores = {
      mapa_estrategico_id: e.mapa,
      perspectiva_estrategica_id: e.perspectiva,
      codigo: e.codigo,
      titulo: e.titulo,
      descricao: e.descricao ?? null,
      responsavel_usuario_id: e.responsavel ? await this.usuario(tx, e.responsavel) : null,
      ordem_mapa: e.ordem,
    };
    const rep = await tx.uma(
      'SELECT id FROM objetivo_estrategico WHERE mapa_estrategico_id = ? AND codigo = ? AND id <> ?',
      [e.mapa, e.codigo, e.id ?? 0],
    );
    if (rep) throw recusa('objetivo-codigo-repetido', 'Já existe objetivo com esse código no mapa.');
    let objetivo: number;
    if (e.id) {
      await this.travar(
        tx,
        'SELECT id FROM objetivo_estrategico WHERE id = ? AND mapa_estrategico_id = ? AND excluido_em IS NULL',
        [e.id, e.mapa],
        'Objetivo estratégico',
      );
      await tx.alterar(T.obj, e.id, e.versao ?? 0, valores);
      objetivo = e.id;
    } else objetivo = await tx.incluir(T.obj, valores);
    await this.sincronizar(
      await tx.consultar(
        `SELECT id, indicador_id AS alvo, excluido_em, versao FROM objetivo_estrategico_indicador
          WHERE objetivo_estrategico_id = ?`,
        [objetivo],
      ),
      e.indicadores.map((i, n) => ({ id: i.indicador, extra: { peso: i.peso ?? null, ordem_exibicao: n } })),
      (i, v, x) => tx.alterar(T.objInd, i, v, x),
      (alvo, x) => tx.incluir(T.objInd, { ...x, objetivo_estrategico_id: objetivo, indicador_id: alvo }),
      ctx.usuario,
    );
    for (const c of e.causas) {
      if (c === objetivo)
        throw recusa('objetivo-causa-propria', 'O objetivo não pode ser causa de si mesmo.');
      const x = await tx.uma('SELECT id FROM objetivo_estrategico WHERE id = ? AND mapa_estrategico_id = ?', [
        c,
        e.mapa,
      ]);
      if (!x) throw recusa('objetivo-causa-outro-mapa', 'A causa precisa ser objetivo do mesmo mapa.');
    }
    await this.sincronizar(
      await tx.consultar(
        `SELECT id, objetivo_causa_id AS alvo, excluido_em, versao FROM objetivo_estrategico_relacao
          WHERE objetivo_efeito_id = ?`,
        [objetivo],
      ),
      e.causas.map((c) => ({ id: c })),
      (i, v, x) => tx.alterar(T.objRel, i, v, x),
      (alvo, x) => tx.incluir(T.objRel, { ...x, objetivo_efeito_id: objetivo, objetivo_causa_id: alvo }),
      ctx.usuario,
    );
    return { id: objetivo };
  }

  private async iniciativaDoEstab(tx: TxOperacao, iniciativa: number, est: number) {
    return this.travar(
      tx,
      `SELECT id, situacao, inicio_previsto, termino_previsto, inicio_real, versao FROM iniciativa_estrategica
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [iniciativa, est],
      'Iniciativa',
    );
  }

  /** Mapa do estabelecimento da sessão; o de outro estabelecimento é recusado como inexistente. */
  private async mapaDoEstab(tx: TxOperacao, mapa: number, est: number) {
    const x = await tx.uma(
      'SELECT id FROM mapa_estrategico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [mapa, est],
    );
    if (!x) throw recusa('mapa-inexistente', 'Mapa estratégico inexistente.');
  }

  /** Objetivo de um mapa do estabelecimento da sessão; o de outro estabelecimento é recusado como inexistente. */
  private async objetivoDoEstab(tx: TxOperacao, objetivo: number, est: number) {
    const x = await tx.uma(
      `SELECT o.id FROM objetivo_estrategico o JOIN mapa_estrategico m ON m.id = o.mapa_estrategico_id
        WHERE o.id = ? AND m.estabelecimento_id = ? AND o.excluido_em IS NULL AND m.excluido_em IS NULL`,
      [objetivo, est],
    );
    if (!x) throw recusa('objetivo-inexistente', 'Objetivo estratégico inexistente.');
  }

  private async gravarIniciativa(tx: TxOperacao, e: E<typeof esquemaIniciativa>, ctx: ContextoOperacao) {
    recusar(validarIniciativa(e));
    if (e.mapa) await this.mapaDoEstab(tx, e.mapa, ctx.estabelecimento as number);
    for (const o of e.objetivos) await this.objetivoDoEstab(tx, o, ctx.estabelecimento as number);
    const valores: Record<string, unknown> = {
      mapa_estrategico_id: e.mapa ?? null,
      titulo: e.titulo,
      tipo: e.tipo,
      descricao: e.descricao ?? null,
      prioridade: e.prioridade,
      responsavel_usuario_id: await this.usuario(tx, e.responsavel),
      patrocinador_usuario_id: e.patrocinador ? await this.usuario(tx, e.patrocinador) : null,
      inicio_previsto: e.inicioPrevisto,
      termino_previsto: e.terminoPrevisto,
      valor_orcamento: e.valorOrcamento ?? null,
    };
    let ini: number;
    if (e.id) {
      const a = await this.iniciativaDoEstab(tx, e.id, ctx.estabelecimento as number);
      if (['concluida', 'cancelada'].includes(String(a['situacao']))) recusar(['iniciativa-encerrada']);
      await tx.alterar(T.ini, e.id, e.versao ?? 0, valores);
      ini = e.id;
    } else {
      const ano = e.inicioPrevisto.slice(0, 4);
      const n = await tx.uma('SELECT COUNT(*) AS q FROM iniciativa_estrategica WHERE codigo LIKE ?', [
        `INI-${ano}-%`,
      ]);
      const codigo = e.codigo ?? `INI-${ano}-${String(num(n?.['q']) + 1).padStart(4, '0')}`;
      const rep = await tx.uma('SELECT id FROM iniciativa_estrategica WHERE codigo = ?', [codigo]);
      if (rep) throw recusa('iniciativa-codigo-repetido', 'Já existe iniciativa com esse código.');
      ini = await tx.incluir(T.ini, {
        ...valores,
        codigo,
        estabelecimento_id: ctx.estabelecimento,
        situacao: 'planejada',
      });
    }
    await this.sincronizar(
      await tx.consultar(
        `SELECT id, objetivo_estrategico_id AS alvo, excluido_em, versao FROM iniciativa_estrategica_objetivo
          WHERE iniciativa_estrategica_id = ?`,
        [ini],
      ),
      e.objetivos.map((o) => ({ id: o })),
      (i, v, x) => tx.alterar(T.iniObj, i, v, x),
      (alvo, x) =>
        tx.incluir(T.iniObj, { ...x, iniciativa_estrategica_id: ini, objetivo_estrategico_id: alvo }),
      ctx.usuario,
    );
    const parts: { id: number; extra: Record<string, unknown> }[] = [];
    for (const p of e.participantes)
      parts.push({ id: await this.usuario(tx, p.usuario), extra: { papel: p.papel } });
    if (new Set(parts.map((p) => p.id)).size !== parts.length)
      throw recusa('participante-repetido', 'A mesma pessoa aparece mais de uma vez.');
    await this.sincronizar(
      await tx.consultar(
        `SELECT id, usuario_id AS alvo, excluido_em, versao FROM iniciativa_estrategica_participante
          WHERE iniciativa_estrategica_id = ? AND usuario_id IS NOT NULL`,
        [ini],
      ),
      parts,
      (i, v, x) => tx.alterar(T.iniPart, i, v, x),
      (alvo, x) => tx.incluir(T.iniPart, { ...x, iniciativa_estrategica_id: ini, usuario_id: alvo }),
      ctx.usuario,
    );
    return { id: ini };
  }

  private async acoesDa(tx: TxOperacao, ini: number) {
    return tx.consultar(
      `SELECT situacao, percentual_progresso, duracao_prevista_minutos, inicio_previsto, termino_previsto
         FROM iniciativa_estrategica_acao WHERE iniciativa_estrategica_id = ? AND excluido_em IS NULL`,
      [ini],
    );
  }

  private async situacaoIniciativa(
    tx: TxOperacao,
    e: E<typeof esquemaSituacaoIniciativa>,
    ctx: ContextoOperacao,
  ) {
    const a = await this.iniciativaDoEstab(tx, e.id, ctx.estabelecimento as number);
    const acoes = await this.acoesDa(tx, e.id);
    const r = mudarSituacaoIniciativa(
      { situacao: String(a['situacao']) as SituacaoIniciativa, inicioReal: dia(a['inicio_real']) },
      e.situacao,
      acoes.map((x) => ({ situacao: String(x['situacao']) as SituacaoAcao })),
      this.hoje(),
    );
    if (!r.ok) recusar([r.recusa]);
    else
      await tx.alterar(T.ini, e.id, e.versao, {
        situacao: e.situacao,
        inicio_real: r.inicioReal,
        termino_real: r.terminoReal,
        ...(r.progresso !== null ? { percentual_progresso: r.progresso } : {}),
        ...(e.resultados !== undefined ? { resultados: e.resultados } : {}),
      });
    return { id: e.id };
  }

  private async gravarAcao(tx: TxOperacao, e: E<typeof esquemaAcao>, ctx: ContextoOperacao) {
    const ini = await this.iniciativaDoEstab(tx, e.iniciativa, ctx.estabelecimento as number);
    recusar(
      validarAcao(e, {
        inicioPrevisto: dia(ini['inicio_previsto']) as string,
        terminoPrevisto: dia(ini['termino_previsto']) as string,
        situacao: String(ini['situacao']) as SituacaoIniciativa,
      }),
    );
    const atual = e.id
      ? await this.travar(
          tx,
          `SELECT id, situacao, inicio_real, percentual_progresso FROM iniciativa_estrategica_acao
            WHERE id = ? AND iniciativa_estrategica_id = ? AND excluido_em IS NULL`,
          [e.id, e.iniciativa],
          'Ação',
        )
      : null;
    const m = mudarSituacaoAcao(
      {
        situacao: (atual ? String(atual['situacao']) : 'pendente') as SituacaoAcao,
        inicioReal: atual ? dia(atual['inicio_real']) : null,
        progresso: atual ? num(atual['percentual_progresso']) : 0,
      },
      e.situacao,
      e.progresso ?? null,
      this.hoje(),
    );
    if (!m.ok) {
      recusar([m.recusa]);
      return { id: 0, progressoIniciativa: 0 };
    }
    const valores = {
      titulo: e.titulo,
      descricao: e.descricao ?? null,
      responsavel_usuario_id: await this.usuario(tx, e.responsavel),
      inicio_previsto: e.inicioPrevisto,
      termino_previsto: e.terminoPrevisto,
      duracao_prevista_minutos: e.duracaoPrevistaMinutos ?? null,
      prioridade: e.prioridade,
      situacao: e.situacao,
      inicio_real: m.inicioReal,
      termino_real: m.terminoReal,
      percentual_progresso: m.progresso,
    };
    let acao: number;
    if (atual && e.id) {
      await tx.alterar(T.acao, e.id, e.versao ?? 0, valores);
      acao = e.id;
    } else {
      const s = await tx.uma(
        'SELECT COALESCE(MAX(sequencia), 0) AS s FROM iniciativa_estrategica_acao WHERE iniciativa_estrategica_id = ?',
        [e.iniciativa],
      );
      acao = await tx.incluir(T.acao, {
        ...valores,
        iniciativa_estrategica_id: e.iniciativa,
        sequencia: num(s?.['s']) + 1,
      });
    }
    const progresso = progressoIniciativa(
      (await this.acoesDa(tx, e.iniciativa)).map((x) => ({
        situacao: String(x['situacao']) as SituacaoAcao,
        progresso: num(x['percentual_progresso']),
        duracaoPrevistaMinutos: numOuNull(x['duracao_prevista_minutos']),
        inicioPrevisto: dia(x['inicio_previsto']) as string,
        terminoPrevisto: dia(x['termino_previsto']) as string,
      })),
    );
    await tx.alterar(T.ini, e.iniciativa, num(ini['versao']), { percentual_progresso: progresso });
    return { id: acao, progressoIniciativa: progresso };
  }

  private async apontar(tx: TxOperacao, e: E<typeof esquemaApontamento>, ctx: ContextoOperacao) {
    const a = await this.travar(
      tx,
      `SELECT a.id, a.situacao, a.inicio_previsto, i.situacao AS situacao_iniciativa
         FROM iniciativa_estrategica_acao a JOIN iniciativa_estrategica i ON i.id = a.iniciativa_estrategica_id
        WHERE a.id = ? AND i.estabelecimento_id = ? AND a.excluido_em IS NULL`,
      [e.acao, ctx.estabelecimento],
      'Ação',
    );
    const ja = await tx.uma(
      `SELECT COALESCE(SUM(duracao_minutos), 0) AS m FROM apontamento_hora_iniciativa
        WHERE usuario_id = ? AND data_trabalho = ? AND excluido_em IS NULL`,
      [ctx.usuario, e.dataTrabalho],
    );
    recusar(
      validarApontamento({
        dataTrabalho: e.dataTrabalho,
        minutos: e.minutos,
        hoje: this.hoje(),
        minutosJaApontadosNoDia: num(ja?.['m']),
        acao: {
          situacao: String(a['situacao']) as SituacaoAcao,
          inicioPrevisto: dia(a['inicio_previsto']) as string,
        },
        iniciativa: String(a['situacao_iniciativa']) as SituacaoIniciativa,
      }),
    );
    if (!ctx.usuario) throw recusa('usuario-desconhecido', 'A conta da sessão não existe no cliente.');
    const s = await tx.uma(
      'SELECT COALESCE(MAX(sequencia), 0) AS s FROM apontamento_hora_iniciativa WHERE iniciativa_estrategica_acao_id = ?',
      [e.acao],
    );
    return {
      id: await tx.incluir(T.horas, {
        iniciativa_estrategica_acao_id: e.acao,
        sequencia: num(s?.['s']) + 1,
        usuario_id: ctx.usuario,
        data_trabalho: e.dataTrabalho,
        duracao_minutos: e.minutos,
        classificacao_hora: e.classificacao,
        descricao: e.descricao ?? null,
      }),
    };
  }

  private async reuniaoDoEstab(tx: TxOperacao, reuniao: number, est: number) {
    return this.travar(
      tx,
      `SELECT id, situacao, competencia_inicio, competencia_fim, inicio_previsto_em, realizada_em, ata, versao
         FROM reuniao_analise_critica WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [reuniao, est],
      'Reunião de análise crítica',
    );
  }

  private abertaOuRecusa(r: Linha) {
    if (reuniaoFechada(String(r['situacao']) as SituacaoReuniao)) recusar(['reuniao-encerrada']);
  }

  private async reuniaoNaTx(tx: TxOperacao, e: E<typeof esquemaReuniao>, ctx: ContextoOperacao) {
    if (e.competenciaFim < e.competenciaInicio)
      throw recusa('reuniao-competencia', 'O fim do período analisado não pode ser antes do início.');
    if (e.fimPrevisto && e.fimPrevisto < e.inicioPrevisto)
      throw recusa('reuniao-horario', 'O fim previsto não pode ser antes do início.');
    if (e.mapa) await this.mapaDoEstab(tx, e.mapa, ctx.estabelecimento as number);
    const valores = {
      titulo: e.titulo,
      mapa_estrategico_id: e.mapa ?? null,
      competencia_inicio: e.competenciaInicio,
      competencia_fim: e.competenciaFim,
      inicio_previsto_em: e.inicioPrevisto.replace('T', ' '),
      fim_previsto_em: e.fimPrevisto ? e.fimPrevisto.replace('T', ' ') : null,
      local_reuniao: e.local ?? null,
      pauta: e.pauta ?? null,
      responsavel_usuario_id: await this.usuario(tx, e.responsavel),
    };
    let reu: number;
    let numero: string;
    if (e.id) {
      const r = await this.reuniaoDoEstab(tx, e.id, ctx.estabelecimento as number);
      this.abertaOuRecusa(r);
      await tx.alterar(T.reu, e.id, e.versao ?? 0, valores);
      reu = e.id;
      numero = String(
        (await tx.uma('SELECT numero FROM reuniao_analise_critica WHERE id = ?', [reu]))?.['numero'],
      );
    } else {
      const ano = e.inicioPrevisto.slice(0, 4);
      const n = await tx.uma(
        'SELECT COUNT(*) AS q FROM reuniao_analise_critica WHERE estabelecimento_id = ? AND numero LIKE ?',
        [ctx.estabelecimento, `RAC-${ano}-%`],
      );
      numero = `RAC-${ano}-${String(num(n?.['q']) + 1).padStart(4, '0')}`;
      reu = await tx.incluir(T.reu, {
        ...valores,
        numero,
        estabelecimento_id: ctx.estabelecimento,
        registrante_usuario_id: ctx.usuario,
        situacao: 'agendada',
      });
    }
    // Participantes: pessoas da conta por usuário; convidados externos pelo nome. Quem sai fica excluído.
    const atuais = await tx.consultar(
      'SELECT id, usuario_id, nome_convidado, excluido_em, versao FROM reuniao_analise_critica_participante WHERE reuniao_analise_critica_id = ?',
      [reu],
    );
    const chave = (u: unknown, c: unknown) =>
      u !== null && u !== undefined ? `u${num(u)}` : `c${String(c).toUpperCase()}`;
    const quer = new Map<string, { usuario: number | null; convidado: string | null; papel: string }>();
    for (const p of e.participantes) {
      const u = p.usuario ? await this.usuario(tx, p.usuario) : null;
      const k = chave(u, p.convidado);
      if (quer.has(k)) throw recusa('participante-repetido', 'A mesma pessoa aparece mais de uma vez.');
      quer.set(k, { usuario: u, convidado: p.convidado ?? null, papel: p.papel });
    }
    for (const l of atuais) {
      const k = chave(l['usuario_id'], l['nome_convidado']);
      const q = quer.get(k);
      if (q) {
        await tx.alterar(T.reuPart, num(l['id']), num(l['versao']), {
          papel: q.papel,
          excluido_em: null,
          excluido_por: null,
        });
        quer.delete(k);
      } else if (l['excluido_em'] === null)
        await tx.alterar(T.reuPart, num(l['id']), num(l['versao']), {
          excluido_em: new Date(),
          excluido_por: ctx.usuario,
        });
    }
    let seq = num(
      (
        await tx.uma(
          'SELECT COALESCE(MAX(sequencia), 0) AS s FROM reuniao_analise_critica_participante WHERE reuniao_analise_critica_id = ?',
          [reu],
        )
      )?.['s'],
    );
    for (const q of quer.values())
      await tx.incluir(T.reuPart, {
        reuniao_analise_critica_id: reu,
        sequencia: ++seq,
        usuario_id: q.usuario,
        nome_convidado: q.usuario ? null : q.convidado,
        papel: q.papel,
        presenca: 'convocado',
      });
    return { id: reu, numero };
  }

  private async pauta(tx: TxOperacao, e: E<typeof esquemaPauta>, ctx: ContextoOperacao) {
    const r = await this.reuniaoDoEstab(tx, e.reuniao, ctx.estabelecimento as number);
    this.abertaOuRecusa(r);
    const periodo = {
      competenciaInicio: dia(r['competencia_inicio']) as string,
      competenciaFim: dia(r['competencia_fim']) as string,
    };
    let vinculadas = 0;
    for (const a of e.analises) {
      const l = await this.travar(
        tx,
        `SELECT x.id, x.versao, x.reuniao_analise_critica_id, ap.competencia
           FROM analise_critica_indicador x JOIN apuracao_indicador ap ON ap.id = x.apuracao_indicador_id
          WHERE x.id = ? AND ap.estabelecimento_id = ? AND x.excluido_em IS NULL`,
        [a, ctx.estabelecimento],
        'Análise do indicador',
      );
      if (!analiseNoPeriodo(dia(l['competencia']) as string, periodo))
        recusar(['reuniao-analise-fora-do-periodo']);
      const outra = numOuNull(l['reuniao_analise_critica_id']);
      if (outra === e.reuniao) continue;
      if (outra !== null)
        throw recusa('analise-em-outra-reuniao', 'A análise já está na pauta de outra reunião.');
      await tx.alterar(T.analise, a, num(l['versao']), { reuniao_analise_critica_id: e.reuniao });
      vinculadas++;
    }
    let retiradas = 0;
    for (const a of e.retirar) {
      const l = await this.travar(
        tx,
        'SELECT id, versao FROM analise_critica_indicador WHERE id = ? AND reuniao_analise_critica_id = ?',
        [a, e.reuniao],
        'Análise na pauta',
      );
      await tx.alterar(T.analise, a, num(l['versao']), { reuniao_analise_critica_id: null });
      retiradas++;
    }
    return { id: e.reuniao, vinculadas, retiradas };
  }

  private async presenca(tx: TxOperacao, e: E<typeof esquemaPresenca>, ctx: ContextoOperacao) {
    const r = await this.reuniaoDoEstab(tx, e.reuniao, ctx.estabelecimento as number);
    this.abertaOuRecusa(r);
    for (const p of e.presencas) {
      recusar(validarPresenca({ presenca: p.presenca, justificativa: p.justificativa ?? null }));
      const l = await this.travar(
        tx,
        `SELECT id, versao FROM reuniao_analise_critica_participante
          WHERE id = ? AND reuniao_analise_critica_id = ? AND excluido_em IS NULL`,
        [p.participante, e.reuniao],
        'Participante',
      );
      await tx.alterar(T.reuPart, p.participante, num(l['versao']), {
        presenca: p.presenca,
        justificativa_ausencia: p.presenca === 'ausencia_justificada' ? (p.justificativa ?? null) : null,
      });
    }
    return { id: e.reuniao };
  }

  private async deliberacaoNaTx(tx: TxOperacao, e: E<typeof esquemaDeliberacao>, ctx: ContextoOperacao) {
    const r = await this.reuniaoDoEstab(tx, e.reuniao, ctx.estabelecimento as number);
    const fechada = reuniaoFechada(String(r['situacao']) as SituacaoReuniao);
    // Depois de encerrada a reunião, a deliberação só segue o andamento (situação); não se inclui nem se reescreve.
    if (fechada && !e.id) recusar(['reuniao-encerrada']);
    recusar(validarDeliberacao({ prazo: e.prazo ?? null }, dia(r['inicio_previsto_em']) as string));
    const valores: Record<string, unknown> = {
      situacao: e.situacao,
      concluida_em: e.situacao === 'concluida' ? new Date() : null,
    };
    if (!fechada) {
      // Cada referência tem de ser do estabelecimento da sessão (o indicador é do catálogo comum da conta).
      const est = ctx.estabelecimento as number;
      if (e.objetivo) await this.objetivoDoEstab(tx, e.objetivo, est);
      if (e.iniciativa) {
        const i = await tx.uma(
          'SELECT id FROM iniciativa_estrategica WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [e.iniciativa, est],
        );
        if (!i) throw recusa('iniciativa-inexistente', 'Iniciativa estratégica inexistente.');
      }
      if (e.indicador) {
        const i = await tx.uma('SELECT id FROM indicador WHERE id = ? AND excluido_em IS NULL', [
          e.indicador,
        ]);
        if (!i) throw recusa('indicador-inexistente', 'Indicador inexistente.');
      }
      Object.assign(valores, {
        descricao: e.descricao,
        objetivo_estrategico_id: e.objetivo ?? null,
        indicador_id: e.indicador ?? null,
        iniciativa_estrategica_id: e.iniciativa ?? null,
        responsavel_usuario_id: e.responsavel ? await this.usuario(tx, e.responsavel) : null,
        prazo: e.prazo ?? null,
      });
    }
    if (e.id) {
      const d = await this.travar(
        tx,
        `SELECT id, concluida_em FROM reuniao_analise_critica_deliberacao
          WHERE id = ? AND reuniao_analise_critica_id = ? AND excluido_em IS NULL`,
        [e.id, e.reuniao],
        'Deliberação',
      );
      if (e.situacao === 'concluida' && d['concluida_em']) valores['concluida_em'] = d['concluida_em'];
      await tx.alterar(T.delib, e.id, e.versao ?? 0, valores);
      return { id: e.id };
    }
    const s = await tx.uma(
      'SELECT COALESCE(MAX(sequencia), 0) AS s FROM reuniao_analise_critica_deliberacao WHERE reuniao_analise_critica_id = ?',
      [e.reuniao],
    );
    return {
      id: await tx.incluir(T.delib, {
        ...valores,
        reuniao_analise_critica_id: e.reuniao,
        sequencia: num(s?.['s']) + 1,
      }),
    };
  }

  private async situacaoReuniao(tx: TxOperacao, e: E<typeof esquemaSituacaoReuniao>, ctx: ContextoOperacao) {
    const r = await this.reuniaoDoEstab(tx, e.id, ctx.estabelecimento as number);
    const presencas = (
      await tx.consultar(
        'SELECT presenca FROM reuniao_analise_critica_participante WHERE reuniao_analise_critica_id = ? AND excluido_em IS NULL',
        [e.id],
      )
    ).map((x) => String(x['presenca']) as Presenca);
    const ata = e.ata !== undefined ? e.ata : txt(r['ata']);
    recusar(mudarSituacaoReuniao(String(r['situacao']) as SituacaoReuniao, e.situacao, { ata, presencas }));
    const valores: Record<string, unknown> = { situacao: e.situacao, ata };
    if (e.situacao === 'em_preparacao') valores['abertura_em'] = new Date();
    if (e.situacao === 'realizada')
      valores['realizada_em'] = e.realizadaEm ? e.realizadaEm.replace('T', ' ') : new Date();
    if (e.situacao === 'encerrada') valores['fechamento_em'] = new Date();
    await tx.alterar(T.reu, e.id, e.versao, valores);
    // Encerrada a reunião, as análises da pauta passam a "apresentada" (a análise em si não muda de texto).
    if (e.situacao === 'encerrada')
      await tx.executar(
        `UPDATE analise_critica_indicador SET situacao = 'apresentada', alterado_em = NOW(3), alterado_por = ?,
                versao = versao + 1
          WHERE reuniao_analise_critica_id = ? AND situacao = 'concluida' AND excluido_em IS NULL`,
        [ctx.usuario, e.id],
      );
    return { id: e.id };
  }

  // ── API pública da porta ───────────────────────────────────────────────────────────────────────

  gravarPerspectivaEstrategica = (c: ContextoGravacaoEstrategia, e: unknown) =>
    this.exec(this.ops.perspectiva, c, e);
  gravarMapaEstrategico = (c: ContextoGravacaoEstrategia, e: unknown) => this.exec(this.ops.mapa, c, e);
  gravarObjetivoEstrategico = (c: ContextoGravacaoEstrategia, e: unknown) =>
    this.exec(this.ops.objetivo, c, e);
  gravarIniciativaEstrategica = (c: ContextoGravacaoEstrategia, e: unknown) =>
    this.exec(this.ops.iniciativa, c, e);
  mudarSituacaoIniciativa = (c: ContextoGravacaoEstrategia, e: unknown) =>
    this.exec(this.ops.situacaoIniciativa, c, e);
  gravarAcaoIniciativa = (c: ContextoGravacaoEstrategia, e: unknown) => this.exec(this.ops.acao, c, e);
  apontarHoras = (c: ContextoGravacaoEstrategia, e: unknown) => this.exec(this.ops.horas, c, e);
  gravarReuniao = (c: ContextoGravacaoEstrategia, e: unknown) => this.exec(this.ops.reuniao, c, e);
  gravarPauta = (c: ContextoGravacaoEstrategia, e: unknown) => this.exec(this.ops.pauta, c, e);
  registrarPresenca = (c: ContextoGravacaoEstrategia, e: unknown) => this.exec(this.ops.presenca, c, e);
  gravarDeliberacao = (c: ContextoGravacaoEstrategia, e: unknown) => this.exec(this.ops.deliberacao, c, e);
  mudarSituacaoReuniao = (c: ContextoGravacaoEstrategia, e: unknown) =>
    this.exec(this.ops.situacaoReuniao, c, e);

  // ── Leitura ─────────────────────────────────────────────────────────────────────────────────────

  /** Catálogos e listas: perspectivas, indicadores ativos, mapas, iniciativas e reuniões do estabelecimento. */
  painel(c: ContextoEstrategia) {
    return this.ler(c, async (l, est) => {
      const perspectivas = await l.consultar(
        'SELECT id, codigo, descricao, ordem_padrao FROM perspectiva_estrategica WHERE ativo ORDER BY ordem_padrao, descricao',
        [],
      );
      const indicadores = await l.consultar(
        'SELECT id, codigo, nome FROM indicador WHERE ativo AND excluido_em IS NULL ORDER BY nome',
        [],
        { teto: 2000 },
      );
      const mapas = await l.consultar(
        `SELECT m.id, m.versao, m.nome, m.vigencia_inicio, m.vigencia_fim, m.ativo,
                (SELECT COUNT(*) FROM objetivo_estrategico o WHERE o.mapa_estrategico_id = m.id AND o.excluido_em IS NULL) AS objetivos
           FROM mapa_estrategico m WHERE m.estabelecimento_id = ? AND m.excluido_em IS NULL
          ORDER BY m.ativo DESC, m.vigencia_inicio DESC`,
        [est],
      );
      const iniciativas = await l.consultar(
        `SELECT i.id, i.versao, i.codigo, i.titulo, i.situacao, i.prioridade, i.percentual_progresso,
                i.inicio_previsto, i.termino_previsto, u.login AS responsavel
           FROM iniciativa_estrategica i JOIN usuario u ON u.id = i.responsavel_usuario_id
          WHERE i.estabelecimento_id = ? AND i.excluido_em IS NULL AND NOT i.arquivada
          ORDER BY FIELD(i.situacao, 'em_andamento', 'planejada', 'suspensa', 'concluida', 'cancelada'), i.termino_previsto`,
        [est],
        { teto: 500 },
      );
      const reunioes = await l.consultar(
        `SELECT r.id, r.versao, r.numero, r.titulo, r.situacao, r.inicio_previsto_em, r.competencia_inicio, r.competencia_fim
           FROM reuniao_analise_critica r WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL
          ORDER BY r.inicio_previsto_em DESC`,
        [est],
        { teto: 500 },
      );
      return {
        perspectivas: perspectivas.map((p) => ({
          id: num(p['id']),
          codigo: String(p['codigo']),
          descricao: String(p['descricao']),
          ordem: num(p['ordem_padrao']),
        })),
        indicadores: indicadores.map((i) => ({
          id: num(i['id']),
          codigo: String(i['codigo']),
          nome: String(i['nome']),
        })),
        mapas: mapas.map((m) => ({
          id: num(m['id']),
          versao: num(m['versao']),
          nome: String(m['nome']),
          vigenciaInicio: dia(m['vigencia_inicio']),
          vigenciaFim: dia(m['vigencia_fim']),
          ativo: Boolean(num(m['ativo'])),
          objetivos: num(m['objetivos']),
        })),
        iniciativas: iniciativas.map((i) => ({
          id: num(i['id']),
          versao: num(i['versao']),
          codigo: String(i['codigo']),
          titulo: String(i['titulo']),
          situacao: String(i['situacao']),
          prioridade: String(i['prioridade']),
          progresso: num(i['percentual_progresso']),
          inicioPrevisto: dia(i['inicio_previsto']),
          terminoPrevisto: dia(i['termino_previsto']),
          responsavel: String(i['responsavel']),
        })),
        reunioes: reunioes.map((r) => ({
          id: num(r['id']),
          versao: num(r['versao']),
          numero: String(r['numero']),
          titulo: String(r['titulo']),
          situacao: String(r['situacao']),
          inicioPrevisto: instante(r['inicio_previsto_em']),
          competenciaInicio: dia(r['competencia_inicio']),
          competenciaFim: dia(r['competencia_fim']),
        })),
      };
    });
  }

  /** O mapa com os objetivos por perspectiva, os indicadores com a última apuração e o farol de cada objetivo. */
  mapa(c: ContextoEstrategia, mapa: number) {
    return this.ler(c, async (l, est) => {
      const m = await l.uma(
        'SELECT * FROM mapa_estrategico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [mapa, est],
      );
      if (!m) throw naoAchou('Mapa estratégico');
      const objetivos = await l.consultar(
        `SELECT o.id, o.versao, o.codigo, o.titulo, o.descricao, o.ordem_mapa, o.perspectiva_estrategica_id, u.login AS responsavel
           FROM objetivo_estrategico o LEFT JOIN usuario u ON u.id = o.responsavel_usuario_id
          WHERE o.mapa_estrategico_id = ? AND o.excluido_em IS NULL ORDER BY o.ordem_mapa, o.codigo`,
        [mapa],
      );
      const ligados = await l.consultar(
        `SELECT oi.objetivo_estrategico_id, oi.indicador_id, oi.peso, i.codigo, i.nome,
                (SELECT ap.situacao_meta FROM apuracao_indicador ap
                  WHERE ap.indicador_id = oi.indicador_id AND ap.estabelecimento_id = ? AND ap.situacao <> 'cancelada'
                    AND ap.excluido_em IS NULL ORDER BY ap.competencia DESC, ap.id DESC LIMIT 1) AS situacao_meta,
                (SELECT ap.valor FROM apuracao_indicador ap
                  WHERE ap.indicador_id = oi.indicador_id AND ap.estabelecimento_id = ? AND ap.situacao <> 'cancelada'
                    AND ap.excluido_em IS NULL ORDER BY ap.competencia DESC, ap.id DESC LIMIT 1) AS valor,
                (SELECT ap.competencia FROM apuracao_indicador ap
                  WHERE ap.indicador_id = oi.indicador_id AND ap.estabelecimento_id = ? AND ap.situacao <> 'cancelada'
                    AND ap.excluido_em IS NULL ORDER BY ap.competencia DESC, ap.id DESC LIMIT 1) AS competencia
           FROM objetivo_estrategico_indicador oi
           JOIN objetivo_estrategico o ON o.id = oi.objetivo_estrategico_id
           JOIN indicador i ON i.id = oi.indicador_id
          WHERE o.mapa_estrategico_id = ? AND oi.excluido_em IS NULL ORDER BY oi.ordem_exibicao`,
        [est, est, est, mapa],
      );
      const causas = await l.consultar(
        `SELECT r.objetivo_efeito_id, r.objetivo_causa_id FROM objetivo_estrategico_relacao r
           JOIN objetivo_estrategico o ON o.id = r.objetivo_efeito_id
          WHERE o.mapa_estrategico_id = ? AND r.excluido_em IS NULL`,
        [mapa],
      );
      return {
        id: num(m['id']),
        versao: num(m['versao']),
        nome: String(m['nome']),
        descricao: txt(m['descricao']),
        missao: txt(m['missao']),
        visao: txt(m['visao']),
        valores: txt(m['valores']),
        periodicidade: String(m['periodicidade_acompanhamento']),
        vigenciaInicio: dia(m['vigencia_inicio']),
        vigenciaFim: dia(m['vigencia_fim']),
        ativo: Boolean(num(m['ativo'])),
        objetivos: objetivos.map((o) => {
          const ind = ligados
            .filter((x) => num(x['objetivo_estrategico_id']) === num(o['id']))
            .map((x) => ({
              indicador: num(x['indicador_id']),
              codigo: String(x['codigo']),
              nome: String(x['nome']),
              peso: numOuNull(x['peso']),
              situacaoMeta: txt(x['situacao_meta']) as
                'na_meta' | 'fora_da_meta' | 'sem_meta' | 'sem_valor' | null,
              valor: numOuNull(x['valor']),
              competencia: dia(x['competencia']),
            }));
          return {
            id: num(o['id']),
            versao: num(o['versao']),
            perspectiva: num(o['perspectiva_estrategica_id']),
            codigo: String(o['codigo']),
            titulo: String(o['titulo']),
            descricao: txt(o['descricao']),
            responsavel: txt(o['responsavel']),
            ordem: num(o['ordem_mapa']),
            indicadores: ind,
            causas: causas
              .filter((x) => num(x['objetivo_efeito_id']) === num(o['id']))
              .map((x) => num(x['objetivo_causa_id'])),
            desempenho: desempenhoObjetivo(ind),
          };
        }),
      };
    });
  }

  /** A iniciativa com objetivos, participantes, ações e horas (total e por pessoa, com as parcelas). */
  iniciativa(c: ContextoEstrategia, ini: number) {
    return this.ler(c, async (l, est) => {
      const i = await l.uma(
        `SELECT i.*, u.login AS responsavel, p.login AS patrocinador FROM iniciativa_estrategica i
           JOIN usuario u ON u.id = i.responsavel_usuario_id LEFT JOIN usuario p ON p.id = i.patrocinador_usuario_id
          WHERE i.id = ? AND i.estabelecimento_id = ? AND i.excluido_em IS NULL`,
        [ini, est],
      );
      if (!i) throw naoAchou('Iniciativa');
      const objetivos = await l.consultar(
        `SELECT o.id, o.codigo, o.titulo FROM iniciativa_estrategica_objetivo x
           JOIN objetivo_estrategico o ON o.id = x.objetivo_estrategico_id
           JOIN mapa_estrategico m ON m.id = o.mapa_estrategico_id AND m.estabelecimento_id = ?
          WHERE x.iniciativa_estrategica_id = ? AND x.excluido_em IS NULL ORDER BY o.codigo`,
        [est, ini],
      );
      const participantes = await l.consultar(
        `SELECT u.login, x.papel FROM iniciativa_estrategica_participante x JOIN usuario u ON u.id = x.usuario_id
          WHERE x.iniciativa_estrategica_id = ? AND x.excluido_em IS NULL ORDER BY u.login`,
        [ini],
      );
      const acoes = await l.consultar(
        `SELECT a.id, a.versao, a.sequencia, a.titulo, a.descricao, a.situacao, a.prioridade, a.percentual_progresso,
                a.inicio_previsto, a.termino_previsto, a.inicio_real, a.termino_real, a.duracao_prevista_minutos,
                u.login AS responsavel
           FROM iniciativa_estrategica_acao a JOIN usuario u ON u.id = a.responsavel_usuario_id
          WHERE a.iniciativa_estrategica_id = ? AND a.excluido_em IS NULL ORDER BY a.sequencia`,
        [ini],
      );
      const horas = await l.consultar(
        `SELECT h.id, h.iniciativa_estrategica_acao_id, h.data_trabalho, h.duracao_minutos, h.classificacao_hora,
                h.descricao, u.login
           FROM apontamento_hora_iniciativa h JOIN iniciativa_estrategica_acao a ON a.id = h.iniciativa_estrategica_acao_id
           JOIN usuario u ON u.id = h.usuario_id
          WHERE a.iniciativa_estrategica_id = ? AND h.excluido_em IS NULL ORDER BY h.data_trabalho DESC, h.id DESC`,
        [ini],
        { teto: 2000 },
      );
      const apont = horas.map((h) => ({
        id: num(h['id']),
        acao: num(h['iniciativa_estrategica_acao_id']),
        dataTrabalho: dia(h['data_trabalho']),
        minutos: num(h['duracao_minutos']),
        classificacao: String(h['classificacao_hora']),
        descricao: txt(h['descricao']),
        pessoa: String(h['login']),
      }));
      return {
        id: num(i['id']),
        versao: num(i['versao']),
        codigo: String(i['codigo']),
        titulo: String(i['titulo']),
        tipo: String(i['tipo']),
        descricao: txt(i['descricao']),
        prioridade: String(i['prioridade']),
        situacao: String(i['situacao']),
        mapa: numOuNull(i['mapa_estrategico_id']),
        responsavel: String(i['responsavel']),
        patrocinador: txt(i['patrocinador']),
        inicioPrevisto: dia(i['inicio_previsto']),
        terminoPrevisto: dia(i['termino_previsto']),
        inicioReal: dia(i['inicio_real']),
        terminoReal: dia(i['termino_real']),
        progresso: num(i['percentual_progresso']),
        valorOrcamento: numOuNull(i['valor_orcamento']),
        resultados: txt(i['resultados']),
        objetivos: objetivos.map((o) => ({
          id: num(o['id']),
          codigo: String(o['codigo']),
          titulo: String(o['titulo']),
        })),
        participantes: participantes.map((p) => ({ usuario: String(p['login']), papel: String(p['papel']) })),
        acoes: acoes.map((a) => ({
          id: num(a['id']),
          versao: num(a['versao']),
          sequencia: num(a['sequencia']),
          titulo: String(a['titulo']),
          descricao: txt(a['descricao']),
          situacao: String(a['situacao']),
          prioridade: String(a['prioridade']),
          progresso: num(a['percentual_progresso']),
          inicioPrevisto: dia(a['inicio_previsto']),
          terminoPrevisto: dia(a['termino_previsto']),
          inicioReal: dia(a['inicio_real']),
          terminoReal: dia(a['termino_real']),
          duracaoPrevistaMinutos: numOuNull(a['duracao_prevista_minutos']),
          responsavel: String(a['responsavel']),
          minutosApontados: apont.filter((h) => h.acao === num(a['id'])).reduce((s, h) => s + h.minutos, 0),
        })),
        apontamentos: apont,
        horas: totalHoras(apont),
      };
    });
  }

  /** A reunião com participantes, a pauta (análises vinculadas e as do período ainda livres) e as deliberações. */
  reuniao(c: ContextoEstrategia, reu: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT r.*, u.login AS responsavel FROM reuniao_analise_critica r JOIN usuario u ON u.id = r.responsavel_usuario_id
          WHERE r.id = ? AND r.estabelecimento_id = ? AND r.excluido_em IS NULL`,
        [reu, est],
      );
      if (!r) throw naoAchou('Reunião de análise crítica');
      const participantes = await l.consultar(
        `SELECT p.id, p.versao, p.sequencia, p.papel, p.presenca, p.justificativa_ausencia, p.nome_convidado,
                u.login, u.nome
           FROM reuniao_analise_critica_participante p LEFT JOIN usuario u ON u.id = p.usuario_id
          WHERE p.reuniao_analise_critica_id = ? AND p.excluido_em IS NULL ORDER BY p.sequencia`,
        [reu],
      );
      const analises = await l.consultar(
        `SELECT x.id, x.reuniao_analise_critica_id, x.resultado_periodo, x.tendencia, x.situacao, x.analise,
                x.acao_proposta, ap.competencia, ap.valor, i.codigo, i.nome
           FROM analise_critica_indicador x JOIN apuracao_indicador ap ON ap.id = x.apuracao_indicador_id
           JOIN indicador i ON i.id = ap.indicador_id
          WHERE ap.estabelecimento_id = ? AND x.excluido_em IS NULL AND x.situacao <> 'arquivada'
            AND (x.reuniao_analise_critica_id = ?
                 OR (x.reuniao_analise_critica_id IS NULL AND ap.competencia BETWEEN ? AND ?))
          ORDER BY i.nome, ap.competencia`,
        [est, reu, r['competencia_inicio'], r['competencia_fim']],
        { teto: 1000 },
      );
      const delib = await l.consultar(
        `SELECT d.id, d.versao, d.sequencia, d.descricao, d.situacao, d.prazo, d.concluida_em, d.objetivo_estrategico_id,
                d.indicador_id, d.iniciativa_estrategica_id, u.login AS responsavel
           FROM reuniao_analise_critica_deliberacao d LEFT JOIN usuario u ON u.id = d.responsavel_usuario_id
          WHERE d.reuniao_analise_critica_id = ? AND d.excluido_em IS NULL ORDER BY d.sequencia`,
        [reu],
      );
      const an = analises.map((a) => ({
        id: num(a['id']),
        naPauta: numOuNull(a['reuniao_analise_critica_id']) === reu,
        indicador: `${String(a['codigo'])} ${String(a['nome'])}`,
        competencia: dia(a['competencia']),
        valor: numOuNull(a['valor']),
        resultado: String(a['resultado_periodo']),
        tendencia: txt(a['tendencia']),
        situacao: String(a['situacao']),
        analise: String(a['analise']),
        acaoProposta: txt(a['acao_proposta']),
      }));
      return {
        id: num(r['id']),
        versao: num(r['versao']),
        numero: String(r['numero']),
        titulo: String(r['titulo']),
        situacao: String(r['situacao']),
        mapa: numOuNull(r['mapa_estrategico_id']),
        competenciaInicio: dia(r['competencia_inicio']),
        competenciaFim: dia(r['competencia_fim']),
        inicioPrevisto: instante(r['inicio_previsto_em']),
        fimPrevisto: instante(r['fim_previsto_em']),
        realizadaEm: instante(r['realizada_em']),
        local: txt(r['local_reuniao']),
        pauta: txt(r['pauta']),
        ata: txt(r['ata']),
        responsavel: String(r['responsavel']),
        participantes: participantes.map((p) => ({
          id: num(p['id']),
          versao: num(p['versao']),
          usuario: txt(p['login']),
          nome: txt(p['nome']) ?? txt(p['nome_convidado']),
          convidado: txt(p['nome_convidado']),
          papel: String(p['papel']),
          presenca: String(p['presenca']),
          justificativa: txt(p['justificativa_ausencia']),
        })),
        pautaAnalises: an.filter((a) => a.naPauta),
        analisesDisponiveis: an.filter((a) => !a.naPauta),
        deliberacoes: delib.map((d) => ({
          id: num(d['id']),
          versao: num(d['versao']),
          sequencia: num(d['sequencia']),
          descricao: String(d['descricao']),
          situacao: String(d['situacao']),
          prazo: dia(d['prazo']),
          concluidaEm: instante(d['concluida_em']),
          objetivo: numOuNull(d['objetivo_estrategico_id']),
          indicador: numOuNull(d['indicador_id']),
          iniciativa: numOuNull(d['iniciativa_estrategica_id']),
          responsavel: txt(d['responsavel']),
        })),
      };
    });
  }
}
