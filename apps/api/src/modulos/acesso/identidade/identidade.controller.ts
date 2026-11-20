// Rotas do M59-F2 (ficha do M59, seção 7): a situação das senhas e do segundo fator dos usuários, a política do segundo
// fator por onda, a retirada da senha antiga (executor do M04, desligada até a assinatura) e o segundo fator do próprio
// usuário (/preferencias/seguranca). Toda gravação vai à SGH_TRILHA na mesma transação (o repositório grava); as
// críticas exigem a reautenticação recente (SBIS-07). Nenhuma resposta leva senha, hash ou segredo, exceto o segredo
// TOTP novo, uma única vez, no início do cadastro (o aplicativo autenticador precisa dele).
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  esquemaAlterarPolitica2fa,
  esquemaEncerrarPolitica2fa,
  esquemaFiltroUsuariosIdentidade,
  esquemaLogin,
  esquemaNovaPolitica2fa,
  esquemaSegundoFatorPedido,
  EVENTOS_AUDITAVEIS,
  type MeuSegundoFator,
  type PaginaUsuariosIdentidade,
  PERMISSOES_ACESSO,
  PERMISSOES_M10_CODIGOS,
  PERMISSOES_M59_F2_CODIGOS,
  type Politica2fa,
  type ResumoIdentidade,
  type SegundoFatorInicio,
} from '@sgh/contratos';
import type { Alcance2fa } from '@sgh/dominio-acesso';
import { type ContextoOperacao, ErroOperacao } from '@sgh/legado';
import { z } from 'zod';
import { Auditar, AuditadoNoHandler, Permissao } from '../../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { exigirReautenticacaoOuSenha, reautenticar } from '../../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../../autorizacao/resolvedor-sessao.js';
import { ErroProblema, tipoPorStatus } from '../../../problema.filter.js';
import type { ServicoSessao } from '../../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso.controller.js';
import { type AtorIdentidade, ErroIdentidade, type ServicoIdentidade } from './servico-identidade.js';

export const SERVICO_IDENTIDADE = Symbol('SERVICO_IDENTIDADE');
/** A execução da receita do legado (o executor do M04, com o estado do catálogo por estabelecimento). */
export const EXECUTOR_IDENTIDADE = Symbol('EXECUTOR_IDENTIDADE');

export interface ExecutorIdentidade {
  receita(nome: string, hospital: string): { readonly ligada: boolean; readonly motivo: string | null };
  executar(nome: string, hospital: string, entrada: unknown, ctx: ContextoOperacao): Promise<void>;
}

const IDEMPOTENCIA = /^[A-Za-z0-9._:-]{8,80}$/;
const esquemaComSenha = <T extends z.ZodType>(e: T) =>
  z.object({ dados: e, senha: z.string().min(1).max(64) });
const esquemaAbrirOnda1 = z
  .object({
    inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD.'),
    prazoAdesaoDias: z.number().int().min(0).max(90),
    motivo: z.string().trim().min(5, 'Explique o motivo (5 caracteres ou mais).').max(200),
  })
  .strict();
const esquemaRetirada = z.object({ senha: z.string().min(1).max(64) }).strict();

@Controller()
export class IdentidadeController {
  constructor(
    @Inject(SERVICO_IDENTIDADE) private readonly identidade: ServicoIdentidade | null,
    @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    @Optional() @Inject(EXECUTOR_IDENTIDADE) private readonly executor: ExecutorIdentidade | null = null,
  ) {}

  private servico(): ServicoIdentidade {
    if (!this.identidade) throw new ErroProblema('indisponivel', 503, 'Serviço indisponível');
    return this.identidade;
  }

