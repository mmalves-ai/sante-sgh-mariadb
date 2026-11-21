// Tela "Perfis e permissões" (ADR 0022; permissão acesso.perfil.gerir: perfil gestor-acessos e acesso total da
// plataforma). Leituras ao vivo, pela FonteGestao (banco próprio do cliente ou memória sintética):
//   GET  /api/acesso/gestao/usuarios?busca=           contas com vínculo no estabelecimento (login ou nome)
//   GET  /api/acesso/gestao/usuarios/:login           permissões efetivas com a origem e o que a segregação retirou
//   GET  /api/acesso/gestao/mapa                       mapa perfil → permissão (com as propostas)
//   GET  /api/acesso/gestao/grupos | papeis            grupos (vazio no banco próprio) e papéis de segurança
//   GET  /api/acesso/gestao/operacoes                  estado de cada operação da conta (motivo visível)
// Gravações (reautenticação pela senha: SBIS-07; Idempotency-Key nas operações da conta):
//   POST /api/acesso/gestao/perfis | perfis/:id/revogar     concessão de perfil com vigência (usuario_perfil)
//   POST /api/acesso/gestao/perfis/:id/alteracao           vigência e motivo (W0-09)
//   GET  /api/acesso/gestao/perfis/:id/alteracoes          o anterior e o novo de cada alteração
//   POST /api/acesso/gestao/mapa/decidir                    decisão do mapa (proposta → aprovada|recusada)
//   POST /api/acesso/gestao/grupos/descricao                versão nova da descrição do grupo
//   GET  /api/acesso/gestao/grupos/:grupo/descricoes        as versões da descrição (a anterior visível)
//   GET  /api/acesso/gestao/politica-senha                  a política do estabelecimento, a efetiva e as versões
//   POST /api/acesso/gestao/politica-senha                  versão nova com vigência
//   POST /api/acesso/gestao/politica-senha/:versao/cancelar a versão agendada, antes de entrar em vigor
//   GET  /api/acesso/gestao/limites-sessao                  limites de sessões por perfil e o histórico
//   POST /api/acesso/gestao/limites-sessao                  incluir/alterar/retirar o limite
//   POST /api/acesso/gestao/mapa/previa                     quantos perdem antes de confirmar (W0-09; nada grava)
//   GET  /api/acesso/gestao/mapa/:id/decisoes               decisões da linha do mapa (anterior, motivo, afetados)
//   POST /api/acesso/gestao/operacoes/:operacao             operações da conta (bloquear, papéis de segurança)
//   POST /api/acesso/gestao/cache/invalidar                 a mudança vale na hora
// Toda gravação invalida o cache das permissões (3 min) do afetado (ou do estabelecimento inteiro, quando a
// mudança vale para um grupo, um papel ou o mapa) e vai à trilha com o ator real (no "como" e no acesso total,
// a origem da trilha). O que a fonte própria ainda não grava responde "modelo-pendente" ou "adaptador-pendente".
// Melhoria: a rota das operações da conta deixa de ser a das receitas do sistema de origem; as de grupo são recusadas
// com o motivo (o modelo próprio não tem grupos).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  type AlteracaoPerfilTela,
  CATALOGO_DECLARADO,
  type EfetivasTela,
  esquemaCancelarPoliticaSenha,
  esquemaDefinirLimiteSessao,
  type LimitesSessaoGestaoTela,
  esquemaConcederPerfil,
  esquemaPublicarPoliticaSenha,
  type PoliticaSenhaGestaoTela,
  type VersaoPoliticaSenhaTela,
  esquemaAlterarPerfil,
  type DecisaoMapaTela,
  esquemaDecidirMapa,
  esquemaDescreverGrupo,
  esquemaNomeGrupo,
  esquemaInvalidarCache,
  esquemaPreviaMapa,
  esquemaLogin,
  esquemaPedidoGestaoLegado,
  esquemaRevogarPerfil,
  EVENTOS_AUDITAVEIS,
  type GrupoGestaoTela,
  type LinhaMapaTela,
  type MapaGestaoTela,
  NOMES_OPERACOES_GESTAO,
  OPERACOES_GESTAO_LEGADO,
  type OperacaoGestaoLegado,
  type OperacaoGestaoTela,
  type OrigemPermissaoTela,
  type PapelGestaoTela,
  type PreviaMapaTela,
  PERFIS_COMPLEMENTARES,
  PERFIS_OPERADORA,
  PERMISSOES_ACESSO,
  type ResultadoGestaoTela,
  type UsuarioGestaoTela,
  type VersaoDescricaoGrupoTela,
} from '@sgh/contratos';
import {
  destinoDoGrupo,
  MAPA_GRUPOS,
  MINIMO_DO_NOVO,
  type OrigemConcessao,
  PERFIL_DO_PAPEL,
  politicaEfetiva,
} from '@sgh/dominio-acesso';
import { ErroOperacao } from '@sgh/nucleo';
import type { z } from 'zod';
import { CATALOGO_COMPLETO } from '../../autorizacao/catalogo.js';
import { Auditar, AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema, type ExtrasProblema, tipoPorStatus } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from './acesso.controller.js';
import { FONTE_GESTAO, type FonteGestao } from './gestao-fonte.js';
import type { ContextoGestao, DestinoGestao, TrilhaGestao } from './gestao-tipos.js';
import {
  ErroMotivoMapa,
  limitesVigentes,
  mapaMudaDecisao,
  type VersaoPoliticaSenhaLida,
} from './tipos-gestao-acesso.js';
import { exigirGestorRestante } from './ultimo-gestor.js';

/** O resultado da gravação com o destino da fonte (o banco próprio ou a memória). */
type ResultadoGestao = Omit<ResultadoGestaoTela, 'destino'> & { readonly destino: DestinoGestao };

const IDEMPOTENCIA = /^[A-Za-z0-9._:-]{8,80}$/;
const DESCRICAO = new Map(CATALOGO_COMPLETO.map((p) => [p.codigo, p.descricao]));

