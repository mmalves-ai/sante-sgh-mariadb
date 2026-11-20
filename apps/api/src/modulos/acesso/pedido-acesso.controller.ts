// W1-01 (parte 10b): API do PEDIDO DE ACESSO (tela 403 → aprovação em dois níveis → concessão com início e fim).
//   GET  /api/acesso/pedidos                       os pedidos da própria pessoa e os perfis que ela pode pedir
//   POST /api/acesso/pedidos                       pedir {perfil, setor, inicio, fim, motivo}
//   POST /api/acesso/pedidos/:id/cancelar          cancelar o próprio pedido antes da concessão {motivo, senha}
//   GET  /api/acesso/gestao/pedidos                os pedidos do estabelecimento (em andamento primeiro)
//   POST /api/acesso/gestao/pedidos/:id/decisao    aprovar ou recusar o nível que o pedido espera {decisao, motivo, senha}
//   POST /api/acesso/gestao/pedidos/:id/conceder   reaplicar a concessão do pedido 'aprovado' sem concessão {senha}
// A regra é a do domínio (pedido-acesso.ts); a gravação, a da SGH_ 1207 com a trilha na mesma transação. Aprovado o
// 2º nível, a concessão do perfil (SGH_ACESSO_PERFIL_USUARIO com INICIO e FIM; CONCEDIDO_POR = quem aprovou o 2º
// nível; AREA_APROVOU = o setor) e a anotação no pedido correm na MESMA transação SGH_ da decisão (revisão, achado 2):
// se algo falhar, nada fica gravado e o pedido segue 'aprovado-setor'. 'aprovado' não se cancela.
// D-W101-34 (o dono confirma): não há cadastro de "gestor do setor" (SGH_ACESSO_ESCOPO_SETOR é o escopo de quem usa o
// setor, não de quem o chefia): o 1º nível cabe a um gestor de acessos e o 2º a OUTRO gestor de acessos. Quando o
// cadastro existir, entra em `papeisDoAprovador`. O perfil `assistencial-com-conselho` não se pede (vem da categoria
// com conselho do profissional).
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import {
  type DecisaoPedidoAcessoTela,
  EVENTOS_AUDITAVEIS,
  esquemaCancelarPedidoAcesso,
  esquemaConcederPedidoAcesso,
  esquemaDecidirPedidoAcesso,
  esquemaNovoPedidoAcesso,
  type MeusPedidosAcessoTela,
  PERMISSOES_ACESSO,
  type PedidoAcessoTela,
  type PedidosAcessoGestaoTela,
  type SetorPedidoTela,
} from '@sgh/contratos';
import {
  concessaoDoPedido,
  nivelDoPedido,
  type PapeisAprovador,
  PERIODO_PEDIDO_MAXIMO_DIAS,
  PEDIDO_EM_ANDAMENTO,
  validarCancelamentoPedidoAcesso,
  validarDecisaoPedidoAcesso,
  validarNovoPedidoAcesso,
} from '@sgh/dominio-acesso';
import { ErroOperacao, type PedidoAcessoGravado, type TrilhaGestao } from '@sgh/legado';
import type { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema, tipoPorStatus } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { FONTE_ADMINISTRACAO, type FonteAdministracao } from '../administracao/fonte.js';
import { SERVICO_SESSAO } from './acesso.controller.js';
import { FONTE_GESTAO, type FonteGestao } from './gestao-fonte.js';
import { PERFIS_DA_TELA } from './gestao.controller.js';

const FUSO = 'America/Sao_Paulo';
/** Perfis que não se pedem (D-W101-34): o assistencial vem da categoria com conselho do profissional. */
export const PERFIS_NAO_PEDIVEIS: readonly string[] = ['assistencial-com-conselho'];
export const PERFIS_PEDIVEIS: readonly string[] = PERFIS_DA_TELA.filter(
  (p) => !PERFIS_NAO_PEDIVEIS.includes(p),
);

const iso = (d: Date | null) => d?.toISOString() ?? null;
/** 00:00 do dia (AAAA-MM-DD) no fuso do estabelecimento (sem horário de verão desde 2019). */
export const inicioDoDia = (d: string) => new Date(`${d}T00:00:00-03:00`);

