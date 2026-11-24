// Família acesso-ligacao (modulos-proprios-3): as rotas da entrada por e-mail.
//   - "Esqueci a senha" do administrador da plataforma (pedido pelo e-mail, resposta sempre igual; o link de uso único
//     vira a senha provisória com troca obrigatória);
//   - a escolha do segundo fator da própria conta (aplicativo ou código no e-mail), com a senha conferida há pouco e o
//     CSRF, para o usuário do cliente e para o administrador da plataforma.
// O token, o código e a senha nunca vão a log nem a trilha; a senha provisória volta só a quem tem o link.
import { Body, Controller, Get, HttpCode, Inject, Optional, Post, Req } from '@nestjs/common';
import { PERMISSOES_ACESSO } from '@sgh/contratos';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao, Publica } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import { CONFIGURACAO, type Configuracao } from '../../configuracao.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicosAcessoEmail } from '../../sessao/acesso-email-proprio.js';
import { SERVICOS_ACESSO_EMAIL } from '../../sessao/acesso-email-tardio.js';
import { METODOS_SEGUNDO_FATOR, type MetodoSegundoFator } from '../../sessao/codigo-email.js';
import { CABECALHO_CSRF, COOKIE_CSRF, lerCookie, lerCookieSessao } from '../../sessao/cookies.js';
import type { ResolvedorRede } from '../../sessao/rede.js';
import { ErroSessao, type Registro, type ServicoSessao } from '../../sessao/servico-sessao.js';
import { RESOLVEDOR_REDE, SERVICO_SESSAO } from './acesso.controller.js';
import { problemaDoAcessoEmail } from './acesso-email-erros.js';

interface Req {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly ip?: string;
}

const esquemaPedidoPlataforma = z.object({ email: z.string().trim().min(3).max(254) });
const esquemaUsarPlataforma = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const esquemaEscolherMetodo = z.object({ metodo: z.enum(METODOS_SEGUNDO_FATOR) });

export interface MetodoSegundoFatorTela {
  readonly metodo: MetodoSegundoFator;
  /** O código por e-mail pode ser escolhido (envio de e-mail montado). */
  readonly emailDisponivel: boolean;
}

const AMBIENTES_SEM_PREFIXO = new Set(['dev', 'ci']);

/**
 * O código no e-mail NÃO cumpre a exigência do aplicativo autenticador do perfil (nem no prazo de adesão) e não
 * substitui o aplicativo já cadastrado (nunca se troca por um fator mais fraco). A entrada aplica a mesma regra
 * (ServicoSessao: o e-mail vale só onde a política deixa entrar sem o código do aplicativo). null: pode escolher.
 */
export function recusaEmailPelaPolitica(reg: Pick<Registro, 'segundoFator'>): string | null {
  const sf = reg.segundoFator;
  if (!sf) return null;
  if (sf.exigencia !== 'opcional')
    return 'O seu perfil exige o código do aplicativo autenticador; o código no e-mail não o substitui.';
  if (sf.cadastrado)
    return 'Você já usa o aplicativo autenticador; o código no e-mail não o substitui. Remova o aplicativo antes.';
  return null;
}

@Controller()
export class AcessoEmailController {
  constructor(
    @Inject(CONFIGURACAO) private readonly configuracao: Configuracao,
    @Inject(SERVICO_SESSAO) private readonly sessao: ServicoSessao | null,
    @Inject(RESOLVEDOR_REDE) private readonly resolvedor: ResolvedorRede,
    @Optional()
    @Inject(SERVICOS_ACESSO_EMAIL)
    private readonly servicos: ServicosAcessoEmail | null = null,
  ) {}

  private get prefixoHost(): boolean {
    return !AMBIENTES_SEM_PREFIXO.has(this.configuracao.ambiente);
  }

  private rede(req: Req): string | null {
    const host = req.headers['host'];
    return this.resolvedor.resolver(Array.isArray(host) ? host[0] : host);
  }

