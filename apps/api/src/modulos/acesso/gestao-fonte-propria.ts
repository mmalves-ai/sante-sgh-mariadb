// Fonte PRÓPRIA da gestão de acessos (F2.2, lote 02-02): o banco do cliente pelo @sgh/nucleo. Leituras em transação
// somente leitura, sempre no estabelecimento da sessão (vínculo vigente em usuario_estabelecimento) e sem registros
// excluídos; gravações pelo Executor (trilha, outbox e idempotência na mesma transação), com a linha travada (FOR UPDATE)
// e a versão conferida (trava otimista) antes de mudar.
// Tabelas: usuario, usuario_estabelecimento, usuario_perfil, perfil_acesso, papel_seguranca, usuario_papel_seguranca,
// usuario_situacao_historico, estabelecimento.
// Melhoria: a concessão de perfil é usuario_perfil com vigência e estabelecimento; a revogação encerra a vigência e marca a
// exclusão lógica (quem e quando), com o motivo na trilha; concessão sobreposta do mesmo perfil é recusada
// (perfil-ja-concedido) e a revogada no mesmo início é reaberta (a chave única cobre as revogadas).
// Melhoria: a entrada real de cada gravação passa pelo Executor (esquema e hash da idempotência: a mesma chave com outra
// entrada é recusada); toda recusa lança erro (sem trilha nem idempotência); o estado anterior vai à trilha (dados.antes).
// Melhoria: o bloqueio da conta grava a situação e a linha do tempo (usuario_situacao_historico) na mesma transação.
// Melhoria: papéis de segurança com vigência (usuario_papel_seguranca): retirar encerra, reativar abre vigência nova.
// Melhoria: só as contas com vínculo vigente no estabelecimento da sessão aparecem e podem ser alteradas.
// Sem grupos no modelo próprio (o perfil é a unidade de concessão): grupos, mapa grupo → perfil e decisões do mapa não
// existem no banco; as leituras devolvem a lista vazia e as gravações são recusadas com o motivo (SEM_GRUPOS).
// Pendências (pedidos em docs/obra/fatias/f22/saida/02-02.json; respondem "modelo-pendente" ou "adaptador-pendente",
// nada é gravado): versões da política de senha com vigência futura, limites de sessão por perfil, exceções das contas
// dormentes, conferência do conselho, RH (cargo → perfil e resoluções), alterações da concessão, motivo da revogação,
// descrição do perfil por versão; pedidos de acesso e campanhas de recertificação (tabelas existem, adaptador a escrever).
import { randomUUID } from 'node:crypto';
import {
  type ContextoOperacao,
  definirOperacao,
  erroConflitoVersao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type Linha,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { esquemaLogin } from '@sgh/contratos';
import { type ZodType, z } from 'zod';
import type { EstadoReceita, FonteGestao } from './gestao-fonte.js';
import {
  CODIGOS_PAPEL,
  type ContextoGestao,
  type ConcessaoPerfilNova,
  ehOperacaoConta,
  NOMES_PAPEL,
  OPERACOES_CONTA,
  type OperacaoConta,
  PERFIL_GESTOR_ACESSOS,
  type PerfilConcedidoLido,
  SEM_GRUPOS,
  type TrilhaGestao,
  type UsuarioGestao,
} from './gestao-tipos.js';

/** O que a fonte usa do NucleoProprio (os testes trocam). */
export interface NucleoGestao {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string; readonly estabelecimento?: number | null },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

const num = (v: unknown): number => Number(v);
const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const txtOuNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown): boolean => v === true || Number(v) === 1;
const data = (v: unknown): Date | null => (v instanceof Date ? v : v ? new Date(String(v)) : null);
const dia = (d: Date): string => d.toISOString().slice(0, 10);
const PAPEL_DO_CODIGO = new Map(Object.entries(CODIGOS_PAPEL).map(([n, c]) => [c, Number(n)]));
const TETO = 5_000;

/** A pendência do modelo: nada é lido nem gravado, e o motivo diz a tabela que falta. */
export function modeloPendenteGestao(recurso: string, tabela: string): Promise<never> {
  return Promise.reject(new ErroOperacao(
    409,
    'modelo-pendente',
    `${recurso} indisponível`,
    `${recurso} aguarda a tabela ${tabela} no modelo do banco (pedido de DDL registrado): nada foi lido nem gravado.`,
  ));
}

/** As tabelas existem, mas o adaptador próprio ainda não foi escrito: recusa explícita, nunca lista vazia. */
export function adaptadorPendenteGestao(recurso: string): Promise<never> {
  return Promise.reject(new ErroOperacao(
    409,
    'adaptador-pendente',
    `${recurso} indisponível`,
    `${recurso} ainda não grava no banco próprio deste servidor: nada foi lido nem gravado.`,
  ));
}