/** Perfis que a tela oferece: os complementares e os de destino do mapa dos 42 grupos. */
export const PERFIS_DA_TELA: readonly string[] = [
  ...new Set([
    ...PERFIS_COMPLEMENTARES,
    // M56 (D-PERM-56): os perfis próprios da operadora (empresa distinta; só por concessão nominal ou pelo mapa).
    ...PERFIS_OPERADORA,
    ...Object.values(MAPA_GRUPOS).flatMap((d) => (d.tipo === 'perfil' ? [d.perfil] : [])),
  ]),
].sort();

/** Permissões que o mapa perfil → permissão pode conceder (recurso por perfil). */
const POR_PERFIL = new Set(
  CATALOGO_COMPLETO.filter((p) => p.concessaoPorPerfil !== null).map((p) => p.codigo),
);

/** Operações que mudam um usuário só (invalida o cache dele); as demais valem para muitos (o estabelecimento). */
const DO_USUARIO: ReadonlySet<OperacaoGestaoLegado> = new Set([
  'acesso.concederPapelUsuario',
  'acesso.reativarPapelUsuario',
  'acesso.revogarPapelUsuario',
  'acesso.trocarGrupoUsuario',
]);

function origemTela(
  o: OrigemConcessao,
  grupo: string | null,
  viaPerfil: (p: string) => string,
): OrigemPermissaoTela {
  switch (o.tipo) {
    case 'opcao-grupo':
      return { tipo: 'grupo', grupo: grupo ?? '', opcao: o.opcao };
    case 'opcao-papel':
      return { tipo: 'papel', opcao: o.opcao };
    case 'flag':
      return { tipo: 'flag', flag: o.flag };
    case 'perfil':
      return { tipo: 'perfil', perfil: o.perfil, via: viaPerfil(o.perfil) as 'papel' };
    case 'acesso-total':
      return { tipo: 'acesso-total' };
    default:
      return { tipo: 'todos-os-perfis-de-pessoa' };
  }
}

@Controller('acesso/gestao')
export class GestaoAcessoController {
  constructor(
    @Inject(FONTE_GESTAO) private readonly fonte: FonteGestao,
    @Inject(SERVICO_SESSAO) private readonly servico: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
  ) {}

  private sessao(req: RequisicaoAutorizada): { rede: string; hospital: string; login: string } {
    const s = req.sgh?.sessao;
    if (!s?.rede || !s.estabelecimentoAtivo || !s.usuario.login)
      throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    return { rede: s.rede, hospital: s.estabelecimentoAtivo, login: s.usuario.login };
  }

  private analisar<T extends z.ZodType>(esquema: T, corpo: unknown): z.infer<T> {
    const r = esquema.safeParse(corpo);
    if (!r.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        r.error.issues[0]?.message ?? undefined,
      );
    return r.data;
  }

  private login(bruto: string): string {
    const r = esquemaLogin.safeParse(bruto);
    if (!r.success) throw new ErroProblema('entrada-invalida', 400, 'Login inválido');
    return r.data;
  }

  /** Erro do executor ou da regra (mesmos códigos) → Problem Details sem nome de tabela nem valor. */
  private problema(e: unknown): never {
    if (e instanceof ErroProblema) throw e;
    if (e instanceof ErroMotivoMapa)
      throw new ErroProblema('entrada-invalida', 400, 'Motivo obrigatório', e.message, {
        codigo: 'motivo-obrigatorio',
      });
    if (e instanceof ErroOperacao) {
      const p = e.problema;
      const tipo = p.status === 409 ? 'recusa-de-negocio' : tipoPorStatus(p.status);
      const extras: { -readonly [K in keyof ExtrasProblema]: ExtrasProblema[K] } = {};
      if (p.codigo) extras.codigo = p.codigo;
      // W1-01 (D-CRUD-ORFAOS): quantos e quais dependem (rótulo de produto, nunca a tabela) e a saída oferecida.
      if (p.dependentes)
        extras.dependentes = p.dependentes.map((x) => ({
          rotulo: x.rotulo,
          quantidade: x.quantidade,
          amostra: [...x.amostra],
          origem: x.origem,
        }));
      if (p.podeInativar !== undefined) extras.podeInativar = p.podeInativar;
      throw new ErroProblema(tipo, p.status, p.title, p.detail, extras);
    }
    throw e;
  }

  private trilha(req: RequisicaoAutorizada, evento: string, operacao: string): TrilhaGestao {
    const { rede, hospital, login } = this.sessao(req);
    return {
      rede,
      hospital,
      usuario: login,
      evento,
      recurso: 'acesso.perfil',
      operacao,
      resultado: 'sucesso',
      estacao: estacaoDaRequisicao(req).slice(0, 80),
      correlacao: correlacaoDaRequisicao(req, 'acesso-gestao').slice(0, 64),
    };
  }

  /** Cache das permissões: do usuário ou do estabelecimento inteiro (nova geração). */
  private async invalidar(
    req: RequisicaoAutorizada,
    login: string | null,
  ): Promise<'usuario' | 'estabelecimento'> {
    const { rede, hospital } = this.sessao(req);
    const a = this.servico?.servicoAutorizacao;
    if (a) {
      if (login) await a.invalidar(rede, hospital, login);
      else await a.invalidarEstabelecimento(rede, hospital);
    }
    return login ? 'usuario' : 'estabelecimento';
  }