  private ator(req: RequisicaoAutorizada): AtorIdentidade & { alcance: Alcance2fa } {
    const s = req.sgh?.sessao;
    const id = Number(s?.usuario.id);
    if (!s?.rede || !s.estabelecimentoAtivo || !s.usuario.login || !Number.isInteger(id))
      throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    return {
      rede: s.rede,
      hospital: s.estabelecimentoAtivo,
      login: s.usuario.login,
      idUsuario: id,
      estacao: estacaoDaRequisicao(req).slice(0, 80),
      correlacao: correlacaoDaRequisicao(req, 'acesso-identidade'),
      alcance: {
        perfil: s.perfil?.perfil ?? null,
        complementares: s.perfil?.complementares ?? [],
        grupo: s.grupoLegado ?? null,
      },
    };
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

  private problema(e: unknown): never {
    if (e instanceof ErroProblema) throw e;
    if (e instanceof ErroIdentidade) {
      const tipo = e.status === 409 ? 'recusa-de-negocio' : tipoPorStatus(e.status);
      throw new ErroProblema(tipo, e.status, 'Não foi possível concluir', e.detalhe, {
        codigo: e.codigo,
      });
    }
    if (e instanceof ErroOperacao) {
      const p = e.problema;
      const tipo = p.status === 409 ? 'recusa-de-negocio' : tipoPorStatus(p.status);
      throw new ErroProblema(tipo, p.status, p.title, p.detail, {
        ...(p.codigo ? { codigo: p.codigo } : {}),
      });
    }
    throw e;
  }

  // ── gestão: situação das senhas e do segundo fator ──────────────────────────────────────────

  @Get('acesso/identidade/resumo')
  @Permissao(PERMISSOES_M10_CODIGOS.usuarioLer)
  @Auditar(EVENTOS_AUDITAVEIS.identidadeConsultada.codigo)
  async resumo(@Req() req: RequisicaoAutorizada): Promise<ResumoIdentidade> {
    const a = this.ator(req);
    return this.servico()
      .resumo(a.rede, a.hospital)
      .catch((e: unknown) => this.problema(e));
  }

  @Get('acesso/identidade/usuarios')
  @Permissao(PERMISSOES_M10_CODIGOS.usuarioLer)
  @Auditar(EVENTOS_AUDITAVEIS.identidadeConsultada.codigo)
  async usuarios(
    @Req() req: RequisicaoAutorizada,
    @Query() consulta: Record<string, string>,
  ): Promise<PaginaUsuariosIdentidade> {
    const a = this.ator(req);
    const f = this.analisar(esquemaFiltroUsuariosIdentidade, consulta ?? {});
    return this.servico()
      .usuarios(a.hospital, f)
      .catch((e: unknown) => this.problema(e));
  }

  // ── política do segundo fator ────────────────────────────────────────────────────────────────

  @Get('acesso/identidade/politica-2fa')
  @Permissao(PERMISSOES_M59_F2_CODIGOS.politica2faLer)
  @Auditar(EVENTOS_AUDITAVEIS.identidadeConsultada.codigo)
  async politicas(@Req() req: RequisicaoAutorizada): Promise<Politica2fa[]> {
    const a = this.ator(req);
    return this.servico()
      .politicas(a.hospital)
      .catch((e: unknown) => this.problema(e));
  }

  @Post('acesso/identidade/politica-2fa')
  @HttpCode(201)
  @Permissao(PERMISSOES_M59_F2_CODIGOS.politica2faEditar)
  @AuditadoNoHandler(
    'SGH_TRILHA na mesma transação da SGH_ACESSO_POLITICA_2FA (acesso.politicaSegundoFator.incluida)',
  )
  async incluirPolitica(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<Politica2fa> {
    const p = this.analisar(esquemaComSenha(esquemaNovaPolitica2fa), corpo);
    await reautenticar(this.sessoes, this.resolvedor, req, p.senha);
    return this.servico()
      .incluirPolitica(this.ator(req), p.dados)
      .catch((e: unknown) => this.problema(e));
  }

  /** Abre a onda 1 (perfis críticos e grupos administradores) de uma vez, com o mesmo início, prazo e motivo. */
  @Post('acesso/identidade/politica-2fa/onda-1')
  @HttpCode(200)
  @Permissao(PERMISSOES_M59_F2_CODIGOS.politica2faEditar)
  @AuditadoNoHandler(
    'SGH_TRILHA na mesma transação de cada linha da SGH_ACESSO_POLITICA_2FA (acesso.politicaSegundoFator.incluida)',
  )
  async abrirOnda1(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ incluidas: number; jaExistiam: number }> {
    const p = this.analisar(esquemaComSenha(esquemaAbrirOnda1), corpo);
    await reautenticar(this.sessoes, this.resolvedor, req, p.senha);
    return this.servico()
      .abrirOnda1(this.ator(req), p.dados)
      .catch((e: unknown) => this.problema(e));
  }

  /** W0-09: alterar o prazo e o alvo da linha vigente (a anterior fica encerrada como "Alterada"). */
  @Post('acesso/identidade/politica-2fa/:id/alteracao')
  @HttpCode(200)
  @Permissao(PERMISSOES_M59_F2_CODIGOS.politica2faEditar)
  @AuditadoNoHandler(
    'SGH_TRILHA na mesma transação das duas linhas da SGH_ACESSO_POLITICA_2FA (acesso.politicaSegundoFator.alterada)',
  )
  async alterarPolitica(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<Politica2fa> {
    if (!/^\d{1,18}$/.test(id)) throw new ErroProblema('entrada-invalida', 400, 'Linha inválida');
    const p = this.analisar(esquemaComSenha(esquemaAlterarPolitica2fa), corpo);
    await reautenticar(this.sessoes, this.resolvedor, req, p.senha);
    return this.servico()
      .alterarPolitica(this.ator(req), id, p.dados)
      .catch((e: unknown) => this.problema(e));
  }

  @Post('acesso/identidade/politica-2fa/:id/encerrar')
  @HttpCode(200)
  @Permissao(PERMISSOES_M59_F2_CODIGOS.politica2faEditar)
  @AuditadoNoHandler(
    'SGH_TRILHA na mesma transação da SGH_ACESSO_POLITICA_2FA (acesso.politicaSegundoFator.encerrada)',
  )
  async encerrarPolitica(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ encerrada: true }> {
    if (!/^\d{1,18}$/.test(id)) throw new ErroProblema('entrada-invalida', 400, 'Linha inválida');
    const p = this.analisar(esquemaComSenha(esquemaEncerrarPolitica2fa), corpo);
    await reautenticar(this.sessoes, this.resolvedor, req, p.senha);
    await this.servico()
      .encerrarPolitica(this.ator(req), id, p.dados.motivo)
      .catch((e: unknown) => this.problema(e));
    return { encerrada: true };
  }

  // ── segundo fator de outro usuário (gestor de acessos: troca de aparelho) ───────────────────

  @Post('acesso/identidade/usuarios/:login/segundo-fator/revogar')
  @HttpCode(200)
  @Permissao(PERMISSOES_M59_F2_CODIGOS.politica2faEditar)
  @AuditadoNoHandler(
    'SGH_TRILHA na mesma transação da SGH_ACESSO_SEGUNDO_FATOR (acesso.segundofator.revogado)',
  )
  async revogarDeOutro(
    @Param('login') bruto: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ revogado: true }> {
    const login = this.analisar(esquemaLogin, bruto);
    const p = this.analisar(esquemaRetirada, corpo);
    await reautenticar(this.sessoes, this.resolvedor, req, p.senha);
    await this.servico()
      .revogarDeOutro(this.ator(req), login)
      .catch((e: unknown) => this.problema(e));
    return { revogado: true };
  }

  // ── retirada da senha antiga (acesso.retirarSenhaLegado) ─────────────────────────────────────

  @Post('acesso/identidade/usuarios/:login/retirar-senha-antiga')
  @HttpCode(200)
  @Permissao(PERMISSOES_M59_F2_CODIGOS.senhaLegadoRetirar)
  @AuditadoNoHandler('executor: TBCABTRILHA como o Delphi e SGH_TRILHA na mesma transação da receita')
  async retirarSenha(
    @Param('login') bruto: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ retirada: true }> {
    const login = this.analisar(esquemaLogin, bruto);
    const p = this.analisar(esquemaRetirada, corpo);
    const chaveBruta = req.headers['idempotency-key'];
    const chave = Array.isArray(chaveBruta) ? chaveBruta[0] : chaveBruta;
    if (typeof chave !== 'string' || !IDEMPOTENCIA.test(chave))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido incompleto',
        'Falta a Idempotency-Key do pedido.',
      );
    const a = this.ator(req);
    // Regra 1: a contingência e a credencial forte antes de tudo (o executor confere de novo na transação).
    await this.servico()
      .conferirRetirada(a, login)
      .catch((e: unknown) => this.problema(e));
    if (!this.executor) throw new ErroProblema('indisponivel', 503, 'Serviço indisponível');
    const receita = this.executor.receita('acesso.retirarSenhaLegado', a.hospital);
    if (!receita.ligada)
      throw new ErroProblema('operacao-bloqueada', 409, 'Operação desligada', receita.motivo ?? undefined, {
        codigo: 'operacao-desligada',
      });
    const reautenticadoEm = await reautenticar(this.sessoes, this.resolvedor, req, p.senha);
    await this.executor
      .executar(
        'acesso.retirarSenhaLegado',
        a.hospital,
        { login },
        {
          rede: a.rede,
          hospital: a.hospital,
          traceId: a.correlacao,
          usuarioLegado: a.login,
          idempotencyKey: chave,
          ...(a.estacao ? { estacao: a.estacao } : {}),
          reautenticadoEm,
        },
      )
      .catch((e: unknown) => this.problema(e));
    return { retirada: true };
  }

  // ── o próprio segundo fator (/preferencias/seguranca) ───────────────────────────────────────

  @Get('sessao/segundo-fator')
  @Permissao(PERMISSOES_ACESSO.segundoFatorGerir)
  async meu(@Req() req: RequisicaoAutorizada): Promise<MeuSegundoFator> {
    const a = this.ator(req);
    return this.servico()
      .meuSegundoFator(a, a.alcance)
      .catch((e: unknown) => this.problema(e));
  }

  /** POST /api/sessao/segundo-fator: sem código, inicia (segredo e URI; exige reautenticação recente ou a senha); com o código, confirma. */
  @Post('sessao/segundo-fator')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.segundoFatorGerir)
  @AuditadoNoHandler('SGH_TRILHA na mesma transação da SGH_ACESSO_SEGUNDO_FATOR (iniciado ou confirmado)')
  async cadastrar(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<SegundoFatorInicio | { confirmado: true }> {
    const p = this.analisar(esquemaSegundoFatorPedido, corpo ?? {});
    const a = this.ator(req);
    if (p.codigo) {
      await this.servico()
        .confirmarCadastro(a, p.codigo)
        .catch((e: unknown) => this.problema(e));
      return { confirmado: true };
    }
    // Iniciar troca o segredo do autenticador: crítico (SBIS-07), como era na rota anterior.
    await exigirReautenticacaoOuSenha(this.sessoes, this.resolvedor, req, p.senha);
    return this.servico()
      .iniciarCadastro(a)
      .catch((e: unknown) => this.problema(e));
  }

  /** DELETE /api/sessao/segundo-fator: remove o próprio (só quando a política não exige), com a senha confirmada. */
  @Delete('sessao/segundo-fator')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.segundoFatorGerir)
  @AuditadoNoHandler(
    'SGH_TRILHA na mesma transação da SGH_ACESSO_SEGUNDO_FATOR (acesso.segundofator.removido)',
  )
  async remover(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<{ removido: true }> {
    const p = this.analisar(esquemaRetirada, corpo);
    await reautenticar(this.sessoes, this.resolvedor, req, p.senha);
    const a = this.ator(req);
    await this.servico()
      .removerProprio(a, a.alcance)
      .catch((e: unknown) => this.problema(e));
    return { removido: true };
  }
}