const semGrupos = (): never => {
  throw recusa('sem-grupos', SEM_GRUPOS);
};

/** Vínculo vigente do usuário (alias u) com o estabelecimento (parâmetro). */
const VINCULO = `EXISTS (SELECT 1 FROM usuario_estabelecimento ue WHERE ue.usuario_id = u.id AND ue.estabelecimento_id = ?
  AND ue.excluido_em IS NULL AND ue.vigencia_inicio <= CURDATE() AND (ue.vigencia_fim IS NULL OR ue.vigencia_fim >= CURDATE()))`;
const PERFIL_VIGENTE = `up.excluido_em IS NULL AND up.vigencia_inicio <= CURDATE() AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= CURDATE())`;
const PAPEL_VIGENTE = `ups.excluido_em IS NULL AND ups.vigencia_inicio <= CURDATE() AND (ups.vigencia_fim IS NULL OR ups.vigencia_fim >= CURDATE())`;

function usuarioDaLinha(x: Linha): UsuarioGestao {
  const situacao = txt(x['situacao']);
  return {
    login: txt(x['login']),
    nome: txt(x['nome']),
    grupo: null,
    ativo: situacao !== 'inativo',
    bloqueado: situacao === 'bloqueado',
    id: num(x['id']),
  };
}

// As entradas das gravações de perfil (planas, datas como dia ISO): vão ao Executor, que valida e calcula o hash da
// idempotência sobre elas.
const DIA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const fimDepoisDoInicio = (p: { inicio: string | null; fim: string | null }) => !p.fim || !p.inicio || p.fim >= p.inicio;
const ESQUEMA_CONCESSAO = z
  .object({
    login: esquemaLogin,
    perfil: z.string().trim().min(1).max(60),
    inicio: DIA.nullable(),
    fim: DIA.nullable(),
    motivo: z.string().trim().min(1).max(500),
    areaAprovou: z.string().trim().min(1).max(40),
  })
  .strict()
  .refine(fimDepoisDoInicio, { path: ['fim'] });
const ESQUEMA_REVOGACAO = z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(1).max(500) }).strict();
const ESQUEMA_ALTERACAO = z
  .object({
    id: z.number().int().positive(),
    inicio: DIA,
    fim: DIA.nullable(),
    motivo: z.string().trim().min(1).max(500),
    justificativa: z.string().trim().min(1).max(500),
    por: esquemaLogin,
    versao: z.number().int().positive().optional(),
  })
  .strict()
  .refine(fimDepoisDoInicio, { path: ['fim'] });

/** O estado anterior da concessão, para a trilha (dados.antes). */
function estadoConcessao(x: Linha, revogada: boolean): Readonly<Record<string, unknown>> {
  const fim = data(x['vigencia_fim']);
  return {
    vigenciaInicio: dia(data(x['vigencia_inicio']) as Date),
    vigenciaFim: fim ? dia(fim) : null,
    motivo: txtOuNull(x['motivo']),
    versao: num(x['versao']),
    ...(revogada ? { revogada: true } : {}),
  };
}


