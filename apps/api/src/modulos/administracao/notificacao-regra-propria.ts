// Notificação por regra no banco próprio (01-ADM L76), pelo Executor (trilha e idempotência na mesma transação).
// Regras no domínio (@sgh/dominio-acesso, notificacao/notificacao-regra.ts); aqui ficam a leitura e a gravação.
//
// - notificacao.regra_alerta: cria ou altera a regra de alerta (regra_alerta), com uma linha de versão a cada
//   gravação (regra_alerta_versao, retrato e motivo) e os destinatários (regra_alerta_destinatario: o que sai da lista
//   fica inativo, nunca apagado). Regra do produto (editavel = falso) só ativa ou desativa. Regra global (sem
//   estabelecimento): conteúdo e situação geral só pela administração da plataforma; o estabelecimento ativa ou
//   desativa só para si (regra_alerta_estabelecimento) e escolhe os próprios destinatários (estabelecimento_id do
//   destinatário), sem tocar nos dos outros estabelecimentos.
// - notificacao.consolidacao: cria ou altera a regra de consolidação (regra_consolidacao_notificacao).
// - notificacao.consolidar: junta os avisos da central (notificacao_usuario) das regras com consolidação num envio
//   por canal e janela (envio_notificacao, com os ids reunidos em avisos_consolidados e um item por aviso em
//   envio_notificacao_aviso, único por canal: o "não reenviar" é busca por índice). Canal interno já entrega;
//   canal externo fora de produção fica "capturado" (nada sai); em produção fica pendente para o despachante.
// - notificacao.envio_situacao: o resultado da entrega por canal (enviado, entregue, falha, nova tentativa,
//   cancelamento), pela transição do domínio.
// - notificacao.envio_responder: a resposta do destinatário (só o dono do envio): ciência (lido) e, se pedir, a
//   resolução dos avisos do envio na central.
import {
  type AvisoPendente,
  CAMPOS_AGRUPAMENTO,
  camposDaChave,
  consolidarAvisos,
  escopoEdicaoRegra,
  EVENTOS_ENVIO,
  type EventoEnvio,
  FORMATOS_CONSOLIDACAO,
  MENSAGEM_NOTIFICACAO,
  medirRespostas,
  type MedicaoCanal,
  type RecusaNotificacao,
  type SituacaoEnvio,
  situacaoInicialEnvio,
  tentativasApos,
  transicaoEnvio,
  validarRegraAlerta,
  validarRegraConsolidacao,
} from '@sgh/dominio-acesso';
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
const bool = (v: unknown): boolean => v === true || Number(v) === 1;
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
const dataDe = (v: unknown): Date | null => (v instanceof Date ? v : v ? new Date(String(v)) : null);
const json = (v: unknown): unknown => (typeof v === 'string' ? JSON.parse(v) : v);
const dia = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  const d = v as Date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const recusar = (r: RecusaNotificacao) => recusa(r, MENSAGEM_NOTIFICACAO[r]);
const TETO = 5000;

const id = z.number().int().positive();
const versao = z.number().int().positive();
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const esquemaRegraAlerta = z
  .object({
    id: id.optional(),
    versao: versao.optional(),
    codigo: z.string().trim().min(1).max(60),
    nome: z.string().trim().max(150),
    cenario: z.string().trim().min(1).max(30),
    descricao: z.string().trim().max(1000).nullable().optional(),
    mensagem: z.string().trim().max(1000),
    gravidade: z.enum(['informativo', 'atencao', 'critico']).default('atencao'),
    bloqueante: z.boolean().default(false),
    exigeJustificativa: z.boolean().default(false),
    sexo: z.enum(['feminino', 'masculino', 'todos']).default('todos'),
    idadeMinima: z.number().int().min(0).max(150).nullable().optional(),
    idadeMaxima: z.number().int().min(0).max(150).nullable().optional(),
    repeticao: z.enum(['uma_vez', 'por_atendimento', 'sempre', 'intervalo']).default('sempre'),
    intervaloMinutos: z.number().int().positive().nullable().optional(),
    notificaTela: z.boolean().default(true),
    notificaEmail: z.boolean().default(false),
    notificaSms: z.boolean().default(false),
    notificaAplicativo: z.boolean().default(false),
    consolidacao: z.string().trim().max(30).nullable().optional(),
    vigenciaInicio: dataIso,
    vigenciaFim: dataIso.nullable().optional(),
    ativo: z.boolean().default(true),
    motivo: z.string().trim().max(500).nullable().optional(),
    destinatarios: z
      .array(
        z.object({ tipo: z.enum(['usuario', 'perfil']), codigo: z.string().trim().min(1).max(60) }).strict(),
      )
      .max(200),
  })
  .strict();
export type EntradaRegraAlerta = z.infer<typeof esquemaRegraAlerta>;

export const esquemaConsolidacao = z
  .object({
    id: id.optional(),
    versao: versao.optional(),
    codigo: z.string().trim().max(30),
    nome: z.string().trim().max(150),
    janelaMinutos: z.number().int(),
    campos: z.array(z.enum(CAMPOS_AGRUPAMENTO)).max(CAMPOS_AGRUPAMENTO.length),
    limitePorUsuario: z.number().int().nullable().optional(),
    periodoLimiteMinutos: z.number().int().nullable().optional(),
    horarioResumo: z.string().max(5).nullable().optional(),
    formato: z.enum(FORMATOS_CONSOLIDACAO).default('lista'),
    ativo: z.boolean().default(true),
  })
  .strict();
export type EntradaConsolidacao = z.infer<typeof esquemaConsolidacao>;