  private plataforma() {
    const p = this.servicos?.recuperacaoPlataforma;
    if (!p) throw new ErroProblema('indisponivel', 503, 'Serviço indisponível');
    return p;
  }

  private erro(e: unknown): never {
    const p = problemaDoAcessoEmail(e);
    if (p) throw p;
    if (e instanceof ErroSessao) {
      if (e.tipo === 'reautenticacao-necessaria')
        throw new ErroProblema('reautenticacao-necessaria', 401, 'Confirme a senha', e.detalhe);
      if (e.tipo === 'indisponivel') throw new ErroProblema('indisponivel', 503, 'Serviço indisponível');
      throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária', e.detalhe);
    }
    if (e instanceof Error && e.name === 'ErroOperacao') {
      const pr = (
        e as Error & { problema: { status: number; title: string; detail?: string; codigo?: string } }
      ).problema;
      if (pr.status === 409)
        throw new ErroProblema(
          'recusa-de-negocio',
          409,
          pr.title,
          pr.detail,
          pr.codigo ? { codigo: pr.codigo } : {},
        );
    }
    throw e;
  }

  /** A sessão do pedido, com o CSRF conferido quando a rota muda estado. */
  private async sessaoDoPedido(req: Req, csrf: boolean): Promise<{ id: string; rede: string | null }> {
    if (!this.sessao) throw new ErroProblema('indisponivel', 503, 'Serviço indisponível');
    const id = lerCookieSessao(req.headers['cookie'] as string | undefined, this.prefixoHost);
    if (!id) throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    const rede = this.rede(req);
    if (csrf) {
      const doCookie = lerCookie(req.headers['cookie'] as string | undefined, COOKIE_CSRF);
      const bruto = req.headers[CABECALHO_CSRF];
      const doCabecalho = Array.isArray(bruto) ? bruto[0] : bruto;
      const ok =
        !!doCookie &&
        !!doCabecalho &&
        doCookie === doCabecalho &&
        (await this.sessao.csrfConfere(id, rede, doCabecalho).catch(() => false));
      if (!ok) throw new ErroProblema('sem-permissao', 403, 'Requisição não autenticada (CSRF)');
    }
    return { id, rede };
  }

  private async metodoDe(r: Registro): Promise<MetodoSegundoFator> {
    const s = this.servicos;
    if (!s) return 'aplicativo';
    if (r.plataforma)
      return (await this.plataforma().metodoSegundoFator(r.plataforma.idAdministrador)) ?? 'aplicativo';
    return s.preferencia.metodo(r.rede, r.estabelecimento, r.login);
  }

  private emailDisponivel(r: Registro): boolean {
    return r.plataforma
      ? this.servicos?.recuperacaoPlataforma?.disponivel === true
      : !!this.servicos?.codigoUsuario;
  }

  // ── "Esqueci a senha" do administrador da plataforma ──

  @Get('sessao/plataforma/recuperacao/disponivel')
  @Publica('o "Esqueci a senha" da plataforma está montado? (sem dado de pessoa)')
  recuperacaoPlataformaDisponivel(): { disponivel: boolean } {
    return { disponivel: this.servicos?.recuperacaoPlataforma?.disponivel === true };
  }

  /** POST /api/sessao/plataforma/recuperacao: a mesma resposta para qualquer e-mail; o link vai só ao e-mail. */
  @Post('sessao/plataforma/recuperacao')
  @HttpCode(202)
  @Publica('pedido de recuperação da plataforma: resposta genérica, limite por hora por conta e por origem')
  @AuditadoNoHandler('linha do tempo da credencial no banco plataforma (recuperacao_pedida; nunca o token)')
  async pedirRecuperacaoPlataforma(@Body() corpo: unknown, @Req() req: Req): Promise<{ mensagem: string }> {
    const p = this.plataforma();
    const r = esquemaPedidoPlataforma.safeParse(corpo);
    if (!r.success) throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Informe o e-mail.');
    try {
      return await p.pedir(
        r.data.email,
        req.ip ?? null,
        correlacaoDaRequisicao(req, 'plataforma-recuperacao'),
      );
    } catch (e) {
      this.erro(e);
    }
  }