  /**
   * Segregação pelo mapa (ADR 0022, decisão 17): o mapa vale para todo o grupo ou todo o perfil, então o
   * operador não decide a linha do PRÓPRIO grupo (o grupo da conta, quando a fonte o tem) nem a de um perfil que ele tem (as
   * origens ao vivo, sem cache). Vale em toda decisão (aprovar dá, recusar ou voltar a proposta tira).
   */
  private async naoNoProprioAcesso(
    rede: string,
    hospital: string,
    operador: string,
    c: z.infer<typeof esquemaDecidirMapa>['chave'],
  ): Promise<void> {
    const recusar = (detalhe: string): never => {
      throw new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', detalhe, {
        codigo: 'a-si-mesmo',
      });
    };
    if (c.tipo === 'grupo-perfil') {
      const eu = await this.fonte.usuario(rede, hospital, operador);
      if (eu?.grupo === c.grupo) recusar('Ninguém decide o mapa do próprio grupo (segregação de funções).');
      return;
    }
    const a = this.servico?.servicoAutorizacao;
    if (!a) throw new ErroProblema('indisponivel', 503, 'Serviço de permissões indisponível');
    if ((await a.explicar(hospital, operador)).origensPerfis.has(c.perfil))
      recusar('Ninguém decide as permissões de um perfil que tem (segregação de funções).');
  }

  /** W1-01 (parte 3c): retirar o papel 0 ou tirar do acesso total não deixa o estabelecimento sem gestor. */
  private async ultimoGestor(
    op: OperacaoGestaoLegado,
    rede: string,
    hospital: string,
    entrada: unknown,
  ): Promise<void> {
    const e = (entrada ?? {}) as { login?: unknown; papel?: unknown; grupo?: unknown };
    if (typeof e.login !== 'string') return;
    if (op === 'acesso.revogarPapelUsuario' && typeof e.papel === 'number')
      await exigirGestorRestante(this.fonte, rede, hospital, {
        tipo: 'retirar-papel',
        login: e.login,
        papel: e.papel,
      });
    if (op === 'acesso.trocarGrupoUsuario' && typeof e.grupo === 'string')
      await exigirGestorRestante(this.fonte, rede, hospital, {
        tipo: 'trocar-grupo',
        login: e.login,
        grupoNovo: e.grupo,
      });
  }

  private async reautenticado(req: RequisicaoAutorizada, senha: string): Promise<number> {
    return reautenticar(this.servico, this.resolvedor, req, senha);
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────

  @Get('usuarios')
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @Auditar(EVENTOS_AUDITAVEIS.grupoConsultado.codigo)
  async usuarios(
    @Req() req: RequisicaoAutorizada,
    @Query('busca') busca?: string,
  ): Promise<UsuarioGestaoTela[]> {
    const { rede, hospital } = this.sessao(req);
    const termo = String(busca ?? '').slice(0, 40);
    return (await this.fonte.buscarUsuarios(rede, hospital, termo)).map((u) => ({
      login: u.login,
      nome: u.nome,
      grupo: u.grupo,
      ativo: u.ativo,
      bloqueado: u.bloqueado,
    }));
  }

  @Get('usuarios/:login')
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @Auditar(EVENTOS_AUDITAVEIS.mapaConsultado.codigo)
  async efetivas(@Param('login') bruto: string, @Req() req: RequisicaoAutorizada): Promise<EfetivasTela> {
    const login = this.login(bruto);
    const { rede, hospital } = this.sessao(req);
    const u = await this.fonte.usuario(rede, hospital, login);
    if (!u) throw new ErroProblema('nao-encontrado', 404, 'Usuário não encontrado');
    const a = this.servico?.servicoAutorizacao;
    if (!a) throw new ErroProblema('indisponivel', 503, 'Serviço de permissões indisponível');
    const [r, papeis, historico, grupos] = await Promise.all([
      a.explicar(hospital, login, rede),
      this.fonte.papeisDoUsuario(rede, hospital, login),
      this.fonte.historicoPerfis(rede, hospital, login),
      this.fonte.grupos(rede, hospital),
    ]);
    const via = (p: string) => r.origensPerfis.get(p)?.[0] ?? 'concessao';
    const agora = Date.now();
    return {
      usuario: { login: u.login, nome: u.nome, grupo: u.grupo, ativo: u.ativo, bloqueado: u.bloqueado },
      grupoAtivo: u.grupo ? (grupos.find((g) => g.nome === u.grupo)?.ativo ?? null) : null,
      papeis,
      perfis: [...r.origensPerfis]
        .map(([perfil, origens]) => ({ perfil, origens }))
        .sort((x, y) => x.perfil.localeCompare(y.perfil)),
      permissoes: [...r.permissoes].sort().map((codigo) => ({
        codigo,
        descricao: DESCRICAO.get(codigo) ?? codigo,
        origens: (r.origens.get(codigo) ?? []).map((o) => origemTela(o, u.grupo, via)),
      })),
      retiradas: r.retiradas.map((x) => ({ permissao: x.permissao, motivo: x.motivo })),
      conflitos: r.conflitos.map((x) => ({ permissao: x.permissao, motivo: x.motivo })),
      concessoes: historico.map((h) => ({
        id: h.id,
        perfil: h.perfil,
        inicio: h.inicio.toISOString(),
        fim: h.fim?.toISOString() ?? null,
        motivo: h.motivo,
        concedidoPor: h.concedidoPor,
        revogadoEm: h.revogadoEm?.toISOString() ?? null,
        revogadoPor: h.revogadoPor,
        revogadoMotivo: h.revogadoMotivo ?? null,
        vigente: !h.revogadoEm && h.inicio.getTime() <= agora && (!h.fim || h.fim.getTime() > agora),
        alteracoes: h.alteracoes ?? 0,
      })),
      calculadaEm: new Date(r.calculadaEm).toISOString(),
    };
  }

  @Get('mapa')
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @Auditar(EVENTOS_AUDITAVEIS.mapaConsultado.codigo)
  async mapa(@Req() req: RequisicaoAutorizada): Promise<MapaGestaoTela> {
    const { rede, hospital } = this.sessao(req);
    const [linhas, grupos] = await Promise.all([
      this.fonte.mapa(rede, hospital),
      this.fonte.grupos(rede, hospital),
    ]);
    const tela = (l: (typeof linhas)[number]): LinhaMapaTela => ({
      id: l.id,
      tipo: l.tipo,
      grupo: l.grupo,
      perfil: l.perfil,
      permissao: l.permissao,
      origem: l.origem,
      situacao: l.situacao,
      aprovadoPor: l.aprovadoPor,
      aprovadoEm: l.aprovadoEm?.toISOString() ?? null,
    });
    const doBanco = linhas.filter((l) => l.tipo === 'grupo-perfil').map(tela);
    // Proposta automática (o mapa dos 42 grupos no código) que ainda não tem linha no banco.
    const propostas: LinhaMapaTela[] = grupos.flatMap((g) => {
      const d = destinoDoGrupo(g.nome);
      if (d.tipo !== 'perfil' || doBanco.some((l) => l.grupo === g.nome && l.perfil === d.perfil)) return [];
      return [
        {
          id: null,
          tipo: 'grupo-perfil',
          grupo: g.nome,
          perfil: d.perfil,
          permissao: null,
          origem: 'proposta-automatica',
          situacao: 'proposta',
          aprovadoPor: null,
          aprovadoEm: null,
        },
      ];
    });
    // Perfil → permissão: o que o catálogo declara (código, sempre vale) e as linhas do banco.
    const doCatalogo: LinhaMapaTela[] = CATALOGO_DECLARADO.flatMap((p) =>
      p.concessaoPorPerfil === 'por-perfil'
        ? (p.perfis ?? []).map((perfil): LinhaMapaTela => ({
            id: null,
            tipo: 'perfil-permissao',
            grupo: null,
            perfil,
            permissao: p.codigo,
            origem: 'catalogo',
            situacao: 'aprovada',
            aprovadoPor: null,
            aprovadoEm: null,
          }))
        : [],
    );
    return {
      grupoPerfil: [...doBanco, ...propostas].sort((a, b) =>
        `${a.grupo}${a.perfil}`.localeCompare(`${b.grupo}${b.perfil}`),
      ),
      perfilPermissao: [...doCatalogo, ...linhas.filter((l) => l.tipo === 'perfil-permissao').map(tela)],
      perfis: PERFIS_DA_TELA,
    };
  }

  @Get('grupos')
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @Auditar(EVENTOS_AUDITAVEIS.grupoConsultado.codigo)
  async grupos(@Req() req: RequisicaoAutorizada): Promise<GrupoGestaoTela[]> {
    const { rede, hospital } = this.sessao(req);
    return (await this.fonte.grupos(rede, hospital)).map((g) => ({
      grupo: g.nome,
      ativo: g.ativo,
      opcoes: g.opcoes,
    }));
  }

  @Get('papeis')
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @Auditar(EVENTOS_AUDITAVEIS.grupoConsultado.codigo)
  async papeis(@Req() req: RequisicaoAutorizada): Promise<PapelGestaoTela[]> {
    const { rede, hospital } = this.sessao(req);
    return (await this.fonte.papeis(rede, hospital)).map((p) => ({
      papel: p.papel,
      nome: p.nome,
      opcoes: p.opcoes,
    }));
  }

  @Get('operacoes')
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  operacoes(@Req() req: RequisicaoAutorizada): OperacaoGestaoTela[] {
    const { hospital } = this.sessao(req);
    return NOMES_OPERACOES_GESTAO.map((operacao) => {
      const r = this.fonte.receita(operacao, hospital);
      return {
        operacao,
        rotulo: OPERACOES_GESTAO_LEGADO[operacao],
        ligada: r.ligada,
        estado: r.estado,
        motivo: r.motivo,
      };
    });
  }

  // ── Perfis do Sante SGH ───────────────────────────────────────────────────────────────────────

  @Post('perfis')
  @HttpCode(201)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @AuditadoNoHandler('executor do núcleo: a gravação e a trilha na mesma transação (memória: registrador da API)')
  async concederPerfil(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoGestaoTela & { id: string }> {
    const p = this.analisar(esquemaConcederPerfil, corpo);
    const { rede, hospital, login: operador } = this.sessao(req);
    if (!PERFIS_DA_TELA.includes(p.perfil))
      throw new ErroProblema('entrada-invalida', 400, 'Perfil desconhecido');
    if (p.login === operador)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Operação recusada',
        'Ninguém concede perfil a si mesmo (segregação de funções).',
        {
          codigo: 'a-si-mesmo',
        },
      );
    await this.reautenticado(req, p.senha);
    const u = await this.fonte.usuario(rede, hospital, p.login);
    if (!u) throw new ErroProblema('nao-encontrado', 404, 'Usuário não encontrado');
    const r = await this.fonte
      .concederPerfil(
        rede,
        hospital,
        {
          idUsuario: u.id,
          login: u.login,
          perfil: p.perfil,
          concedidoPor: operador,
          areaAprovou: req.sghComo?.modo === 'acesso-total' ? 'plataforma' : 'gestor-acessos',
          inicio: p.inicio ? new Date(p.inicio) : null,
          fim: p.fim ? new Date(p.fim) : null,
          motivo: p.motivo,
        },
        this.trilha(req, EVENTOS_AUDITAVEIS.perfilConcedido.codigo, 'acesso.concederPerfil'),
      )
      .catch((e: unknown) => this.problema(e));
    return {
      id: r.id,
      operacao: 'acesso.concederPerfil',
      invalidado: await this.invalidar(req, u.login),
      destino: this.fonte.destino,
    };
  }

  @Post('perfis/:id/revogar')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @AuditadoNoHandler('executor do núcleo: a gravação e a trilha na mesma transação (memória: registrador da API)')
  async revogarPerfil(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoGestao> {
    if (!/^\d{1,18}$/.test(id)) throw new ErroProblema('nao-encontrado', 404, 'Concessão não encontrada');
    const p = this.analisar(esquemaRevogarPerfil, corpo);
    const { rede, hospital, login: operador } = this.sessao(req);
    // W1-01 (parte 3c): a regra responde antes da senha, sem abrir transação (como o limite de administradores).
    await exigirGestorRestante(this.fonte, rede, hospital, { tipo: 'retirar-perfil', concessao: id });
    await this.reautenticado(req, p.senha);
    const r = await this.fonte
      .revogarPerfil(
        rede,
        hospital,
        id,
        operador,
        this.trilha(req, EVENTOS_AUDITAVEIS.perfilRevogado.codigo, 'acesso.revogarPerfil'),
        p.motivo,
      )
      .catch((e: unknown) => this.problema(e));
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Concessão não encontrada ou já revogada');
    return {
      operacao: 'acesso.revogarPerfil',
      invalidado: await this.invalidar(req, r.login),
      destino: this.fonte.destino,
    };
  }

  @Post('perfis/:id/alteracao')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @AuditadoNoHandler('executor do núcleo: a gravação e a trilha na mesma transação (memória: registrador da API)')
  async alterarPerfil(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoGestaoTela & { alteracao: string }> {
    if (!/^\d{1,18}$/.test(id)) throw new ErroProblema('nao-encontrado', 404, 'Concessão não encontrada');
    const p = this.analisar(esquemaAlterarPerfil, corpo);
    if (p.fim && Date.parse(p.fim) <= Date.now())
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'O fim tem de ser futuro. Para tirar o perfil agora, revogue a concessão.',
      );
    const { rede, hospital, login: operador } = this.sessao(req);
    await this.reautenticado(req, p.senha);
    const r = await this.fonte
      .alterarPerfil(
        rede,
        hospital,
        {
          id,
          inicio: new Date(p.inicio),
          fim: p.fim ? new Date(p.fim) : null,
          motivo: p.motivo,
          justificativa: p.justificativa,
          por: operador,
        },
        this.trilha(req, EVENTOS_AUDITAVEIS.perfilAlterado.codigo, 'acesso.alterarPerfil'),
      )
      .catch((e: unknown) => this.problema(e));
    if (r.situacao === 'inexistente')
      throw new ErroProblema('nao-encontrado', 404, 'Concessão não encontrada ou já revogada');
    if (r.situacao === 'a-si-mesmo')
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Operação recusada',
        'Ninguém altera o próprio perfil (segregação de funções).',
        { codigo: 'a-si-mesmo' },
      );
    return {
      alteracao: r.alteracao,
      operacao: 'acesso.alterarPerfil',
      invalidado: await this.invalidar(req, r.login),
      destino: this.fonte.destino,
    };
  }

  @Get('perfis/:id/alteracoes')
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  async alteracoesPerfil(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<AlteracaoPerfilTela[]> {
    if (!/^\d{1,18}$/.test(id)) throw new ErroProblema('nao-encontrado', 404, 'Concessão não encontrada');
    const { rede, hospital } = this.sessao(req);
    const lidas = await this.fonte.alteracoesPerfil(rede, hospital, id);
    return lidas.map((x) => ({
      id: x.id,
      inicioAntes: x.inicioAntes.toISOString(),
      fimAntes: x.fimAntes?.toISOString() ?? null,
      motivoAntes: x.motivoAntes,
      inicio: x.inicio.toISOString(),
      fim: x.fim?.toISOString() ?? null,
      motivo: x.motivo,
      justificativa: x.justificativa,
      alteradoPor: x.alteradoPor,
      alteradoEm: x.alteradoEm.toISOString(),
    }));
  }

  // ── Mapa ──────────────────────────────────────────────────────────────────────────────────────

  /**
   * W0-09: o que a decisão faria, ANTES de confirmar. Tirar uma aprovação (recusar ou voltar a 'proposta') conta,
   * usuário a usuário pelas origens efetivas (sem cache), quem perde: grupo → perfil, quem só tem o perfil por esse
   * grupo; perfil → permissão, quem só tem a permissão por esse perfil (a declarada no catálogo nunca sai).
   */
  private async previaMapa(
    rede: string,
    hospital: string,
    c: z.infer<typeof esquemaDecidirMapa>['chave'],
    situacao: z.infer<typeof esquemaDecidirMapa>['situacao'],
  ): Promise<PreviaMapaTela> {
    const linhas = await this.fonte.mapa(rede, hospital);
    const atual = linhas.find(
      (l) =>
        l.tipo === c.tipo &&
        l.perfil === c.perfil &&
        (c.tipo === 'grupo-perfil' ? l.grupo === c.grupo : l.permissao === c.permissao),
    );
    const situacaoAtual = atual?.situacao ?? null;
    const doCatalogo =
      c.tipo === 'perfil-permissao' &&
      CATALOGO_DECLARADO.some(
        (p) =>
          p.codigo === c.permissao &&
          p.concessaoPorPerfil === 'por-perfil' &&
          (p.perfis ?? []).includes(c.perfil),
      );
    const tira = situacaoAtual === 'aprovada' && situacao !== 'aprovada';
    // Revisão W0-09: toda mudança de uma linha que já existe exige o motivo (não só tirar uma aprovação).
    const base = {
      situacaoAtual,
      situacao,
      exigeMotivo: mapaMudaDecisao(situacaoAtual, situacao),
      doCatalogo,
    };
    if (!tira || doCatalogo) return { ...base, perdem: 0, amostra: [], limitado: false };
    const a = this.servico?.servicoAutorizacao;
    if (!a) throw new ErroProblema('indisponivel', 503, 'Serviço de permissões indisponível');
    const grupos =
      c.tipo === 'perfil-permissao' && c.perfil === 'assistencial-com-conselho'
        ? (await this.fonte.grupos(rede, hospital))
            .map((g) => g.nome)
            .filter((g) => {
              const d = destinoDoGrupo(g);
              return d.tipo === 'perfil' && d.assistencial;
            })
        : [];
    const papeis = Object.entries(PERFIL_DO_PAPEL)
      .filter(([, p]) => p === c.perfil)
      .map(([n]) => Number(n));
    const cand = await this.fonte.candidatosMapa(rede, hospital, {
      tipo: c.tipo,
      grupo: c.tipo === 'grupo-perfil' ? c.grupo : null,
      perfil: c.perfil,
      grupos,
      papeis,
    });
    const perdem: string[] = [];
    for (const login of cand.logins) {
      const r = await a.explicar(hospital, login);
      if (c.tipo === 'grupo-perfil') {
        const o = r.origensPerfis.get(c.perfil) ?? [];
        if (o.length === 1 && o[0] === 'grupo') perdem.push(login);
      } else {
        const o = r.origens.get(c.permissao) ?? [];
        if (o.length > 0 && o.every((x) => x.tipo === 'perfil' && x.perfil === c.perfil)) perdem.push(login);
      }
    }
    return { ...base, perdem: perdem.length, amostra: perdem.slice(0, 20), limitado: cand.limitado };
  }

  @Post('mapa/previa')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @Auditar(EVENTOS_AUDITAVEIS.mapaConsultado.codigo)
  async previa(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<PreviaMapaTela> {
    const p = this.analisar(esquemaPreviaMapa, corpo);
    const { rede, hospital } = this.sessao(req);
    if (!PERFIS_DA_TELA.includes(p.chave.perfil))
      throw new ErroProblema('entrada-invalida', 400, 'Perfil desconhecido');
    return this.previaMapa(rede, hospital, p.chave, p.situacao);
  }

  @Get('mapa/:id/decisoes')
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @Auditar(EVENTOS_AUDITAVEIS.mapaConsultado.codigo)
  async decisoes(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<DecisaoMapaTela[]> {
    if (!/^\d{1,18}$/.test(id)) throw new ErroProblema('nao-encontrado', 404, 'Linha do mapa não encontrada');
    const { rede, hospital } = this.sessao(req);
    return (await this.fonte.decisoesMapa(rede, hospital, id)).map((x) => ({
      id: x.id,
      situacaoAntes: x.situacaoAntes,
      aprovadoPorAntes: x.aprovadoPorAntes,
      situacao: x.situacao,
      motivo: x.motivo,
      usuariosAfetados: x.usuariosAfetados,
      decididoPor: x.decididoPor,
      decididoEm: x.decididoEm?.toISOString() ?? null,
    }));
  }

  @Post('mapa/decidir')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @AuditadoNoHandler('executor do núcleo: a gravação e a trilha na mesma transação (memória: registrador da API)')
  async decidirMapa(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoGestaoTela & { id: string }> {
    const p = this.analisar(esquemaDecidirMapa, corpo);
    const { rede, hospital, login: operador } = this.sessao(req);
    const c = p.chave;
    if (!PERFIS_DA_TELA.includes(c.perfil))
      throw new ErroProblema('entrada-invalida', 400, 'Perfil desconhecido');
    if (c.tipo === 'perfil-permissao' && !POR_PERFIL.has(c.permissao))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Permissão fora do mapa',
        'Só recurso concedido por perfil; as demais permissões vêm do grupo e do papel.',
      );
    await this.reautenticado(req, p.senha);
    if (
      c.tipo === 'grupo-perfil' &&
      !(await this.fonte.grupos(rede, hospital)).some((g) => g.nome === c.grupo)
    )
      throw new ErroProblema('nao-encontrado', 404, 'Grupo não encontrado');
    await this.naoNoProprioAcesso(rede, hospital, operador, c);
    // W0-09: mudar a decisão de uma linha que já existe exige o motivo; quem perde (ao tirar uma aprovação) vai junto
    // ao histórico da decisão.
    const previa = await this.previaMapa(rede, hospital, c, p.situacao);
    const motivo = p.motivo?.trim() ?? '';
    if (previa.exigeMotivo && motivo.length < 5) this.problema(new ErroMotivoMapa());
    const automatica =
      c.tipo === 'grupo-perfil' &&
      (() => {
        const d = destinoDoGrupo(c.grupo);
        return d.tipo === 'perfil' && d.perfil === c.perfil;
      })();
    const r = await this.fonte
      .decidirMapa(
        rede,
        hospital,
        {
          tipo: c.tipo,
          grupo: c.tipo === 'grupo-perfil' ? c.grupo : null,
          perfil: c.perfil,
          permissao: c.tipo === 'perfil-permissao' ? c.permissao : null,
          situacao: p.situacao,
          origem: automatica ? 'proposta-automatica' : 'revisao-area',
          por: operador,
          motivo: motivo || null,
          usuariosAfetados:
            previa.situacaoAtual === 'aprovada' && p.situacao !== 'aprovada' ? previa.perdem : null,
        },
        this.trilha(req, EVENTOS_AUDITAVEIS.mapaDecidido.codigo, 'acesso.decidirMapa'),
      )
      .catch((e: unknown) => this.problema(e));
    // O mapa vale para todo o grupo (ou todo o perfil): o estabelecimento inteiro recalcula.
    return {
      id: r.id,
      operacao: 'acesso.decidirMapa',
      invalidado: await this.invalidar(req, null),
      destino: this.fonte.destino,
    };
  }

  // ── W1-01 (parte 5): política de senha (por versão com vigência; só aperta a do estabelecimento) ──────────

  /** A versão em vigor no instante: a publicada de maior vigência já alcançada (empate: a de maior versão). */
  private static emVigor(
    vs: readonly VersaoPoliticaSenhaLida[],
    agora: number,
  ): VersaoPoliticaSenhaLida | null {
    return (
      vs
        .filter((v) => v.situacao === 'publicada' && (v.vigenteDesde?.getTime() ?? Infinity) <= agora)
        .sort(
          (a, b) =>
            (b.vigenteDesde?.getTime() ?? 0) - (a.vigenteDesde?.getTime() ?? 0) || b.versao - a.versao,
        )[0] ?? null
    );
  }

  @Get('politica-senha')
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @Auditar(EVENTOS_AUDITAVEIS.grupoConsultado.codigo)
  async politicaSenha(@Req() req: RequisicaoAutorizada): Promise<PoliticaSenhaGestaoTela> {
    const { rede, hospital } = this.sessao(req);
    if (!this.servico) throw new ErroProblema('indisponivel', 503, 'Política indisponível');
    const [config, versoes] = await Promise.all([
      this.servico.configDoEstabelecimento(rede, hospital),
      this.fonte.versoesPoliticaSenha(rede, hospital),
    ]);
    const agora = Date.now();
    const vigor = GestaoAcessoController.emVigor(versoes, agora);
    const efetiva = politicaEfetiva(config.senha, vigor);
    const estado = (v: VersaoPoliticaSenhaLida): VersaoPoliticaSenhaTela['estado'] =>
      v.situacao === 'cancelada'
        ? 'cancelada'
        : v === vigor
          ? 'em-vigor'
          : (v.vigenteDesde?.getTime() ?? 0) > agora
            ? 'agendada'
            : 'anterior';
    return {
      legado: {
        minimoCaracteres: config.senha.minimoCaracteres,
        exigeEspecial: config.senha.exigeEspecial,
        exigeMinuscula: config.senha.exigeMinuscula,
        exigeMaiuscula: config.senha.exigeMaiuscula,
        trocaDias: config.senha.periodoTrocaDias,
        reusoDias: config.senha.periodoReutilizacaoDias,
      },
      minimoDoNovo: MINIMO_DO_NOVO,
      efetiva: {
        minimoCaracteres: efetiva.minimoCaracteres,
        exigeEspecial: efetiva.exigeEspecial,
        exigeMinuscula: efetiva.exigeMinuscula,
        exigeMaiuscula: efetiva.exigeMaiuscula,
        trocaDias: efetiva.periodoTrocaDias,
        reusoDias: efetiva.periodoReutilizacaoDias,
        recusaNome: efetiva.recusaNome ?? false,
        recusaNascimento: efetiva.recusaNascimento ?? false,
        recusaComuns: efetiva.recusaComuns ?? false,
      },
      versoes: versoes.map((v) => ({
        versao: v.versao,
        minimoCaracteres: v.minimoCaracteres,
        exigeEspecial: v.exigeEspecial,
        exigeMinuscula: v.exigeMinuscula,
        exigeMaiuscula: v.exigeMaiuscula,
        trocaDias: v.trocaDias,
        reusoDias: v.reusoDias,
        recusaNome: v.recusaNome,
        recusaNascimento: v.recusaNascimento,
        recusaComuns: v.recusaComuns,
        senhasProibidas: [...v.senhasProibidas],
        vigenteDesde: v.vigenteDesde?.toISOString() ?? null,
        motivo: v.motivo,
        criadoPor: v.criadoPor,
        criadoEm: v.criadoEm?.toISOString() ?? null,
        estado: estado(v),
        canceladaEm: v.canceladaEm?.toISOString() ?? null,
        canceladaPor: v.canceladaPor,
        motivoCancelamento: v.motivoCancelamento,
      })),
    };
  }

  @Post('politica-senha')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @AuditadoNoHandler('executor do núcleo: a gravação e a trilha na mesma transação (memória: registrador da API)')
  async publicarPoliticaSenha(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{
    id: string;
    versao: number;
    anterior: number | null;
    diferenca: string[];
    operacao: string;
    destino: DestinoGestao;
  }> {
    const p = this.analisar(esquemaPublicarPoliticaSenha, corpo);
    const { rede, hospital, login: operador } = this.sessao(req);
    await this.reautenticado(req, p.senha);
    const r = await this.fonte
      .publicarPoliticaSenha(
        rede,
        hospital,
        {
          hospital,
          minimoCaracteres: p.minimoCaracteres,
          exigeEspecial: p.exigeEspecial,
          exigeMinuscula: p.exigeMinuscula,
          exigeMaiuscula: p.exigeMaiuscula,
          trocaDias: p.trocaDias,
          reusoDias: p.reusoDias,
          recusaNome: p.recusaNome,
          recusaNascimento: p.recusaNascimento,
          recusaComuns: p.recusaComuns,
          senhasProibidas: p.senhasProibidas,
          vigenteDesde: new Date(p.vigenteDesde),
          motivo: p.motivo,
          por: operador,
        },
        new Date(),
        this.trilha(req, EVENTOS_AUDITAVEIS.politicaSenhaPublicada.codigo, 'acesso.publicarPoliticaSenha'),
      )
      .catch((e: unknown) => this.problema(e));
    await this.servico?.esquecerPolitica(rede, hospital);
    return { ...r, operacao: 'acesso.publicarPoliticaSenha', destino: this.fonte.destino };
  }

  @Post('politica-senha/:versao/cancelar')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @AuditadoNoHandler('executor do núcleo: a gravação e a trilha na mesma transação (memória: registrador da API)')
  async cancelarPoliticaSenha(
    @Param('versao') bruto: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: string; versao: number; operacao: string; destino: DestinoGestao }> {
    const versao = Number(bruto);
    if (!/^\d{1,6}$/.test(bruto) || !Number.isInteger(versao) || versao < 1)
      throw new ErroProblema('entrada-invalida', 400, 'Versão inválida');
    const p = this.analisar(esquemaCancelarPoliticaSenha, corpo);
    const { rede, hospital, login: operador } = this.sessao(req);
    await this.reautenticado(req, p.senha);
    const r = await this.fonte
      .cancelarPoliticaSenha(
        rede,
        hospital,
        { versao, motivo: p.motivo, por: operador },
        new Date(),
        this.trilha(req, EVENTOS_AUDITAVEIS.politicaSenhaCancelada.codigo, 'acesso.cancelarPoliticaSenha'),
      )
      .catch((e: unknown) => this.problema(e));
    await this.servico?.esquecerPolitica(rede, hospital);
    return { ...r, operacao: 'acesso.cancelarPoliticaSenha', destino: this.fonte.destino };
  }

  // ── W1-01 (parte 8): limite de sessões simultâneas por perfil  ──

  @Get('limites-sessao')
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @Auditar(EVENTOS_AUDITAVEIS.grupoConsultado.codigo)
  async limitesSessao(@Req() req: RequisicaoAutorizada): Promise<LimitesSessaoGestaoTela> {
    const { rede, hospital } = this.sessao(req);
    const historico = await this.fonte.historicoLimitesSessao(rede, hospital);
    return {
      vigentes: Object.entries(limitesVigentes(historico))
        .map(([perfil, limite]) => ({ perfil, limite }))
        .sort((a, b) => a.perfil.localeCompare(b.perfil)),
      historico: historico.map((x) => ({
        perfil: x.perfil,
        limite: x.limite,
        situacao: x.situacao,
        motivo: x.motivo,
        criadoPor: x.criadoPor,
        criadoEm: x.criadoEm?.toISOString() ?? null,
      })),
      perfis: PERFIS_DA_TELA,
    };
  }

  @Post('limites-sessao')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @AuditadoNoHandler('executor do núcleo: a gravação e a trilha na mesma transação (memória: registrador da API)')
  async definirLimiteSessao(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{
    id: string;
    anterior: number | null;
    limite: number | null;
    operacao: string;
    destino: DestinoGestao;
  }> {
    const p = this.analisar(esquemaDefinirLimiteSessao, corpo);
    const { rede, hospital, login: operador } = this.sessao(req);
    if (p.perfil !== '*' && !PERFIS_DA_TELA.includes(p.perfil))
      throw new ErroProblema('entrada-invalida', 400, 'Perfil inválido', 'Escolha um perfil da lista.');
    await this.reautenticado(req, p.senha);
    const r = await this.fonte
      .definirLimiteSessao(
        rede,
        hospital,
        { hospital, perfil: p.perfil, limite: p.limite, motivo: p.motivo, por: operador },
        this.trilha(req, EVENTOS_AUDITAVEIS.limiteSessaoDefinido.codigo, 'acesso.definirLimiteSessao'),
      )
      .catch((e: unknown) => this.problema(e));
    await this.servico?.esquecerPolitica(rede, hospital);
    return { ...r, operacao: 'acesso.definirLimiteSessao', destino: this.fonte.destino };
  }

  // ── W1-01 (parte 4c): descrição do grupo (do Sante, por versão) ─────────────────────────────────

  @Get('grupos/:grupo/descricoes')
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @Auditar(EVENTOS_AUDITAVEIS.grupoConsultado.codigo)
  async descricoesGrupo(
    @Param('grupo') bruto: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<VersaoDescricaoGrupoTela[]> {
    const g = esquemaNomeGrupo.safeParse(bruto);
    if (!g.success) throw new ErroProblema('entrada-invalida', 400, 'Grupo inválido');
    const { rede, hospital } = this.sessao(req);
    return (await this.fonte.versoesDescricaoGrupo(rede, hospital, g.data)).map((v) => ({
      versao: v.versao,
      descricao: v.descricao,
      motivo: v.motivo,
      criadoPor: v.criadoPor,
      criadoEm: v.criadoEm?.toISOString() ?? null,
      situacao: v.situacao,
      encerradaEm: v.encerradaEm?.toISOString() ?? null,
    }));
  }

  @Post('grupos/descricao')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @AuditadoNoHandler('executor do núcleo: a gravação e a trilha na mesma transação (memória: registrador da API)')
  async descreverGrupo(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{
    id: string;
    versao: number;
    anterior: number | null;
    operacao: string;
    destino: DestinoGestao;
  }> {
    const p = this.analisar(esquemaDescreverGrupo, corpo);
    const { rede, hospital, login: operador } = this.sessao(req);
    await this.reautenticado(req, p.senha);
    if (!(await this.fonte.grupos(rede, hospital)).some((g) => g.nome === p.grupo))
      throw new ErroProblema('nao-encontrado', 404, 'Grupo não encontrado');
    const r = await this.fonte
      .descreverGrupo(
        rede,
        hospital,
        { grupo: p.grupo, descricao: p.descricao, motivo: p.motivo, por: operador },
        this.trilha(req, EVENTOS_AUDITAVEIS.grupoDescrito.codigo, 'acesso.descreverGrupo'),
      )
      .catch((e: unknown) => this.problema(e));
    return {
      id: r.id,
      versao: r.versao,
      anterior: r.anterior,
      // A descrição não muda permissão nenhuma: nada a invalidar no cache.
      operacao: 'acesso.descreverGrupo',
      destino: this.fonte.destino,
    };
  }

  // ── Operações da conta (bloquear, papéis de segurança); as de grupo são recusadas pela fonte ───────────

  @Post('operacoes/:operacao')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @AuditadoNoHandler('executor do núcleo: a gravação e a trilha na mesma transação (memória: registrador da API)')
  async executarOperacao(
    @Param('operacao') nome: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoGestao> {
    if (!(NOMES_OPERACOES_GESTAO as readonly string[]).includes(nome))
      throw new ErroProblema('nao-encontrado', 404, 'Operação não encontrada');
    const op = nome as OperacaoGestaoLegado;
    const p = this.analisar(esquemaPedidoGestaoLegado, corpo);
    const { rede, hospital, login } = this.sessao(req);
    const bruto = req.headers['idempotency-key'];
    const chave = Array.isArray(bruto) ? bruto[0] : bruto;
    if (typeof chave !== 'string' || !IDEMPOTENCIA.test(chave))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido incompleto',
        'Falta a Idempotency-Key do pedido de gravação.',
      );
    const receita = this.fonte.receita(op, hospital);
    if (!receita.ligada)
      throw new ErroProblema('operacao-bloqueada', 409, 'Operação desligada', receita.motivo ?? undefined, {
        codigo: 'operacao-desligada',
      });
    await this.ultimoGestor(op, rede, hospital, p.entrada);
    const reautenticadoEm = await this.reautenticado(req, p.senha);
    const ctx: ContextoGestao = {
      rede,
      hospital,
      usuario: login,
      correlacao: correlacaoDaRequisicao(req, 'acesso-gestao').slice(0, 64),
      chaveIdempotencia: chave,
      estacao: estacaoDaRequisicao(req).slice(0, 80),
      reautenticadoEm,
    };
    await this.fonte.executar(op, hospital, p.entrada, ctx).catch((e: unknown) => this.problema(e));
    const alvo =
      DO_USUARIO.has(op) && typeof (p.entrada as { login?: unknown })?.login === 'string'
        ? (p.entrada as { login: string }).login
        : null;
    return { operacao: op, invalidado: await this.invalidar(req, alvo), destino: this.fonte.destino };
  }

  @Post('cache/invalidar')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @Auditar(EVENTOS_AUDITAVEIS.cacheInvalidado.codigo)
  async invalidarCache(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoGestao> {
    const p = this.analisar(esquemaInvalidarCache, corpo);
    return {
      operacao: 'acesso.invalidarCache',
      invalidado: await this.invalidar(req, p.login ?? null),
      destino: this.fonte.destino,
    };
  }
}