export const esquemaConsolidar = z.object({ canal: z.string().trim().min(1).max(30) }).strict();
export const esquemaSituacaoEnvio = z
  .object({
    envio: id,
    versao,
    evento: z.enum(EVENTOS_ENVIO.filter((e) => e !== 'ler') as [EventoEnvio, ...EventoEnvio[]]),
    erro: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();
export const esquemaResposta = z.object({ envio: id, versao, resolver: z.boolean().default(false) }).strict();

/** O que basta do núcleo (o NucleoProprio cumpre). */
export interface NucleoNotificacao {
  lerSomente<T>(
    contexto: {
      readonly cliente: string;
      readonly correlacao: string;
      readonly estabelecimento?: number | null;
    },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

export interface ContextoNotificacao {
  readonly hospital: string;
  readonly login: string;
  /** Sessão do administrador da plataforma: altera a regra global (conteúdo e situação geral). */
  readonly plataforma?: boolean;
}
export type ContextoGravacaoNotificacao = ContextoNotificacao & {
  readonly correlacao: string;
  readonly chaveIdempotencia: string;
  readonly enderecoIp?: string;
};

export interface RegraAlertaLida {
  readonly id: number;
  readonly versao: number;
  readonly codigo: string;
  readonly nome: string;
  readonly cenario: string;
  readonly mensagem: string;
  readonly gravidade: string;
  readonly repeticao: string;
  readonly ativo: boolean;
  readonly editavel: boolean;
  readonly consolidacao: string | null;
  readonly numeroVersao: number;
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
  readonly notifica: { tela: boolean; email: boolean; sms: boolean; aplicativo: boolean };
  readonly destinatarios: { tipo: string; codigo: string }[];
  // 01-ADM L75: a regra inteira, para a tela regravar o que leu sem trocar por padrão o que não mostrou.
  readonly descricao: string | null;
  readonly bloqueante: boolean;
  readonly exigeJustificativa: boolean;
  readonly sexo: string;
  readonly idadeMinima: number | null;
  readonly idadeMaxima: number | null;
  readonly intervaloMinutos: number | null;
  /** Vale para todos os estabelecimentos do cliente (sem estabelecimento próprio). */
  readonly global: boolean;
  /** Quem lê pode mudar o conteúdo: regra editável e, se global, só a administração da plataforma. */
  readonly conteudoEditavel: boolean;
}
export interface ConsolidacaoLida {
  readonly id: number;
  readonly versao: number;
  readonly codigo: string;
  readonly nome: string;
  readonly janelaMinutos: number;
  readonly campos: string[];
  readonly limitePorUsuario: number | null;
  readonly periodoLimiteMinutos: number | null;
  readonly horarioResumo: string | null;
  readonly formato: string;
  readonly ativo: boolean;
}
export interface EnvioLido {
  readonly id: number;
  readonly versao: number;
  readonly usuario: string;
  readonly canal: string;
  readonly consolidacao: string | null;
  readonly quantidadeAvisos: number;
  readonly avisos: number[];
  readonly situacao: SituacaoEnvio;
  readonly tentativas: number;
  readonly ocorridoEm: string | null;
  readonly enviadoEm: string | null;
  readonly entregueEm: string | null;
  readonly lidoEm: string | null;
  readonly erro: string | null;
}
export interface PainelNotificacao {
  readonly regras: RegraAlertaLida[];
  readonly consolidacoes: ConsolidacaoLida[];
  readonly cenarios: { codigo: string; descricao: string }[];
  readonly canais: { codigo: string; descricao: string; tipo: string; externo: boolean }[];
  /** Perfis de acesso que podem ser destinatários neste estabelecimento (01-ADM L75). */
  readonly perfis: { codigo: string; nome: string }[];
}
export interface HistoricoEnvios {
  readonly envios: EnvioLido[];
  readonly medicao: MedicaoCanal[];
}

/** Coluna de regra_alerta que diz se a regra usa o canal do tipo dado. */
const FLAG_CANAL: Readonly<Record<string, string>> = {
  central: 'notifica_tela',
  painel: 'notifica_tela',
  email: 'notifica_email',
  sms: 'notifica_sms',
  whatsapp: 'notifica_sms',
  push: 'notifica_aplicativo',
};

const SQL_ENVIO = `SELECT en.id, en.versao, u.login, c.codigo AS canal, rc.codigo AS consolidacao, en.quantidade_avisos,
       en.avisos_consolidados, en.situacao, en.tentativas, en.ocorrido_em, en.enviado_em, en.entregue_em, en.lido_em, en.erro
  FROM envio_notificacao en
  JOIN usuario u ON u.id = en.usuario_id
  JOIN canal_notificacao c ON c.id = en.canal_notificacao_id
  LEFT JOIN regra_consolidacao_notificacao rc ON rc.id = en.regra_consolidacao_notificacao_id`;

function envioDaLinha(x: Linha): EnvioLido {
  const avisos = json(x['avisos_consolidados']);
  return {
    id: num(x['id']),
    versao: num(x['versao']),
    usuario: String(x['login']),
    canal: String(x['canal']),
    consolidacao: txt(x['consolidacao']),
    quantidadeAvisos: num(x['quantidade_avisos']),
    avisos: Array.isArray(avisos) ? avisos.map(Number) : [],
    situacao: String(x['situacao']) as SituacaoEnvio,
    tentativas: num(x['tentativas']),
    ocorridoEm: iso(x['ocorrido_em']),
    enviadoEm: iso(x['enviado_em']),
    entregueEm: iso(x['entregue_em']),
    lidoEm: iso(x['lido_em']),
    erro: txt(x['erro']),
  };
}

export class NotificacaoRegraPropria {
  private executorCache: Executor | null = null;
  private get executor(): Executor {
    return (this.executorCache ??= this.nucleo.criarExecutor());
  }

  private readonly opRegra = definirOperacao<EntradaRegraAlerta, { regra: number; numeroVersao: number }>({
    nome: 'notificacao.regra_alerta',
    tabelas: [
      'regra_alerta',
      'regra_alerta_versao',
      'regra_alerta_destinatario',
      'regra_alerta_estabelecimento',
    ],
    entrada: esquemaRegraAlerta as unknown as z.ZodType<EntradaRegraAlerta>,
    gravar: (tx, e, ctx) => this.gravarRegra(tx, e, ctx, false),
    alvo: (_e, r) => ({ tabela: 'regra_alerta', id: r.regra }),
  });

  // Mesma gravação pela administração da plataforma (altera a regra global de todos os estabelecimentos).
  private readonly opRegraPlataforma = definirOperacao<
    EntradaRegraAlerta,
    { regra: number; numeroVersao: number }
  >({
    nome: 'notificacao.regra_alerta_plataforma',
    tabelas: [
      'regra_alerta',
      'regra_alerta_versao',
      'regra_alerta_destinatario',
      'regra_alerta_estabelecimento',
    ],
    entrada: esquemaRegraAlerta as unknown as z.ZodType<EntradaRegraAlerta>,
    gravar: (tx, e, ctx) => this.gravarRegra(tx, e, ctx, true),
    alvo: (_e, r) => ({ tabela: 'regra_alerta', id: r.regra }),
  });

  private readonly opConsolidacao = definirOperacao<EntradaConsolidacao, { consolidacao: number }>({
    nome: 'notificacao.consolidacao',
    tabelas: ['regra_consolidacao_notificacao'],
    entrada: esquemaConsolidacao as unknown as z.ZodType<EntradaConsolidacao>,
    gravar: (tx, e, ctx) => this.gravarConsolidacao(tx, e, ctx),
    alvo: (_e, r) => ({ tabela: 'regra_consolidacao_notificacao', id: r.consolidacao }),
  });

  private readonly opConsolidar = definirOperacao<
    z.infer<typeof esquemaConsolidar>,
    { canal: number; envios: number; avisos: number; aguardando: number; retidos: number }
  >({
    nome: 'notificacao.consolidar',
    tabelas: ['envio_notificacao', 'envio_notificacao_aviso'],
    entrada: esquemaConsolidar,
    gravar: (tx, e, ctx) => this.consolidar(tx, e.canal, ctx),
    alvo: (_e, r) => ({ tabela: 'canal_notificacao', id: r.canal }),
  });

  private readonly opSituacao = definirOperacao<z.infer<typeof esquemaSituacaoEnvio>, { situacao: string }>({
    nome: 'notificacao.envio_situacao',
    tabelas: ['envio_notificacao'],
    entrada: esquemaSituacaoEnvio,
    gravar: (tx, e, ctx) => this.mudarSituacao(tx, e, ctx),
    alvo: (e) => ({ tabela: 'envio_notificacao', id: e.envio }),
  });

  private readonly opResponder = definirOperacao<
    z.infer<typeof esquemaResposta>,
    { situacao: string; avisos: number; resolvidos: number }
  >({
    nome: 'notificacao.envio_responder',
    tabelas: ['envio_notificacao', 'notificacao_usuario'],
    entrada: esquemaResposta,
    gravar: (tx, e, ctx) => this.responder(tx, e, ctx),
    alvo: (e) => ({ tabela: 'envio_notificacao', id: e.envio }),
  });

  constructor(
    private readonly nucleo: NucleoNotificacao,
    private readonly cliente: string,
    private readonly producao: boolean,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  private ler<T>(c: ContextoNotificacao, fn: (l: Leitor, est: number, usuario: number | null) => Promise<T>) {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'administracao.notificacao' },
      async (l) => {
        const q = await this.quem(l, c);
        return fn(l, q.estabelecimento, q.usuario);
      },
    );
  }

  private async quem(l: Leitor, c: ContextoNotificacao) {
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

  private async contexto(c: ContextoGravacaoNotificacao): Promise<ContextoOperacao> {
    const q = await this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'administracao.notificacao' },
      (l) => this.quem(l, c),
    );
    return {
      cliente: this.cliente,
      estabelecimento: q.estabelecimento,
      usuario: q.usuario,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
  }

  // ── Leituras ────────────────────────────────────────────────────────────────────────────────────

  painel(c: ContextoNotificacao): Promise<PainelNotificacao> {
    return this.ler(c, async (l, est) => {
      const rs = await l.consultar(
        `SELECT r.id, r.versao, r.codigo, r.nome, ca.codigo AS cenario, r.mensagem, r.gravidade, r.repeticao,
                (r.ativo AND COALESCE(rae.ativo, TRUE)) AS ativo, r.editavel, rc.codigo AS consolidacao, r.numero_versao_vigente, r.vigencia_inicio, r.vigencia_fim,
                r.notifica_tela, r.notifica_email, r.notifica_sms, r.notifica_aplicativo,
                r.descricao, r.bloqueante, r.exige_justificativa, r.sexo_aplicavel, r.idade_minima_anos, r.idade_maxima_anos,
                r.intervalo_repeticao_minutos, (r.estabelecimento_id IS NULL) AS global
           FROM regra_alerta r JOIN cenario_alerta ca ON ca.id = r.cenario_alerta_id
           LEFT JOIN regra_consolidacao_notificacao rc ON rc.id = r.regra_consolidacao_notificacao_id
           LEFT JOIN regra_alerta_estabelecimento rae ON rae.regra_alerta_id = r.id AND rae.estabelecimento_id = ?
          WHERE r.estabelecimento_id IS NULL OR r.estabelecimento_id = ? ORDER BY r.nome, r.id`,
        [est, est],
        { teto: TETO },
      );
      const ds = rs.length
        ? await l.consultar(
            `SELECT d.regra_alerta_id, d.tipo_destinatario, COALESCE(u.login, p.codigo, CAST(d.destino_id AS CHAR)) AS codigo
               FROM regra_alerta_destinatario d
               LEFT JOIN usuario u ON u.id = d.usuario_id LEFT JOIN perfil_acesso p ON p.id = d.perfil_acesso_id
              WHERE d.regra_alerta_id IN (${rs.map(() => '?').join(', ')}) AND d.ativo AND d.excluido_em IS NULL
                AND (d.estabelecimento_id IS NULL OR d.estabelecimento_id = ?)
              ORDER BY d.regra_alerta_id, d.id`,
            [...rs.map((x) => num(x['id'])), est],
            { teto: TETO },
          )
        : [];
      const cs = await l.consultar(
        `SELECT id, versao, codigo, nome, janela_minutos, chave_agrupamento, limite_por_usuario, periodo_limite_minutos,
                TIME_FORMAT(horario_resumo, '%H:%i') AS horario, formato, ativo
           FROM regra_consolidacao_notificacao WHERE estabelecimento_id IS NULL OR estabelecimento_id = ? ORDER BY nome, id`,
        [est],
        { teto: TETO },
      );
      const cen = await l.consultar(
        'SELECT codigo, descricao FROM cenario_alerta WHERE ativo ORDER BY descricao',
        [],
        { teto: TETO },
      );
      const can = await l.consultar(
        'SELECT codigo, descricao, tipo_canal, externo FROM canal_notificacao WHERE ativo ORDER BY ordem, codigo',
        [],
        { teto: TETO },
      );
      const per = await l.consultar(
        `SELECT codigo, nome FROM perfil_acesso WHERE excluido_em IS NULL
            AND (estabelecimento_id IS NULL OR estabelecimento_id = ?) ORDER BY nome, codigo`,
        [est],
        { teto: TETO },
      );
      return {
        perfis: per.map((x) => ({ codigo: String(x['codigo']), nome: String(x['nome']) })),
        regras: rs.map((x) => ({
          id: num(x['id']),
          versao: num(x['versao']),
          codigo: String(x['codigo']),
          nome: String(x['nome']),
          cenario: String(x['cenario']),
          mensagem: String(x['mensagem']),
          gravidade: String(x['gravidade']),
          repeticao: String(x['repeticao']),
          ativo: bool(x['ativo']),
          editavel: bool(x['editavel']),
          consolidacao: txt(x['consolidacao']),
          numeroVersao: num(x['numero_versao_vigente']),
          vigenciaInicio: dia(x['vigencia_inicio']),
          vigenciaFim: dia(x['vigencia_fim']),
          notifica: {
            tela: bool(x['notifica_tela']),
            email: bool(x['notifica_email']),
            sms: bool(x['notifica_sms']),
            aplicativo: bool(x['notifica_aplicativo']),
          },
          destinatarios: ds
            .filter((d) => num(d['regra_alerta_id']) === num(x['id']))
            .map((d) => ({ tipo: String(d['tipo_destinatario']), codigo: String(d['codigo']) })),
          descricao: txt(x['descricao']),
          bloqueante: bool(x['bloqueante']),
          exigeJustificativa: bool(x['exige_justificativa']),
          sexo: String(x['sexo_aplicavel']),
          idadeMinima: numOuNull(x['idade_minima_anos']),
          idadeMaxima: numOuNull(x['idade_maxima_anos']),
          intervaloMinutos: numOuNull(x['intervalo_repeticao_minutos']),
          global: bool(x['global']),
          conteudoEditavel: bool(x['editavel']) && (!bool(x['global']) || c.plataforma === true),
        })),
        consolidacoes: cs.map((x) => ({
          id: num(x['id']),
          versao: num(x['versao']),
          codigo: String(x['codigo']),
          nome: String(x['nome']),
          janelaMinutos: num(x['janela_minutos']),
          campos: camposDaChave(String(x['chave_agrupamento'])),
          limitePorUsuario: numOuNull(x['limite_por_usuario']),
          periodoLimiteMinutos: numOuNull(x['periodo_limite_minutos']),
          horarioResumo: txt(x['horario']),
          formato: String(x['formato']),
          ativo: bool(x['ativo']),
        })),
        cenarios: cen.map((x) => ({ codigo: String(x['codigo']), descricao: String(x['descricao']) })),
        canais: can.map((x) => ({
          codigo: String(x['codigo']),
          descricao: String(x['descricao']),
          tipo: String(x['tipo_canal']),
          externo: bool(x['externo']),
        })),
      };
    });
  }

  /** Histórico de envio do estabelecimento (os mais recentes) e a medição da resposta por canal (30 dias). */
  historico(
    c: ContextoNotificacao,
    filtro: { canal?: string; situacao?: string } = {},
  ): Promise<HistoricoEnvios> {
    return this.ler(c, async (l, est) => {
      const cond: string[] = ['en.estabelecimento_id = ?'];
      const p: unknown[] = [est];
      if (filtro.canal) {
        cond.push('c.codigo = ?');
        p.push(filtro.canal);
      }
      if (filtro.situacao) {
        cond.push('en.situacao = ?');
        p.push(filtro.situacao);
      }
      const envios = (
        await l.consultar(
          `${SQL_ENVIO} WHERE ${cond.join(' AND ')} ORDER BY en.ocorrido_em DESC, en.id DESC`,
          p,
          {
            teto: 200,
          },
        )
      ).map(envioDaLinha);
      const desde = new Date(this.agora().getTime() - 30 * 24 * 3600_000);
      const medidos = await l.consultar(
        `SELECT c.codigo AS canal, en.situacao, en.quantidade_avisos, en.enviado_em, en.lido_em
           FROM envio_notificacao en JOIN canal_notificacao c ON c.id = en.canal_notificacao_id
          WHERE en.estabelecimento_id = ? AND en.ocorrido_em >= ?`,
        [est, desde],
        { teto: TETO },
      );
      return {
        envios,
        medicao: medirRespostas(
          medidos.map((x) => ({
            canal: String(x['canal']),
            situacao: String(x['situacao']) as SituacaoEnvio,
            quantidadeAvisos: num(x['quantidade_avisos']),
            enviadoEm: dataDe(x['enviado_em']),
            lidoEm: dataDe(x['lido_em']),
          })),
        ),
      };
    });
  }

  /** Os envios da própria conta (para a resposta), mais recentes primeiro. */
  meusEnvios(c: ContextoNotificacao): Promise<EnvioLido[]> {
    return this.ler(c, async (l, est, usuario) => {
      if (usuario === null) return [];
      return (
        await l.consultar(
          `${SQL_ENVIO} WHERE en.estabelecimento_id = ? AND en.usuario_id = ? ORDER BY en.ocorrido_em DESC, en.id DESC`,
          [est, usuario],
          { teto: 200 },
        )
      ).map(envioDaLinha);
    });
  }

  // ── Gravações ───────────────────────────────────────────────────────────────────────────────────

  private async exec<E, S extends Record<string, unknown>>(
    op: Parameters<Executor['executar']>[0],
    c: ContextoGravacaoNotificacao,
    entrada: E,
  ): Promise<{ resultado: S; repetida: boolean }> {
    const ctx = await this.contexto(c);
    const r = await this.executor.executar(op, this.cliente, entrada, ctx);
    return { resultado: r.resultado as unknown as S, repetida: r.repetida };
  }

  gravarRegraAlerta(c: ContextoGravacaoNotificacao, entrada: unknown) {
    return this.exec<unknown, { regra: number; numeroVersao: number }>(
      (c.plataforma ? this.opRegraPlataforma : this.opRegra) as never,
      c,
      entrada,
    );
  }
  gravarRegraConsolidacao(c: ContextoGravacaoNotificacao, entrada: unknown) {
    return this.exec<unknown, { consolidacao: number }>(this.opConsolidacao as never, c, entrada);
  }
  consolidarAgora(c: ContextoGravacaoNotificacao, entrada: unknown) {
    return this.exec<unknown, { envios: number; avisos: number; aguardando: number; retidos: number }>(
      this.opConsolidar as never,
      c,
      entrada,
    );
  }
  registrarSituacao(c: ContextoGravacaoNotificacao, entrada: unknown) {
    return this.exec<unknown, { situacao: string }>(this.opSituacao as never, c, entrada);
  }
  responderEnvio(c: ContextoGravacaoNotificacao, entrada: unknown) {
    return this.exec<unknown, { situacao: string; avisos: number; resolvidos: number }>(
      this.opResponder as never,
      c,
      entrada,
    );
  }

  private async gravarRegra(
    tx: TxOperacao,
    e: EntradaRegraAlerta,
    ctx: ContextoOperacao,
    plataforma: boolean,
  ) {
    const est = ctx.estabelecimento;
    const cen = await tx.uma('SELECT id FROM cenario_alerta WHERE codigo = ? AND ativo', [e.cenario]);
    if (!cen) throw recusa('cenario-inexistente', 'Cenário de alerta inexistente ou inativo.');
    let consolidacao: number | null = null;
    if (e.consolidacao) {
      const rc = await tx.uma(
        `SELECT id FROM regra_consolidacao_notificacao WHERE codigo = ? AND ativo
            AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)`,
        [e.consolidacao, est],
      );
      if (!rc) throw recusa('consolidacao-inexistente', 'Regra de consolidação inexistente ou inativa.');
      consolidacao = num(rc['id']);
    }
    const desejados: { tipo: 'usuario' | 'perfil'; destino: number }[] = [];
    for (const d of e.destinatarios) {
      const x =
        d.tipo === 'usuario'
          ? await tx.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [d.codigo])
          : await tx.uma(
              `SELECT id FROM perfil_acesso WHERE codigo = ? AND excluido_em IS NULL
                  AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)`,
              [d.codigo, est],
            );
      if (!x) throw recusa('destinatario-inexistente', `Destinatário inexistente: ${d.tipo}.`);
      if (!desejados.some((y) => y.tipo === d.tipo && y.destino === num(x['id'])))
        desejados.push({ tipo: d.tipo, destino: num(x['id']) });
    }
    const v = validarRegraAlerta({
      codigo: e.codigo,
      nome: e.nome,
      mensagem: e.mensagem,
      idadeMinima: e.idadeMinima ?? null,
      idadeMaxima: e.idadeMaxima ?? null,
      vigenciaInicio: e.vigenciaInicio,
      vigenciaFim: e.vigenciaFim ?? null,
      repeticao: e.repeticao,
      intervaloMinutos: e.intervaloMinutos ?? null,
      ativo: e.ativo,
      destinatarios: desejados.length,
    });
    if (v) throw recusar(v);
    const conteudo = {
      codigo: e.codigo,
      nome: e.nome,
      cenario_alerta_id: num(cen['id']),
      descricao: e.descricao ?? null,
      mensagem: e.mensagem,
      gravidade: e.gravidade,
      bloqueante: e.bloqueante,
      exige_justificativa: e.exigeJustificativa,
      sexo_aplicavel: e.sexo,
      idade_minima_anos: e.idadeMinima ?? null,
      idade_maxima_anos: e.idadeMaxima ?? null,
      repeticao: e.repeticao,
      intervalo_repeticao_minutos: e.repeticao === 'intervalo' ? (e.intervaloMinutos ?? null) : null,
      notifica_tela: e.notificaTela,
      notifica_email: e.notificaEmail,
      notifica_sms: e.notificaSms,
      notifica_aplicativo: e.notificaAplicativo,
      regra_consolidacao_notificacao_id: consolidacao,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim ?? null,
    };
    let regra: number;
    let numeroVersao: number;
    if (e.id) {
      if (!e.versao) throw recusa('versao-obrigatoria', 'Informe a versão lida da regra.');
      const [atual] = await tx.consultarParaAtualizar(
        `SELECT * FROM regra_alerta WHERE id = ? AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)`,
        [e.id, est],
        { teto: 1 },
      );
      if (!atual) throw recusa('regra-inexistente', 'Regra de alerta não encontrada.');
      const mudou = Object.entries(conteudo).some(([k, val]) => {
        const a = atual[k];
        if (k.startsWith('vigencia')) return dia(a) !== val;
        if (typeof val === 'boolean') return bool(a) !== val;
        if (typeof val === 'number') return numOuNull(a) !== val;
        return (a === null || a === undefined ? null : String(a)) !== val;
      });
      const global = atual['estabelecimento_id'] === null || atual['estabelecimento_id'] === undefined;
      const escopo = escopoEdicaoRegra({
        global,
        plataforma,
        editavel: bool(atual['editavel']),
        mudouConteudo: mudou,
      });
      if ('recusa' in escopo) throw recusar(escopo.recusa);
      regra = e.id;
      if (escopo.modo === 'estabelecimento') {
        // Regra global vista de um estabelecimento: só o registro dele (situação e destinatários).
        numeroVersao = num(atual['numero_versao_vigente']);
        const [proprio] = await tx.consultarParaAtualizar(
          'SELECT id, versao, ativo FROM regra_alerta_estabelecimento WHERE regra_alerta_id = ? AND estabelecimento_id = ?',
          [regra, est],
          { teto: 1 },
        );
        if (proprio) {
          if (bool(proprio['ativo']) !== e.ativo)
            await tx.alterar('regra_alerta_estabelecimento', num(proprio['id']), num(proprio['versao']), {
              ativo: e.ativo,
            });
        } else
          await tx.incluir('regra_alerta_estabelecimento', {
            regra_alerta_id: regra,
            estabelecimento_id: est,
            ativo: e.ativo,
          });
        await this.reconciliarDestinatarios(tx, regra, est, desejados);
        return { regra, numeroVersao };
      }
      numeroVersao = num(atual['numero_versao_vigente']) + 1;
      const valores = bool(atual['editavel'])
        ? { ...conteudo, ativo: e.ativo, numero_versao_vigente: numeroVersao }
        : { ativo: e.ativo, numero_versao_vigente: numeroVersao };
      await tx.alterar('regra_alerta', regra, e.versao, valores);
      await this.gravarVersaoRegra(
        tx,
        regra,
        numeroVersao,
        { ...conteudo, ativo: e.ativo },
        desejados,
        e,
        ctx,
      );
      await this.reconciliarDestinatarios(tx, regra, global ? null : est, desejados);
      return { regra, numeroVersao };
    } else {
      const dup = await tx.uma('SELECT id FROM regra_alerta WHERE codigo = ?', [e.codigo]);
      if (dup) throw recusa('codigo-duplicado', 'Já existe regra de alerta com este código.');
      numeroVersao = 1;
      regra = await tx.incluir('regra_alerta', {
        ...conteudo,
        estabelecimento_id: est,
        ativo: e.ativo,
        editavel: true,
        numero_versao_vigente: 1,
      });
    }
    await this.gravarVersaoRegra(tx, regra, numeroVersao, { ...conteudo, ativo: e.ativo }, desejados, e, ctx);
    await this.reconciliarDestinatarios(tx, regra, est, desejados);
    return { regra, numeroVersao };
  }

  private async gravarVersaoRegra(
    tx: TxOperacao,
    regra: number,
    numeroVersao: number,
    dados: Record<string, unknown>,
    desejados: readonly { tipo: string; destino: number }[],
    e: EntradaRegraAlerta,
    ctx: ContextoOperacao,
  ) {
    const agora = this.agora();
    await tx.incluir('regra_alerta_versao', {
      regra_alerta_id: regra,
      operacao: numeroVersao === 1 ? 'inclusao' : 'alteracao',
      dados: JSON.stringify({ ...dados, destinatarios: desejados }),
      ocorrido_em: agora,
      usuario_id: ctx.usuario,
      numero_versao: numeroVersao,
      vigente_desde: agora,
      motivo_alteracao: e.motivo ?? null,
    });
  }

  /**
   * Destinatários do escopo (o estabelecimento, ou nulo = todos, pela plataforma): novos entram, os que saem ficam
   * inativos (nunca apagados), os que voltam são reativados. Os de outro escopo não são tocados.
   */
  private async reconciliarDestinatarios(
    tx: TxOperacao,
    regra: number,
    escopo: number | null,
    todosDesejados: readonly { tipo: 'usuario' | 'perfil'; destino: number }[],
  ) {
    // No escopo do estabelecimento, quem já recebe pela escolha da plataforma (escopo nulo) não é duplicado.
    const globais =
      escopo === null
        ? []
        : await tx.consultar(
            `SELECT tipo_destinatario, destino_id FROM regra_alerta_destinatario
              WHERE regra_alerta_id = ? AND estabelecimento_id IS NULL AND ativo AND excluido_em IS NULL`,
            [regra],
            { teto: TETO },
          );
    const desejados = todosDesejados.filter(
      (d) => !globais.some((g) => g['tipo_destinatario'] === d.tipo && num(g['destino_id']) === d.destino),
    );
    const existentes = await tx.consultarParaAtualizar(
      `SELECT id, versao, tipo_destinatario, destino_id, ativo FROM regra_alerta_destinatario
        WHERE regra_alerta_id = ? AND estabelecimento_id <=> ? AND excluido_em IS NULL
          AND tipo_destinatario IN ('usuario','perfil')`,
      [regra, escopo],
      { teto: TETO },
    );
    for (const x of existentes) {
      const quer = desejados.some(
        (d) => d.tipo === x['tipo_destinatario'] && d.destino === num(x['destino_id']),
      );
      if (quer !== bool(x['ativo']))
        await tx.alterar('regra_alerta_destinatario', num(x['id']), num(x['versao']), { ativo: quer });
    }
    for (const d of desejados) {
      if (existentes.some((x) => x['tipo_destinatario'] === d.tipo && num(x['destino_id']) === d.destino))
        continue;
      await tx.incluir('regra_alerta_destinatario', {
        regra_alerta_id: regra,
        estabelecimento_id: escopo,
        tipo_destinatario: d.tipo,
        ...(d.tipo === 'usuario' ? { usuario_id: d.destino } : { perfil_acesso_id: d.destino }),
        ativo: true,
      });
    }
  }

  private async gravarConsolidacao(tx: TxOperacao, e: EntradaConsolidacao, ctx: ContextoOperacao) {
    const v = validarRegraConsolidacao({
      codigo: e.codigo,
      nome: e.nome,
      janelaMinutos: e.janelaMinutos,
      campos: e.campos,
      limitePorUsuario: e.limitePorUsuario ?? null,
      periodoLimiteMinutos: e.periodoLimiteMinutos ?? null,
      horarioResumo: e.horarioResumo ?? null,
      formato: e.formato,
    });
    if (v) throw recusar(v);
    const valores = {
      codigo: e.codigo,
      nome: e.nome,
      janela_minutos: e.janelaMinutos,
      chave_agrupamento: e.campos.join(','),
      limite_por_usuario: e.limitePorUsuario ?? null,
      periodo_limite_minutos: e.limitePorUsuario ? (e.periodoLimiteMinutos ?? null) : null,
      horario_resumo: e.horarioResumo ? `${e.horarioResumo}:00` : null,
      formato: e.formato,
      ativo: e.ativo,
    };
    if (e.id) {
      if (!e.versao) throw recusa('versao-obrigatoria', 'Informe a versão lida da regra de consolidação.');
      const x = await tx.uma(
        'SELECT id FROM regra_consolidacao_notificacao WHERE id = ? AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)',
        [e.id, ctx.estabelecimento],
      );
      if (!x) throw recusa('consolidacao-inexistente', 'Regra de consolidação não encontrada.');
      await tx.alterar('regra_consolidacao_notificacao', e.id, e.versao, valores);
      return { consolidacao: e.id };
    }
    const dup = await tx.uma('SELECT id FROM regra_consolidacao_notificacao WHERE codigo = ?', [e.codigo]);
    if (dup) throw recusa('codigo-duplicado', 'Já existe regra de consolidação com este código.');
    return {
      consolidacao: await tx.incluir('regra_consolidacao_notificacao', {
        ...valores,
        estabelecimento_id: ctx.estabelecimento,
      }),
    };
  }

  private async consolidar(tx: TxOperacao, codigoCanal: string, ctx: ContextoOperacao) {
    const est = ctx.estabelecimento;
    const canal = await tx.uma(
      'SELECT id, tipo_canal, externo, ativo FROM canal_notificacao WHERE codigo = ?',
      [codigoCanal],
    );
    if (!canal || !bool(canal['ativo']))
      throw recusa('canal-inexistente', 'Canal de notificação inexistente ou inativo.');
    const canalId = num(canal['id']);
    const flag = FLAG_CANAL[String(canal['tipo_canal'])] ?? 'notifica_tela';
    const agora = this.agora();
    const regras = await tx.consultar(
      `SELECT r.id AS regra, rc.id AS rc, rc.janela_minutos, rc.chave_agrupamento, rc.limite_por_usuario,
              rc.periodo_limite_minutos, TIME_FORMAT(rc.horario_resumo, '%H:%i') AS horario
         FROM regra_alerta r JOIN regra_consolidacao_notificacao rc ON rc.id = r.regra_consolidacao_notificacao_id
         LEFT JOIN regra_alerta_estabelecimento rae ON rae.regra_alerta_id = r.id AND rae.estabelecimento_id = ?
        WHERE r.ativo AND COALESCE(rae.ativo, TRUE) AND rc.ativo AND r.${flag}
          AND (r.estabelecimento_id IS NULL OR r.estabelecimento_id = ?)
          AND (rc.estabelecimento_id IS NULL OR rc.estabelecimento_id = ?)
        ORDER BY rc.id, r.id`,
      [est, est, est],
      { teto: TETO },
    );
    const porConsolidacao = new Map<number, { linha: Linha; regras: number[] }>();
    for (const x of regras) {
      const k = num(x['rc']);
      const g = porConsolidacao.get(k);
      if (g) g.regras.push(num(x['regra']));
      else porConsolidacao.set(k, { linha: x, regras: [num(x['regra'])] });
    }
    const situacao = situacaoInicialEnvio(bool(canal['externo']), this.producao);
    const ids: number[] = [];
    let avisosEnviados = 0;
    let aguardando = 0;
    let retidos = 0;
    for (const [rcId, { linha, regras: rs }] of porConsolidacao) {
      const avisos = await tx.consultar(
        `SELECT n.id, n.usuario_id, n.regra_alerta_id, n.paciente_id, n.atendimento_id, n.entidade, n.entidade_id,
                n.chave_agrupamento, n.gerada_em
           FROM notificacao_usuario n
          WHERE n.estabelecimento_id = ? AND n.regra_alerta_id IN (${rs.map(() => '?').join(', ')})
            AND n.excluido_em IS NULL AND n.resolvida = FALSE
            AND NOT EXISTS (SELECT 1 FROM envio_notificacao_aviso ea
                  WHERE ea.canal_notificacao_id = ? AND ea.notificacao_usuario_id = n.id)
          ORDER BY n.gerada_em, n.id`,
        [est, ...rs, canalId],
        { teto: TETO },
      );
      const limite = numOuNull(linha['limite_por_usuario']);
      const recentes = new Map<number, number>();
      if (limite !== null) {
        const desde = new Date(agora.getTime() - num(linha['periodo_limite_minutos']) * 60_000);
        for (const x of await tx.consultar(
          `SELECT usuario_id, COUNT(*) AS n FROM envio_notificacao
            WHERE estabelecimento_id = ? AND canal_notificacao_id = ? AND regra_consolidacao_notificacao_id = ?
              AND ocorrido_em >= ?
            GROUP BY usuario_id`,
          [est, canalId, rcId, desde],
          { teto: TETO },
        ))
          recentes.set(num(x['usuario_id']), num(x['n']));
      }
      const r = consolidarAvisos(
        avisos.map((x): AvisoPendente => ({
          id: num(x['id']),
          usuario: num(x['usuario_id']),
          regra: numOuNull(x['regra_alerta_id']),
          paciente: numOuNull(x['paciente_id']),
          atendimento: numOuNull(x['atendimento_id']),
          entidade: txt(x['entidade']),
          entidadeId: numOuNull(x['entidade_id']),
          assunto: txt(x['chave_agrupamento']),
          geradoEm: dataDe(x['gerada_em'])!,
        })),
        {
          janelaMinutos: num(linha['janela_minutos']),
          campos: camposDaChave(String(linha['chave_agrupamento'])),
          limitePorUsuario: limite,
          horarioResumo: txt(linha['horario']),
        },
        agora,
        recentes,
      );
      aguardando += r.aguardando.length;
      retidos += r.retidos.length;
      for (const e of r.envios) {
        avisosEnviados += e.avisos.length;
        const envio = await tx.incluir('envio_notificacao', {
          estabelecimento_id: est,
          usuario_id: e.usuario,
          canal_notificacao_id: canalId,
          notificacao_usuario_id: e.avisos.length === 1 ? e.avisos[0] : null,
          regra_consolidacao_notificacao_id: rcId,
          quantidade_avisos: e.avisos.length,
          avisos_consolidados: JSON.stringify(e.avisos),
          situacao,
          tentativas: situacao === 'pendente' ? 0 : 1,
          enviado_em: situacao === 'pendente' ? null : agora,
          entregue_em: situacao === 'entregue' ? agora : null,
          ocorrido_em: agora,
        });
        for (const aviso of e.avisos)
          await tx.incluir('envio_notificacao_aviso', {
            envio_notificacao_id: envio,
            notificacao_usuario_id: aviso,
            canal_notificacao_id: canalId,
          });
        ids.push(envio);
      }
    }
    return { canal: canalId, envios: ids.length, avisos: avisosEnviados, aguardando, retidos };
  }

  private async envioTravado(tx: TxOperacao, envio: number, est: number | null) {
    const [x] = await tx.consultarParaAtualizar(
      'SELECT id, versao, usuario_id, situacao, tentativas, avisos_consolidados FROM envio_notificacao WHERE id = ? AND estabelecimento_id = ?',
      [envio, est],
      { teto: 1 },
    );
    if (!x) throw recusa('envio-inexistente', 'Envio de notificação não encontrado.');
    return x;
  }

  private async mudarSituacao(
    tx: TxOperacao,
    e: z.infer<typeof esquemaSituacaoEnvio>,
    ctx: ContextoOperacao,
  ) {
    const x = await this.envioTravado(tx, e.envio, ctx.estabelecimento);
    const t = transicaoEnvio(String(x['situacao']) as SituacaoEnvio, e.evento, num(x['tentativas']));
    if ('recusa' in t) throw recusar(t.recusa);
    const agora = this.agora();
    const valores: Record<string, unknown> = { situacao: t.nova };
    const tentativas = tentativasApos(String(x['situacao']) as SituacaoEnvio, e.evento, num(x['tentativas']));
    if (tentativas !== num(x['tentativas'])) valores['tentativas'] = tentativas;
    if (e.evento === 'enviar' || e.evento === 'capturar') valores['enviado_em'] = agora;
    if (e.evento === 'entregar') valores['entregue_em'] = agora;
    if (e.evento === 'falhar') valores['erro'] = e.erro ?? 'Falha na entrega sem detalhe.';
    await tx.alterar('envio_notificacao', e.envio, e.versao, valores);
    return { situacao: t.nova };
  }

  private async responder(tx: TxOperacao, e: z.infer<typeof esquemaResposta>, ctx: ContextoOperacao) {
    const x = await this.envioTravado(tx, e.envio, ctx.estabelecimento);
    if (ctx.usuario === null || num(x['usuario_id']) !== ctx.usuario)
      throw recusa('envio-de-outra-conta', 'Só o destinatário responde ao próprio envio.');
    const t = transicaoEnvio(String(x['situacao']) as SituacaoEnvio, 'ler', num(x['tentativas']));
    if ('recusa' in t) throw recusar(t.recusa);
    const agora = this.agora();
    await tx.alterar('envio_notificacao', e.envio, e.versao, { situacao: t.nova, lido_em: agora });
    const lista = json(x['avisos_consolidados']);
    const avisos = Array.isArray(lista) ? lista.map(Number) : [];
    let resolvidos = 0;
    if (avisos.length) {
      const ns = await tx.consultarParaAtualizar(
        `SELECT id, versao, lida, resolvida FROM notificacao_usuario
          WHERE id IN (${avisos.map(() => '?').join(', ')}) AND usuario_id = ? AND excluido_em IS NULL`,
        [...avisos, ctx.usuario],
        { teto: TETO },
      );
      for (const n of ns) {
        const v: Record<string, unknown> = {};
        if (!bool(n['lida'])) Object.assign(v, { lida: true, lida_em: agora });
        if (e.resolver && !bool(n['resolvida'])) {
          Object.assign(v, { resolvida: true, resolvida_em: agora, resolvida_por_usuario_id: ctx.usuario });
          resolvidos++;
        }
        if (Object.keys(v).length) await tx.alterar('notificacao_usuario', num(n['id']), num(n['versao']), v);
      }
    }
    return { situacao: t.nova, avisos: avisos.length, resolvidos };
  }
}