class FonteGestaoPropria implements FonteGestao {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoGestao,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private async estabelecimento(l: Leitor, hospital: string): Promise<number> {
    const r = await l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [hospital]);
    if (!r) throw recusa('sem-estabelecimento', 'O estabelecimento da sessão não existe neste banco.');
    return num(r['id']);
  }

  private ler<T>(hospital: string, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'acesso-gestao' }, async (l) =>
      fn(l, await this.estabelecimento(l, hospital)),
    );
  }

  /**
   * Uma gravação pelo Executor: estabelecimento e operador resolvidos antes. A ENTRADA real da operação (login, papel,
   * concessão) passa pelo esquema e pelo hash da idempotência do núcleo: a mesma chave com outra entrada é recusada
   * (idempotencia-divergente). A função grava na transação e devolve o resultado (plano, guardado na idempotência) e o
   * estado anterior lido sob trava, que vai à trilha (dados.antes). Toda recusa LANÇA erro: a transação é desfeita,
   * sem trilha nem registro de idempotência.
   */
  private async gravar<E, R extends ResultadoOperacao & { readonly id: number }>(
    def: {
      readonly nome: string;
      readonly tabelas: readonly string[];
      readonly esquema: ZodType<E>;
      readonly alvo: string;
      readonly motivo?: (e: E) => string | null;
      readonly dados?: (e: E) => Readonly<Record<string, unknown>>;
    },
    hospital: string,
    quem: { readonly usuario: string; readonly correlacao: string; readonly chave?: string; readonly reautenticadoEm?: number },
    entrada: unknown,
    fn: (tx: TxOperacao, e: E, est: number, operador: number) => Promise<{ resultado: R; antes?: Readonly<Record<string, unknown>> }>,
  ): Promise<R> {
    const [est, operador] = await this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'acesso-gestao' },
      async (l) => {
        const e = await this.estabelecimento(l, hospital);
        const u = await l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [quem.usuario]);
        if (!u) throw recusa('operador-desconhecido', 'O usuário da sessão não existe neste banco.');
        return [e, num(u['id'])] as const;
      },
    );
    let antes: Readonly<Record<string, unknown>> | undefined;
    const op = definirOperacao<E, R>({
      nome: def.nome,
      tabelas: def.tabelas,
      entrada: def.esquema,
      async gravar(tx, e) {
        const saida = await fn(tx, e, est, operador);
        antes = saida.antes;
        return saida.resultado;
      },
      alvo: (_e, r) => ({ tabela: def.alvo, id: r.id }),
      trilha: (e) => ({
        motivo: def.motivo?.(e) ?? null,
        dados: { ...(def.dados?.(e) ?? {}), ...(antes ? { antes } : {}) },
      }),
    });
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: est,
      usuario: operador,
      correlacao: quem.correlacao.slice(0, 64) || 'acesso-gestao',
      chaveIdempotencia: quem.chave ?? `acesso-gestao:${randomUUID()}`,
      ...(quem.reautenticadoEm !== undefined ? { reautenticadoEm: quem.reautenticadoEm } : {}),
    };
    // Primeira execução ou repetição da mesma chave com a mesma entrada: o mesmo resultado guardado.
    return (await this.executor.executar(op, this.cliente, entrada, ctx)).resultado;
  }

  /** A conta pelo login, com vínculo vigente no estabelecimento, travada para a gravação. */
  private async contaTravada(tx: TxOperacao, est: number, login: string): Promise<Linha> {
    const [u] = await tx.consultarParaAtualizar(
      `SELECT u.id, u.login, u.situacao, u.versao FROM usuario u WHERE u.login = ? AND u.excluido_em IS NULL AND ${VINCULO}`,
      [login, est],
      { teto: 1 },
    );
    if (!u) throw new ErroOperacao(404, 'nao-encontrado', 'Conta não encontrada', 'A conta não tem vínculo vigente com este estabelecimento.');
    return u;
  }

  // ── Usuários e papéis ──────────────────────────────────────────────────────────────────────

  buscarUsuarios(_rede: string, hospital: string, termo: string) {
    const t = `%${termo.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return this.ler(hospital, async (l, est) =>
      (
        await l.consultar(
          `SELECT u.id, u.login, u.nome, u.situacao FROM usuario u
            WHERE u.excluido_em IS NULL AND (u.login LIKE ? OR u.nome LIKE ?) AND ${VINCULO}
            ORDER BY u.login LIMIT 50`,
          [t, t, est],
          { teto: 50 },
        )
      ).map(usuarioDaLinha),
    );
  }

  usuario(_rede: string, hospital: string, login: string) {
    return this.ler(hospital, async (l, est) => {
      const x = await l.uma(
        `SELECT u.id, u.login, u.nome, u.situacao FROM usuario u WHERE u.login = ? AND u.excluido_em IS NULL AND ${VINCULO}`,
        [login, est],
      );
      return x ? usuarioDaLinha(x) : null;
    });
  }

  papeisDoUsuario(_rede: string, hospital: string, login: string) {
    // Rede inteira: o papel de segurança é da conta (sem estabelecimento); a conta é conferida pelo vínculo.
    return this.ler(hospital, async (l, est) => {
      const ls = await l.consultar(
        `SELECT p.codigo, p.nome, MAX(CASE WHEN ${PAPEL_VIGENTE} THEN 1 ELSE 0 END) AS ativo
           FROM usuario u JOIN usuario_papel_seguranca ups ON ups.usuario_id = u.id
           JOIN papel_seguranca p ON p.id = ups.papel_seguranca_id AND p.excluido_em IS NULL
          WHERE u.login = ? AND u.excluido_em IS NULL AND ${VINCULO}
          GROUP BY p.codigo, p.nome`,
        [login, est],
        { teto: 100 },
      );
      return ls
        .filter((x) => PAPEL_DO_CODIGO.has(txt(x['codigo'])))
        .map((x) => ({ papel: PAPEL_DO_CODIGO.get(txt(x['codigo'])) as number, nome: txt(x['nome']), ativo: bool(x['ativo']) }))
        .sort((a, b) => a.papel - b.papel);
    });
  }

  papeis(_rede: string, hospital: string) {
    // Só os cinco papéis da certificação; as ações de cada papel vêm de papel_seguranca_acao (não há "opções").
    return this.ler(hospital, async (l) =>
      (await l.consultar('SELECT codigo, nome FROM papel_seguranca WHERE ativo AND excluido_em IS NULL ORDER BY codigo', [], { teto: 100 }))
        .filter((x) => PAPEL_DO_CODIGO.has(txt(x['codigo'])))
        .map((x) => {
          const papel = PAPEL_DO_CODIGO.get(txt(x['codigo'])) as number;
          return { papel, nome: txt(x['nome']) || (NOMES_PAPEL[papel] ?? ''), opcoes: [] as number[] };
        })
        .sort((a, b) => a.papel - b.papel),
    );
  }

  // ── Perfis concedidos ──────────────────────────────────────────────────────────────────────

  historicoPerfis(_rede: string, hospital: string, login: string): Promise<PerfilConcedidoLido[]> {
    return this.ler(hospital, async (l, est) =>
      (
        await l.consultar(
          `SELECT up.id, up.versao, pa.codigo, up.vigencia_inicio, up.vigencia_fim, up.motivo, up.excluido_em,
                  c.login AS concedido_por, x.login AS revogado_por
             FROM usuario u JOIN usuario_perfil up ON up.usuario_id = u.id
             JOIN perfil_acesso pa ON pa.id = up.perfil_acesso_id
             LEFT JOIN usuario c ON c.id = up.criado_por
             LEFT JOIN usuario x ON x.id = up.excluido_por
            WHERE u.login = ? AND u.excluido_em IS NULL AND up.estabelecimento_id = ?
            ORDER BY up.id DESC`,
          [login, est],
          { teto: TETO },
        )
      ).map((x) => ({
        id: String(x['id']),
        perfil: txt(x['codigo']),
        inicio: data(x['vigencia_inicio']) as Date,
        fim: data(x['vigencia_fim']),
        motivo: txtOuNull(x['motivo']),
        concedidoPor: txt(x['concedido_por']),
        revogadoEm: data(x['excluido_em']),
        revogadoPor: txtOuNull(x['revogado_por']),
        revogadoMotivo: null,
        versao: num(x['versao']),
      })),
    );
  }

  concederPerfil(_rede: string, hospital: string, c: ConcessaoPerfilNova, t: TrilhaGestao) {
    const entrada = {
      login: c.login,
      perfil: c.perfil,
      inicio: c.inicio ? dia(c.inicio) : null,
      fim: c.fim ? dia(c.fim) : null,
      motivo: c.motivo,
      areaAprovou: c.areaAprovou,
    };
    return this.gravar(
      { nome: 'acesso.perfil.conceder', tabelas: ['usuario_perfil'], esquema: ESQUEMA_CONCESSAO, alvo: 'usuario_perfil',
        motivo: (e) => e.motivo, dados: (e) => ({ perfil: e.perfil, areaAprovou: e.areaAprovou, inicio: e.inicio, fim: e.fim }) },
      hospital, t, entrada,
      async (tx, e, est) => {
        const u = await this.contaTravada(tx, est, e.login);
        const p = await tx.uma(
          `SELECT id FROM perfil_acesso WHERE codigo = ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)
             AND ativo AND excluido_em IS NULL ORDER BY estabelecimento_id IS NULL LIMIT 1`,
          [e.perfil, est],
        );
        if (!p) throw recusa('perfil-inexistente', 'O perfil não está cadastrado (ou está inativo) neste estabelecimento.');
        const inicio = e.inicio ?? dia(new Date());
        // As concessões do mesmo perfil, pessoa e estabelecimento, travadas: nenhuma concessão vigente sobreposta.
        const linhas = await tx.consultarParaAtualizar(
          `SELECT id, versao, vigencia_inicio, vigencia_fim, motivo, excluido_em IS NOT NULL AS revogada,
                  (excluido_em IS NULL AND (vigencia_fim IS NULL OR vigencia_fim >= ?) AND (? IS NULL OR vigencia_inicio <= ?)) AS sobrepoe,
                  (vigencia_inicio = ?) AS mesmo_inicio
             FROM usuario_perfil WHERE usuario_id = ? AND perfil_acesso_id = ? AND estabelecimento_id = ? ORDER BY id DESC`,
          [inicio, e.fim, e.fim, inicio, num(u['id']), num(p['id']), est],
          { teto: TETO },
        );
        if (linhas.some((x) => bool(x['sobrepoe'])))
          throw recusa('perfil-ja-concedido', 'A pessoa já tem este perfil em vigor (ou agendado) no período: altere a concessão existente.');
        // Revogada com o mesmo início (a chave única cobre as revogadas): reabre a mesma concessão; o anterior vai à trilha.
        const revogada = linhas.find((x) => bool(x['mesmo_inicio']) && bool(x['revogada']));
        if (revogada) {
          await tx.alterar('usuario_perfil', num(revogada['id']), num(revogada['versao']), {
            vigencia_fim: e.fim,
            motivo: e.motivo.slice(0, 500),
            excluido_em: null,
            excluido_por: null,
          });
          return { resultado: { id: num(revogada['id']) }, antes: estadoConcessao(revogada, true) };
        }
        const id = await tx.incluir('usuario_perfil', {
          usuario_id: num(u['id']),
          perfil_acesso_id: num(p['id']),
          estabelecimento_id: est,
          vigencia_inicio: inicio,
          vigencia_fim: e.fim,
          provisorio: false,
          motivo: e.motivo.slice(0, 500),
        });
        return { resultado: { id } };
      },
    ).then((r) => ({ id: String(r.id) }));
  }

  /** A concessão não revogada do estabelecimento, travada; outra (ou revogada): 404 e nada gravado. */
  private async concessaoTravada(tx: TxOperacao, est: number, id: number): Promise<Linha> {
    const [x] = await tx.consultarParaAtualizar(
      `SELECT up.id, up.versao, up.vigencia_inicio, up.vigencia_fim, up.motivo, u.login, pa.codigo FROM usuario_perfil up
         JOIN usuario u ON u.id = up.usuario_id JOIN perfil_acesso pa ON pa.id = up.perfil_acesso_id
        WHERE up.id = ? AND up.estabelecimento_id = ? AND up.excluido_em IS NULL`,
      [id, est],
      { teto: 1 },
    );
    if (!x)
      throw new ErroOperacao(404, 'nao-encontrado', 'Concessão não encontrada', 'A concessão não existe neste estabelecimento ou já foi revogada.');
    return x;
  }

  revogarPerfil(_rede: string, hospital: string, id: string, _por: string, t: TrilhaGestao, motivo: string) {
    return this.gravar(
      { nome: 'acesso.perfil.revogar', tabelas: ['usuario_perfil'], esquema: ESQUEMA_REVOGACAO, alvo: 'usuario_perfil', motivo: (e) => e.motivo },
      hospital, t, { id: Number(id), motivo },
      async (tx, e, est, operador) => {
        const x = await this.concessaoTravada(tx, est, e.id);
        const inicio = data(x['vigencia_inicio']) as Date;
        const fim = new Date(Math.max(Date.now(), inicio.getTime()));
        await tx.alterar('usuario_perfil', num(x['id']), num(x['versao']), {
          vigencia_fim: dia(fim),
          excluido_em: new Date(),
          excluido_por: operador,
        });
        return { resultado: { id: num(x['id']), login: txt(x['login']), perfil: txt(x['codigo']) }, antes: estadoConcessao(x, false) };
      },
    ).then((r) => ({ login: r.login, perfil: r.perfil }));
  }

  alterarPerfil(_rede: string, hospital: string, a: Parameters<FonteGestao['alterarPerfil']>[2], t: TrilhaGestao) {
    const entrada = {
      id: Number(a.id),
      inicio: dia(a.inicio),
      fim: a.fim ? dia(a.fim) : null,
      motivo: a.motivo,
      justificativa: a.justificativa,
      por: a.por,
      ...(a.versao !== undefined ? { versao: a.versao } : {}),
    };
    return this.gravar(
      { nome: 'acesso.perfil.alterar', tabelas: ['usuario_perfil'], esquema: ESQUEMA_ALTERACAO, alvo: 'usuario_perfil',
        motivo: (e) => e.justificativa, dados: (e) => ({ depois: { inicio: e.inicio, fim: e.fim, motivo: e.motivo } }) },
      hospital, t, entrada,
      async (tx, e, est) => {
        const x = await this.concessaoTravada(tx, est, e.id);
        if (txt(x['login']) === e.por) throw recusa('a-si-mesmo', 'Ninguém altera o próprio perfil (segregação de funções).');
        // A versão que a tela leu (quando informada): outra, 409 conflito-versao e nada gravado.
        if (e.versao !== undefined && num(x['versao']) !== e.versao) throw erroConflitoVersao(['versao']);
        const versao = await tx.alterar('usuario_perfil', num(x['id']), num(x['versao']), {
          vigencia_inicio: e.inicio,
          vigencia_fim: e.fim,
          motivo: e.motivo.slice(0, 500),
        });
        return {
          resultado: { id: num(x['id']), login: txt(x['login']), perfil: txt(x['codigo']), alteracao: `${num(x['id'])}.${versao}` },
          // O anterior vai à trilha (dados.antes) até a tabela das alterações existir (pedido de DDL).
          antes: estadoConcessao(x, false),
        };
      },
    ).then((r) => ({ situacao: 'ok' as const, login: r.login, perfil: r.perfil, alteracao: r.alteracao }));
  }

  alteracoesPerfil(): Promise<never> {
    return modeloPendenteGestao('O histórico das alterações da concessão', 'usuario_perfil_alteracao');
  }

  gestoresAcesso(_rede: string, hospital: string) {
    return this.ler(hospital, async (l, est) => {
      const ls = await l.consultar(
        `SELECT u.login,
                (SELECT COUNT(*) FROM usuario_papel_seguranca ups JOIN papel_seguranca p ON p.id = ups.papel_seguranca_id AND p.excluido_em IS NULL
                  WHERE ups.usuario_id = u.id AND p.codigo = ? AND ${PAPEL_VIGENTE}) AS papel_gestor,
                (SELECT GROUP_CONCAT(up.id ORDER BY up.id) FROM usuario_perfil up JOIN perfil_acesso pa ON pa.id = up.perfil_acesso_id
                  WHERE up.usuario_id = u.id AND up.estabelecimento_id = ? AND pa.codigo = ? AND ${PERFIL_VIGENTE}) AS concessoes
           FROM usuario u
          WHERE u.excluido_em IS NULL AND u.situacao IN ('ativo','dormente') AND ${VINCULO}
          ORDER BY u.login`,
        [CODIGOS_PAPEL[0], est, PERFIL_GESTOR_ACESSOS, est],
        { teto: TETO },
      );
      return ls
        .map((x) => ({
          login: txt(x['login']),
          grupo: null,
          papelGestor: num(x['papel_gestor']) > 0,
          concessoes: txt(x['concessoes']).split(',').filter((s) => s !== ''),
        }))
        .filter((g) => g.papelGestor || g.concessoes.length > 0);
    });
  }

  // ── Contas para as rotinas (dormência e recertificação) ─────────────────────────────────────

  contasDormencia(_rede: string, hospital: string) {
    return this.ler(hospital, async (l, est) =>
      (
        await l.consultar(
          `SELECT u.login, u.ultimo_acesso_em FROM usuario u
            WHERE u.excluido_em IS NULL AND u.situacao = 'ativo' AND u.tipo_conta = 'pessoa' AND ${VINCULO}
            ORDER BY u.login`,
          [est],
          { teto: TETO * 4 },
        )
      ).map((x) => ({
        login: txt(x['login']),
        grupo: null,
        ativo: true,
        bloqueado: false,
        ultimoAcesso: data(x['ultimo_acesso_em'])?.toISOString() ?? null,
      })),
    );
  }

  contasRecert(_rede: string, hospital: string) {
    return this.ler(hospital, async (l, est) =>
      (
        await l.consultar(
          `SELECT u.login,
                  (SELECT GROUP_CONCAT(DISTINCT pa.codigo ORDER BY pa.codigo) FROM usuario_perfil up
                     JOIN perfil_acesso pa ON pa.id = up.perfil_acesso_id
                    WHERE up.usuario_id = u.id AND up.estabelecimento_id = ? AND ${PERFIL_VIGENTE}) AS perfis
             FROM usuario u
            WHERE u.excluido_em IS NULL AND u.situacao = 'ativo' AND ${VINCULO}
            ORDER BY u.login`,
          [est, est],
          { teto: TETO * 4 },
        )
      ).map((x) => ({
        login: txt(x['login']),
        grupo: null,
        ativo: true,
        bloqueado: false,
        setores: [],
        perfis: txt(x['perfis']).split(',').filter((s) => s !== ''),
      })),
    );
  }

  // ── Operações da conta (bloqueio e papéis de segurança) ─────────────────────────────────────

  receita(nome: string): EstadoReceita {
    return ehOperacaoConta(nome)
      ? { estado: null, ligada: true, motivo: null }
      : { estado: null, ligada: false, motivo: SEM_GRUPOS };
  }

  async executar(nome: string, hospital: string, entrada: unknown, c: ContextoGestao): Promise<void> {
    if (!ehOperacaoConta(nome)) semGrupos();
    const op = nome as OperacaoConta;
    const quem = { usuario: c.usuario, correlacao: c.correlacao, chave: c.chaveIdempotencia, ...(c.reautenticadoEm !== undefined ? { reautenticadoEm: c.reautenticadoEm } : {}) };
    // A entrada real (login, papel) vai ao Executor: esquema do contrato e hash da idempotência.
    const esquema = OPERACOES_CONTA[op] as unknown as ZodType<{ login: string; papel?: number }>;
    if (op === 'acesso.bloquearUsuario') {
      await this.gravar({ nome: 'acesso.conta.bloquear', tabelas: ['usuario', 'usuario_situacao_historico'], esquema, alvo: 'usuario' }, hospital, quem, entrada, async (tx, e, est, operador) => {
        const u = await this.contaTravada(tx, est, e.login);
        const antes = txt(u['situacao']);
        if (antes === 'bloqueado') throw recusa('ja-bloqueado', 'A conta já está bloqueada.');
        if (antes === 'inativo') throw recusa('conta-inativa', 'A conta está desativada.');
        const agora = new Date();
        await tx.alterar('usuario', num(u['id']), num(u['versao']), { situacao: 'bloqueado', bloqueado_em: agora });
        await tx.incluir('usuario_situacao_historico', {
          usuario_id: num(u['id']),
          operacao: 'alteracao',
          situacao_anterior: antes,
          situacao_nova: 'bloqueado',
          evento: 'bloqueio',
          ocorrido_em: agora,
          responsavel_usuario_id: operador,
        });
        return { resultado: { id: num(u['id']) }, antes: { situacao: antes, versao: num(u['versao']) } };
      });
      return;
    }
    const acao = op === 'acesso.concederPapelUsuario' ? 'conceder' : op === 'acesso.revogarPapelUsuario' ? 'revogar' : 'reativar';
    await this.gravar({ nome: `acesso.papel.${acao}`, tabelas: ['usuario_papel_seguranca'], esquema, alvo: 'usuario_papel_seguranca', dados: (e) => ({ papel: e.papel ?? null }) }, hospital, quem, entrada, async (tx, e, est, operador) => {
      const codigo = CODIGOS_PAPEL[e.papel ?? -1];
      if (!codigo) throw new ErroOperacao(400, 'entrada-invalida', 'Dados inválidos', 'Papel desconhecido.');
      const u = await this.contaTravada(tx, est, e.login);
      const papel = await tx.uma('SELECT id FROM papel_seguranca WHERE codigo = ? AND ativo AND excluido_em IS NULL', [codigo]);
      if (!papel) throw recusa('papel-inexistente', 'O papel não está cadastrado neste banco.');
      const linhas = await tx.consultarParaAtualizar(
        `SELECT ups.id, ups.versao, ups.vigencia_inicio, ups.vigencia_fim, ups.excluido_em,
                (${PAPEL_VIGENTE}) AS vigente, (ups.vigencia_inicio = CURDATE()) AS de_hoje
           FROM usuario_papel_seguranca ups WHERE ups.usuario_id = ? AND ups.papel_seguranca_id = ? ORDER BY ups.id DESC`,
        [num(u['id']), num(papel['id'])],
        { teto: 100 },
      );
      const estado = (x: Linha) => ({
        vigenciaInicio: dia(data(x['vigencia_inicio']) as Date),
        vigenciaFim: data(x['vigencia_fim']) ? dia(data(x['vigencia_fim']) as Date) : null,
        retirado: x['excluido_em'] !== null && x['excluido_em'] !== undefined,
        versao: num(x['versao']),
      });
      const vigente = linhas.find((x) => bool(x['vigente']));
      if (op === 'acesso.revogarPapelUsuario') {
        if (!vigente) throw recusa('papel-nao-concedido', 'A conta não tem este papel em vigor.');
        const inicio = data(vigente['vigencia_inicio']) as Date;
        await tx.alterar('usuario_papel_seguranca', num(vigente['id']), num(vigente['versao']), {
          vigencia_fim: dia(new Date(Math.max(Date.now(), inicio.getTime()))),
          excluido_em: new Date(),
          excluido_por: operador,
        });
        return { resultado: { id: num(vigente['id']) }, antes: estado(vigente) };
      }
      if (vigente) throw recusa('papel-ja-concedido', 'A conta já tem este papel em vigor.');
      if (op === 'acesso.reativarPapelUsuario' && linhas.length === 0)
        throw recusa('papel-nao-concedido', 'A conta nunca teve este papel: conceda-o.');
      const deHoje = linhas.find((x) => bool(x['de_hoje']));
      if (deHoje) {
        await tx.alterar('usuario_papel_seguranca', num(deHoje['id']), num(deHoje['versao']), {
          vigencia_fim: null,
          excluido_em: null,
          excluido_por: null,
        });
        return { resultado: { id: num(deHoje['id']) }, antes: estado(deHoje) };
      }
      const id = await tx.incluir('usuario_papel_seguranca', {
        usuario_id: num(u['id']),
        papel_seguranca_id: num(papel['id']),
        vigencia_inicio: dia(new Date()),
      });
      return { resultado: { id } };
    });
  }

  // ── Sem grupos no modelo próprio ────────────────────────────────────────────────────────────

  mapa() {
    return Promise.resolve([]);
  }
  grupos() {
    return Promise.resolve([]);
  }
  candidatosMapa() {
    return Promise.resolve({ logins: [], limitado: false });
  }
  decisoesMapa() {
    return Promise.resolve([]);
  }
  decidirMapa(): Promise<never> {
    return Promise.reject(recusa('sem-grupos', SEM_GRUPOS));
  }
  versoesDescricaoGrupo(): Promise<never> {
    return Promise.reject(recusa('sem-grupos', SEM_GRUPOS));
  }
  descreverGrupo(): Promise<never> {
    return Promise.reject(recusa('sem-grupos', SEM_GRUPOS));
  }

  // ── Pendências do modelo (pedido de DDL) ──────────────────────────────────────────────────────

  versoesPoliticaSenha() {
    // A política em vigor é a de politica_senha (lida pela sessão); versões agendadas aguardam politica_senha_versao.
    return Promise.resolve([]);
  }
  publicarPoliticaSenha(): Promise<never> {
    return modeloPendenteGestao('A política de senha por versão', 'politica_senha_versao');
  }
  cancelarPoliticaSenha(): Promise<never> {
    return modeloPendenteGestao('A política de senha por versão', 'politica_senha_versao');
  }
  historicoLimitesSessao(): Promise<never> {
    return modeloPendenteGestao('O limite de sessões por perfil', 'limite_sessao_perfil');
  }
  definirLimiteSessao(): Promise<never> {
    return modeloPendenteGestao('O limite de sessões por perfil', 'limite_sessao_perfil');
  }
  historicoExcecoesDormencia() {
    // Nenhuma exceção pode existir sem a tabela (registrar é recusado): a rotina segue sem exceções.
    return Promise.resolve([]);
  }
  registrarExcecaoDormencia(): Promise<never> {
    return modeloPendenteGestao('A exceção das contas dormentes', 'excecao_conta_dormente');
  }
  registrosConselho(): Promise<never> {
    return modeloPendenteGestao('A conferência do registro no conselho', 'conferencia_registro_conselho');
  }
  conferenciasConselho(): Promise<never> {
    return modeloPendenteGestao('A conferência do registro no conselho', 'conferencia_registro_conselho');
  }
  registrarConferenciaConselho(): Promise<never> {
    return modeloPendenteGestao('A conferência do registro no conselho', 'conferencia_registro_conselho');
  }
  dadosRh(): Promise<never> {
    return modeloPendenteGestao('A integração com o RH (cargo → perfil e resoluções)', 'perfil_cargo_rh e resolucao_tarefa_rh');
  }
  definirPerfilCargoRh(): Promise<never> {
    return modeloPendenteGestao('A integração com o RH (cargo → perfil e resoluções)', 'perfil_cargo_rh');
  }
  resolverTarefaRh(): Promise<never> {
    return modeloPendenteGestao('A integração com o RH (cargo → perfil e resoluções)', 'resolucao_tarefa_rh');
  }

  // ── Tabelas existentes, adaptador a escrever (pedido ao orquestrador) ──────────────────────────

  campanhasRecert(): Promise<never> {
    return adaptadorPendenteGestao('A campanha de recertificação');
  }
  campanhaRecert(): Promise<never> {
    return adaptadorPendenteGestao('A campanha de recertificação');
  }
  abrirCampanhaRecert(): Promise<never> {
    return adaptadorPendenteGestao('A campanha de recertificação');
  }
  decidirRecert(): Promise<never> {
    return adaptadorPendenteGestao('A campanha de recertificação');
  }
  fecharCampanhaRecert(): Promise<never> {
    return adaptadorPendenteGestao('A campanha de recertificação');
  }
  pedidosAcesso(): Promise<never> {
    return adaptadorPendenteGestao('O pedido de acesso');
  }
  pedidoAcesso(): Promise<never> {
    return adaptadorPendenteGestao('O pedido de acesso');
  }
  pedirAcesso(): Promise<never> {
    return adaptadorPendenteGestao('O pedido de acesso');
  }
  decidirPedidoAcesso(): Promise<never> {
    return adaptadorPendenteGestao('O pedido de acesso');
  }
  concederPedidoAprovado(): Promise<never> {
    return adaptadorPendenteGestao('O pedido de acesso');
  }
  concessaoPedidoAcesso(): Promise<never> {
    return adaptadorPendenteGestao('O pedido de acesso');
  }
  cancelarPedidoAcesso(): Promise<never> {
    return adaptadorPendenteGestao('O pedido de acesso');
  }
}

/** A fonte da gestão de acessos sobre o banco do cliente (`cliente`: configuracao.clientePadrao). */
export function fonteGestaoPropria(nucleo: NucleoGestao, cliente: string, executor?: Executor): FonteGestao {
  return new FonteGestaoPropria(nucleo, cliente, executor);
}