export const pedidoTela = (p: PedidoAcessoGravado): PedidoAcessoTela => ({
  id: p.id,
  login: p.login,
  perfil: p.perfil,
  setor: p.setor,
  inicio: p.inicio,
  fim: p.fim,
  motivo: p.motivo,
  situacao: p.situacao,
  nivel: nivelDoPedido(p.situacao),
  criadoEm: iso(p.criadoEm),
  setorPor: p.setorPor,
  setorEm: iso(p.setorEm),
  acessosPor: p.acessosPor,
  acessosEm: iso(p.acessosEm),
  fechadoPor: p.fechadoPor,
  fechadoEm: iso(p.fechadoEm),
  motivoFechamento: p.motivoFechamento,
  concessao: p.concessao,
});

/** O que os dois controladores compartilham (sessão, erro, trilha, relógio). */
abstract class BasePedidos {
  /** O relógio (os testes simulam o tempo). */
  agora: () => number = () => Date.now();

  constructor(
    protected readonly fonte: FonteGestao,
    protected readonly sessoes: ServicoSessao | null,
    protected readonly resolvedor: ResolvedorSessao,
    protected readonly estrutura: FonteAdministracao | null = null,
  ) {}

  /** Parte 10c: os setores (blocos) do estabelecimento para o combo com busca; sem a fonte ou com falha, lista vazia. */
  protected async setores(rede: string, hospital: string): Promise<SetorPedidoTela[]> {
    if (!this.estrutura) return [];
    try {
      const l = await this.estrutura.leitos({ rede, hospital, traceId: 'acesso-pedidos' });
      return l.blocos
        .map((b) => ({ valor: b.bloco.trim(), rotulo: b.nome.trim() || b.bloco.trim() }))
        .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
    } catch {
      return [];
    }
  }

  protected hoje(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date(this.agora()));
  }

  protected sessao(req: RequisicaoAutorizada): { rede: string; hospital: string; login: string } {
    const s = req.sgh?.sessao;
    if (!s?.rede || !s.estabelecimentoAtivo || !s.usuario.login)
      throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    return { rede: s.rede, hospital: s.estabelecimentoAtivo, login: s.usuario.login };
  }

  protected analisar<T extends z.ZodType>(esquema: T, corpo: unknown): z.infer<T> {
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

  protected problema(e: unknown): never {
    if (e instanceof ErroProblema) throw e;
    if (e instanceof ErroOperacao) {
      const p = e.problema;
      const tipo = p.status === 409 ? 'recusa-de-negocio' : tipoPorStatus(p.status);
      throw new ErroProblema(tipo, p.status, p.title, p.detail, p.codigo ? { codigo: p.codigo } : {});
    }
    throw e;
  }

  protected recusa(codigo: string, mensagem: string): never {
    throw new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', mensagem, { codigo });
  }

  protected trilha(req: RequisicaoAutorizada, evento: string, operacao: string): TrilhaGestao {
    const { rede, hospital, login } = this.sessao(req);
    return {
      rede,
      hospital,
      usuario: login,
      evento,
      recurso: 'acesso.usuario',
      operacao,
      resultado: 'sucesso',
      estacao: estacaoDaRequisicao(req).slice(0, 80),
      correlacao: correlacaoDaRequisicao(req, 'acesso-pedido').slice(0, 64),
    };
  }

  protected id(bruto: string): string {
    if (!/^\d{1,18}$/.test(bruto)) throw new ErroProblema('nao-encontrado', 404, 'Pedido não encontrado');
    return bruto;
  }

  protected async pedido(rede: string, hospital: string, id: string): Promise<PedidoAcessoGravado> {
    const p = await this.fonte.pedidoAcesso(rede, hospital, id).catch((e: unknown) => this.problema(e));
    if (!p) throw new ErroProblema('nao-encontrado', 404, 'Pedido não encontrado');
    return p;
  }

  /** Perfis SGH_ vigentes da conta agora (concessões não revogadas dentro do período). */
  protected async perfisVigentes(rede: string, hospital: string, login: string): Promise<string[]> {
    const agora = this.agora();
    const hist = await this.fonte
      .historicoPerfis(rede, hospital, login)
      .catch((e: unknown) => this.problema(e));
    return [
      ...new Set(
        hist
          .filter((x) => !x.revogadoEm && x.inicio.getTime() <= agora && (!x.fim || x.fim.getTime() > agora))
          .map((x) => x.perfil),
      ),
    ];
  }
}