  /** POST /api/sessao/plataforma/recuperacao/usar: o link de uso único vira a senha provisória (troca obrigatória). */
  @Post('sessao/plataforma/recuperacao/usar')
  @HttpCode(200)
  @Publica('o token de uso único do e-mail é a prova de posse (consumido de forma atômica)')
  @AuditadoNoHandler(
    'linha do tempo da credencial no banco plataforma (senha_redefinida), na mesma transação',
  )
  async usarRecuperacaoPlataforma(
    @Body() corpo: unknown,
    @Req() req: Req,
  ): Promise<{ senhaProvisoria: string; trocaObrigatoria: true; login: string }> {
    const p = this.plataforma();
    const r = esquemaUsarPlataforma.safeParse(corpo);
    if (!r.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Link inválido ou vencido',
        'O link de recuperação é inválido. Peça outro em "Esqueci a senha".',
      );
    try {
      return await p.usar(
        r.data.token,
        req.ip ?? null,
        correlacaoDaRequisicao(req, 'plataforma-recuperacao'),
      );
    } catch (e) {
      this.erro(e);
    }
  }

  // ── A escolha do segundo fator da própria conta ──

  @Get('sessao/segundo-fator/metodo')
  @Permissao(PERMISSOES_ACESSO.segundoFatorGerir)
  async metodoSegundoFator(@Req() req: Req): Promise<MetodoSegundoFatorTela> {
    const { id, rede } = await this.sessaoDoPedido(req, false);
    try {
      const lido = await this.sessao!.ler(id, rede);
      if (!lido) throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
      return {
        metodo: await this.metodoDe(lido.registro),
        emailDisponivel: this.emailDisponivel(lido.registro),
      };
    } catch (e) {
      this.erro(e);
    }
  }

  /** POST /api/sessao/segundo-fator/metodo: troca o método (senha conferida há pouco; CSRF). */
  @Post('sessao/segundo-fator/metodo')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.segundoFatorGerir)
  @AuditadoNoHandler(
    'acesso.segundo-fator.escolhido na mesma transação (cliente) ou linha do tempo (plataforma)',
  )
  async escolherMetodoSegundoFator(@Body() corpo: unknown, @Req() req: Req): Promise<MetodoSegundoFatorTela> {
    const { id, rede } = await this.sessaoDoPedido(req, true);
    const r = esquemaEscolherMetodo.safeParse(corpo);
    if (!r.success)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Escolha aplicativo ou e-mail.');
    if (!this.servicos) throw new ErroProblema('indisponivel', 503, 'Serviço indisponível');
    try {
      const reg = await this.sessao!.exigirReautenticacaoRecente(id, rede);
      if (r.data.metodo === 'email' && !this.emailDisponivel(reg))
        throw new ErroProblema('indisponivel', 503, 'Envio de e-mail indisponível');
      const recusa = r.data.metodo === 'email' ? recusaEmailPelaPolitica(reg) : null;
      if (recusa)
        throw new ErroProblema('recusa-de-negocio', 409, 'Código no e-mail não permitido', recusa, {
          codigo: 'politica-exige-aplicativo',
        });
      const correlacao = correlacaoDaRequisicao(req, 'segundo-fator');
      if (reg.plataforma)
        await this.plataforma().escolherMetodoSegundoFator(
          reg.plataforma.idAdministrador,
          r.data.metodo,
          req.ip ?? null,
          correlacao,
        );
      else
        await this.servicos.preferencia.escolher(
          {
            rede: reg.rede,
            hospital: reg.estabelecimento,
            login: reg.login,
            estacao: estacaoDaRequisicao(req),
            correlacao,
          },
          r.data.metodo,
        );
      return { metodo: r.data.metodo, emailDisponivel: this.emailDisponivel(reg) };
    } catch (e) {
      this.erro(e);
    }
  }
}