@Controller('acesso/pedidos')
export class PedidosAcessoController extends BasePedidos {
  constructor(
    @Inject(FONTE_GESTAO) fonte: FonteGestao,
    @Inject(SERVICO_SESSAO) sessoes: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) resolvedor: ResolvedorSessao,
    @Optional() @Inject(FONTE_ADMINISTRACAO) estrutura: FonteAdministracao | null = null,
  ) {
    super(fonte, sessoes, resolvedor, estrutura);
  }

  @Get()
  @Permissao(PERMISSOES_ACESSO.preferenciaLer)
  @Auditar(EVENTOS_AUDITAVEIS.grupoConsultado.codigo)
  async meus(@Req() req: RequisicaoAutorizada): Promise<MeusPedidosAcessoTela> {
    const { rede, hospital, login } = this.sessao(req);
    const [lidos, vigentes, setores] = await Promise.all([
      this.fonte.pedidosAcesso(rede, hospital, { login }).catch((e: unknown) => this.problema(e)),
      this.perfisVigentes(rede, hospital, login),
      this.setores(rede, hospital),
    ]);
    return {
      hoje: this.hoje(),
      periodoMaximoDias: PERIODO_PEDIDO_MAXIMO_DIAS,
      perfis: PERFIS_PEDIVEIS.filter((p) => !vigentes.includes(p)),
      setores,
      pedidos: lidos.map(pedidoTela),
    };
  }

  @Post()
  @HttpCode(201)
  @Permissao(PERMISSOES_ACESSO.preferenciaEditar)
  @AuditadoNoHandler('SGH_ACESSO_PEDIDO e SGH_TRILHA na mesma transação SGH_ (memória: registrador da API)')
  async pedir(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: string; destino: 'legado' | 'memoria' }> {
    const p = this.analisar(esquemaNovoPedidoAcesso, corpo);
    const { rede, hospital, login } = this.sessao(req);
    const hoje = this.hoje();
    const u = await this.fonte.usuario(rede, hospital, login).catch((e: unknown) => this.problema(e));
    const [vigentes, emAndamento] = await Promise.all([
      this.perfisVigentes(rede, hospital, login),
      this.fonte
        .pedidosAcesso(rede, hospital, { login, situacoes: PEDIDO_EM_ANDAMENTO })
        .catch((e: unknown) => this.problema(e)),
    ]);
    const novo = { login, perfil: p.perfil, setor: p.setor, inicio: p.inicio, fim: p.fim, motivo: p.motivo };
    const r = validarNovoPedidoAcesso(novo, {
      hoje,
      contaAtiva: !!u && u.ativo && !u.bloqueado,
      perfisConhecidos: PERFIS_PEDIVEIS,
      perfisVigentes: vigentes,
      perfisEmAndamento: emAndamento.map((x) => x.perfil),
    });
    if (r) this.recusa(r.codigo, r.mensagem);
    const g = await this.fonte
      .pedirAcesso(
        rede,
        hospital,
        { hospital, ...novo, hoje },
        this.trilha(req, EVENTOS_AUDITAVEIS.pedidoAcessoCriado.codigo, 'acesso.pedirAcesso'),
      )
      .catch((e: unknown) => this.problema(e));
    return { id: g.id, destino: this.fonte.destino };
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.preferenciaEditar)
  @AuditadoNoHandler('SGH_ACESSO_PEDIDO e SGH_TRILHA na mesma transação SGH_ (memória: registrador da API)')
  async cancelar(
    @Param('id') bruto: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: string; situacao: 'cancelado'; destino: 'legado' | 'memoria' }> {
    const id = this.id(bruto);
    const p = this.analisar(esquemaCancelarPedidoAcesso, corpo);
    const { rede, hospital, login } = this.sessao(req);
    const x = await this.pedido(rede, hospital, id);
    // O pedido de outra pessoa não se revela a quem não é gestor: responde como inexistente.
    if (x.login.trim().toUpperCase() !== login.trim().toUpperCase())
      throw new ErroProblema('nao-encontrado', 404, 'Pedido não encontrado');
    const r = validarCancelamentoPedidoAcesso(x, login, p.motivo);
    if (r) this.recusa(r.codigo, r.mensagem);
    await reautenticar(this.sessoes, this.resolvedor, req, p.senha);
    await this.fonte
      .cancelarPedidoAcesso(
        rede,
        hospital,
        id,
        p.motivo,
        login,
        this.trilha(req, EVENTOS_AUDITAVEIS.pedidoAcessoCancelado.codigo, 'acesso.cancelarPedidoAcesso'),
      )
      .catch((e: unknown) => this.problema(e));
    return { id, situacao: 'cancelado', destino: this.fonte.destino };
  }
}

@Controller('acesso/gestao/pedidos')
export class PedidosAcessoGestaoController extends BasePedidos {
  constructor(
    @Inject(FONTE_GESTAO) fonte: FonteGestao,
    @Inject(SERVICO_SESSAO) sessoes: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) resolvedor: ResolvedorSessao,
    @Optional() @Inject(FONTE_ADMINISTRACAO) estrutura: FonteAdministracao | null = null,
  ) {
    super(fonte, sessoes, resolvedor, estrutura);
  }

  /** D-W101-34: os papéis de quem decide (sem cadastro de gestor de setor, o 1º nível é do gestor de acessos). */
  protected async papeisDoAprovador(rede: string, hospital: string, login: string): Promise<PapeisAprovador> {
    const gestores = await this.fonte.gestoresAcesso(rede, hospital).catch(() => {
      throw new ErroProblema(
        'indisponivel',
        503,
        'Não foi possível conferir os gestores de acessos do estabelecimento; tente de novo.',
      );
    });
    const eu = login.trim().toUpperCase();
    const gestor = gestores.find((g) => g.login.trim().toUpperCase() === eu);
    const gestorAcessos =
      !!gestor &&
      (gestor.papelGestor ||
        gestor.concessoes.length > 0 ||
        (gestor.grupo ?? '').toUpperCase().includes('MASTER'));
    return { gestorDoSetor: false, gestorAcessos, setorTemGestor: false };
  }

  @Get()
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @Auditar(EVENTOS_AUDITAVEIS.grupoConsultado.codigo)
  async listar(@Req() req: RequisicaoAutorizada): Promise<PedidosAcessoGestaoTela> {
    const { rede, hospital } = this.sessao(req);
    const [lidos, setores] = await Promise.all([
      this.fonte.pedidosAcesso(rede, hospital).catch((e: unknown) => this.problema(e)),
      this.setores(rede, hospital),
    ]);
    const andando = (p: PedidoAcessoGravado) => (PEDIDO_EM_ANDAMENTO.includes(p.situacao) ? 0 : 1);
    return {
      hoje: this.hoje(),
      pedidos: [...lidos].sort((a, b) => andando(a) - andando(b)).map(pedidoTela),
      setorSemGestor: true,
      setores,
    };
  }

  @Post(':id/decisao')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @AuditadoNoHandler(
    'SGH_ACESSO_PEDIDO e SGH_TRILHA na transação SGH_; 2º nível aprovado: SGH_ACESSO_PERFIL_USUARIO (concederPerfil) e a anotação no pedido',
  )
  async decidir(
    @Param('id') bruto: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DecisaoPedidoAcessoTela> {
    const id = this.id(bruto);
    const p = this.analisar(esquemaDecidirPedidoAcesso, corpo);
    const { rede, hospital, login: operador } = this.sessao(req);
    const hoje = this.hoje();
    // A regra responde antes da senha e antes de gravar.
    const x = await this.pedido(rede, hospital, id);
    const papeis = await this.papeisDoAprovador(rede, hospital, operador);
    const validar = (lido: PedidoAcessoGravado) =>
      validarDecisaoPedidoAcesso(lido, p.decisao, p.motivo, operador, papeis, hoje);
    const r = validar(x);
    if (r) this.recusa(r.codigo, r.mensagem);
    const segundoNivel = x.situacao === 'aprovado-setor' && p.decisao === 'aprovar';
    const conta = segundoNivel
      ? await this.fonte.usuario(rede, hospital, x.login).catch((e: unknown) => this.problema(e))
      : null;
    if (segundoNivel && (!conta || !conta.ativo || conta.bloqueado))
      this.recusa('conta-inativa', 'A conta do solicitante está inativa ou bloqueada: recuse o pedido.');
    await reautenticar(this.sessoes, this.resolvedor, req, p.senha);
    // Revisão (achado 2): no 2º nível, decisão + concessão + anotação numa só transação SGH_ (falhou, nada fica).
    const c = segundoNivel && conta ? concessaoDoPedido(id, x, hoje) : null;
    const d = await this.fonte
      .decidirPedidoAcesso(
        rede,
        hospital,
        { hospital, pedido: id, decisao: p.decisao, motivo: p.motivo, por: operador },
        this.trilha(req, EVENTOS_AUDITAVEIS.pedidoAcessoDecidido.codigo, 'acesso.decidirPedidoAcesso'),
        validar,
        c && conta
          ? {
              concessao: {
                idUsuario: conta.id,
                login: conta.login,
                perfil: c.perfil,
                concedidoPor: operador,
                areaAprovou: c.areaAprovou,
                inicio: inicioDoDia(c.inicio),
                fim: inicioDoDia(c.fim),
                motivo: c.motivo,
              },
              trilhaConcessao: this.trilha(
                req,
                EVENTOS_AUDITAVEIS.perfilConcedido.codigo,
                'acesso.concederPerfil',
              ),
              trilhaAnotacao: this.trilha(
                req,
                EVENTOS_AUDITAVEIS.pedidoAcessoConcedido.codigo,
                'acesso.concederPedidoAcesso',
              ),
            }
          : undefined,
      )
      .catch((e: unknown) => this.problema(e));
    if (d.situacao !== 'concedido' || !d.concessao) {
      return { id, situacao: d.situacao, concessao: null, destino: this.fonte.destino };
    }
    const concessao = d.concessao;
    await this.sessoes?.servicoAutorizacao?.invalidar(rede, hospital, x.login).catch(() => undefined);
    return { id, situacao: 'concedido', concessao, destino: this.fonte.destino };
  }

  /**
   * Revisão (achado do pedido preso): o pedido 'aprovado' nos dois níveis que ficou SEM concessão (gravado antes da
   * transação única ou com a concessão falha) recebe agora o perfil com o início e o fim do pedido e a anotação, numa
   * só transação SGH_. Quem concede não pode ser o solicitante; a conta tem de estar ativa.
   */
  @Post(':id/conceder')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @AuditadoNoHandler(
    'SGH_ACESSO_PERFIL_USUARIO (concederPerfil) e a anotação no SGH_ACESSO_PEDIDO na mesma transação SGH_, com a trilha',
  )
  async conceder(
    @Param('id') bruto: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DecisaoPedidoAcessoTela> {
    const id = this.id(bruto);
    const p = this.analisar(esquemaConcederPedidoAcesso, corpo);
    const { rede, hospital, login: operador } = this.sessao(req);
    const hoje = this.hoje();
    const x = await this.pedido(rede, hospital, id);
    if (x.situacao !== 'aprovado' || x.concessao)
      this.recusa(
        'pedido-nao-aprovado',
        'Só o pedido aprovado nos dois níveis e ainda sem concessão recebe a concessão.',
      );
    if (x.login.trim().toUpperCase() === operador.trim().toUpperCase())
      this.recusa('decidir-a-si', 'Ninguém concede o próprio pedido de acesso.');
    const papeis = await this.papeisDoAprovador(rede, hospital, operador);
    if (!papeis.gestorAcessos)
      this.recusa('sem-papel', 'Só um gestor de acessos concede o perfil do pedido.');
    const conta = await this.fonte.usuario(rede, hospital, x.login).catch((e: unknown) => this.problema(e));
    if (!conta || !conta.ativo || conta.bloqueado)
      this.recusa(
        'conta-inativa',
        'A conta do solicitante está inativa ou bloqueada: o perfil não é concedido.',
      );
    await reautenticar(this.sessoes, this.resolvedor, req, p.senha);
    const c = concessaoDoPedido(id, x, hoje);
    const r = await this.fonte
      .concederPedidoAprovado(rede, hospital, id, {
        concessao: {
          idUsuario: conta.id,
          login: conta.login,
          perfil: c.perfil,
          concedidoPor: operador,
          areaAprovou: c.areaAprovou,
          inicio: inicioDoDia(c.inicio),
          fim: inicioDoDia(c.fim),
          motivo: c.motivo,
        },
        trilhaConcessao: this.trilha(req, EVENTOS_AUDITAVEIS.perfilConcedido.codigo, 'acesso.concederPerfil'),
        trilhaAnotacao: this.trilha(
          req,
          EVENTOS_AUDITAVEIS.pedidoAcessoConcedido.codigo,
          'acesso.concederPedidoAcesso',
        ),
      })
      .catch((e: unknown) => this.problema(e));
    await this.sessoes?.servicoAutorizacao?.invalidar(rede, hospital, x.login).catch(() => undefined);
    return { id, situacao: 'concedido', concessao: r.concessao, destino: this.fonte.destino };
  }
}
