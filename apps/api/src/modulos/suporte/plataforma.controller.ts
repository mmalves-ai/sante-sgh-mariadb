// Rotas da conta da plataforma e do "login como" (ADR 0021). São @Publica para a guarda das sessões do
// hospital: cada handler confere a SESSÃO DA PLATAFORMA (cookie próprio, HttpOnly) e, nas que mudam estado, o
// CSRF por token duplo próprio (cookie sgh_pcsrf + cabeçalho x-csrf-plataforma, conferidos contra o token
// guardado na sessão). A designação e a auditoria completa são telas da conta da PLATAFORMA, não do alvo
// (única exceção estrutural; dentro do "como" vale o que o alvo pode).
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  esquemaAceitarConvite,
  esquemaAtribuicoes,
  esquemaCorrigir,
  esquemaEntrarComo,
  esquemaEntrarPlataforma,
  esquemaFuncaoSuporte,
  esquemaNovoSuporte,
  type AuditoriaContaTela,
  type ContaPlataformaTela,
  type ConviteTela,
  type CruzamentoTrilhaTela,
  type DetalheSessaoComoTela,
  type EmNomeDePadrao,
  type EstabelecimentoComo,
  type EuPlataforma,
  type GrupoComo,
  type PreviaCorrecaoTela,
  type ResultadoCorrecaoTela,
  type SegundoFatorPlataforma,
  type Sessao,
  type SessaoComoTela,
  type TipoProblema,
  type UsuarioComo,
} from '@sgh/contratos';
import { CONFIGURACAO, type Configuracao } from '../../configuracao.js';
import { ErroProblema } from '../../problema.filter.js';
import { AuditadoNoHandler, Publica } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import {
  CABECALHO_CSRF,
  CABECALHO_CSRF_PLATAFORMA,
  COOKIE_CSRF,
  COOKIE_CSRF_PLATAFORMA,
  cookieCsrf,
  cookieSessao,
  cookiesApagados,
  cookiesPlataforma,
  cookiesPlataformaApagados,
  lerCookie,
  lerCookiePlataforma,
  lerCookieSessao,
} from '../../sessao/cookies.js';
import type { ResolvedorRede } from '../../sessao/rede.js';
import { ErroSessao, type ServicoSessao } from '../../sessao/servico-sessao.js';
import { RESOLVEDOR_REDE, SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { ErroConflitoCorrecao, ErroPreviaCorrecao } from './correcao.js';
import type { ServicoComo } from './servico-como.js';
import { type ContaComAtribuicoes, ErroPlataforma, type ServicoPlataforma } from './servico-plataforma.js';

export const SERVICO_PLATAFORMA = Symbol('SERVICO_PLATAFORMA');
export const SERVICO_COMO = Symbol('SERVICO_COMO');

interface Req {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly ip?: string;
}
interface Res {
  header(nome: string, valor: string | string[]): unknown;
}

const ERROS: Record<ErroPlataforma['tipo'], [TipoProblema, number, string]> = {
  'credencial-invalida': ['nao-autenticado', 401, 'E-mail, senha ou código inválidos'],
  'muitas-tentativas': ['muitas-tentativas', 429, 'Muitas tentativas'],
  'sessao-encerrada': ['nao-autenticado', 401, 'Sessão da plataforma encerrada'],
  'sem-permissao': ['sem-permissao', 403, 'Sem permissão'],
  indisponivel: ['indisponivel', 503, 'Serviço indisponível'],
  'entrada-invalida': ['entrada-invalida', 400, 'Dados inválidos'],
  'nao-encontrado': ['nao-encontrado', 404, 'Não encontrado'],
  conflito: ['recusa-de-negocio', 409, 'Operação recusada'],
  'rede-desconhecida': ['rede-desconhecida', 404, 'Endereço sem rede configurada'],
};

const SEM_PREFIXO = new Set(['dev', 'ci']);
const NUMERO = /^\d{1,18}$/;

@Controller('plataforma')
export class PlataformaController {
  constructor(
    @Inject(CONFIGURACAO) private readonly configuracao: Configuracao,
    @Inject(SERVICO_PLATAFORMA) private readonly plataforma: ServicoPlataforma | null,
    @Inject(SERVICO_COMO) private readonly como: ServicoComo | null,
    @Inject(SERVICO_SESSAO) private readonly sessao: ServicoSessao | null,
    @Inject(RESOLVEDOR_REDE) private readonly resolvedor: ResolvedorRede,
  ) {}

  private get prefixoHost(): boolean {
    return !SEM_PREFIXO.has(this.configuracao.ambiente);
  }

  private rede(req: Req): string | null {
    const host = req.headers['host'];
    return this.resolvedor.resolver(Array.isArray(host) ? host[0] : host);
  }

  private servicos(): { p: ServicoPlataforma; c: ServicoComo } {
    if (!this.plataforma || !this.como) throw new ErroProblema('indisponivel', 503, 'Serviço indisponível');
    return { p: this.plataforma, c: this.como };
  }

  private erro(e: unknown): never {
    if (e instanceof ErroPlataforma) {
      const [tipo, status, titulo] = ERROS[e.tipo];
      throw new ErroProblema(tipo, status, titulo, e.detalhe);
    }
    if (e instanceof ErroPreviaCorrecao)
      throw new ErroProblema('recusa-de-negocio', 409, 'A correção mudou depois da prévia', e.message, {
        codigo: 'correcao-previa-divergente',
      });
    if (e instanceof ErroConflitoCorrecao)
      throw new ErroProblema('recusa-de-negocio', 409, 'O registro mudou depois', e.message, {
        codigo: 'correcao-conflito',
      });
    if (e instanceof ErroSessao) {
      if (e.tipo === 'credencial-invalida')
        throw new ErroProblema('nao-encontrado', 404, 'Usuário não disponível', e.detalhe);
      if (e.tipo === 'estabelecimento-invalido')
        throw new ErroProblema('entrada-invalida', 400, 'Estabelecimento inválido', e.detalhe);
      if (e.tipo === 'rede-desconhecida')
        throw new ErroProblema('rede-desconhecida', 404, 'Endereço sem rede configurada', e.detalhe);
      throw new ErroProblema('indisponivel', 503, 'Serviço indisponível', e.detalhe);
    }
    throw e;
  }

  private idPlataforma(req: Req): string | null {
    return lerCookiePlataforma(req.headers['cookie'] as string | undefined, this.prefixoHost);
  }

  /** A conta da sessão da plataforma (401 sem ela). Nas escritas, o CSRF próprio. */
  private async conta(req: Req, escrita = false): Promise<ContaComAtribuicoes> {
    const { p } = this.servicos();
    const id = this.idPlataforma(req);
    let lido: Awaited<ReturnType<ServicoPlataforma['ler']>> = null;
    try {
      lido = await p.ler(id, this.rede(req));
    } catch (e) {
      this.erro(e);
    }
    if (!lido || !id) throw new ErroProblema('nao-autenticado', 401, 'Sessão da plataforma necessária');
    if (escrita) {
      const doCookie = lerCookie(req.headers['cookie'] as string | undefined, COOKIE_CSRF_PLATAFORMA);
      const bruto = req.headers[CABECALHO_CSRF_PLATAFORMA];
      const doCabecalho = Array.isArray(bruto) ? bruto[0] : bruto;
      const ok = !!doCookie && doCookie === doCabecalho && (await p.csrfConfere(id, doCabecalho));
      if (!ok) throw new ErroProblema('sem-permissao', 403, 'Requisição não autenticada (CSRF)');
    }
    return lido.conta;
  }

  private analisar<T>(
    esquema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
    corpo: unknown,
  ): T {
    const r = esquema.safeParse(corpo);
    if (!r.success) throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos');
    return r.data;
  }

  // ── Conta da plataforma ───────────────────────────────────────────────────────────────────────

  @Post('sessao')
  @HttpCode(200)
  @Publica('login próprio da conta da plataforma (senha Argon2id e TOTP conferidos no serviço)')
  @AuditadoNoHandler('a auditoria das contas (login e falha) gravada pelo serviço')
  async entrar(
    @Body() corpo: unknown,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Res,
  ): Promise<EuPlataforma | SegundoFatorPlataforma> {
    const { p } = this.servicos();
    const pedido = this.analisar(esquemaEntrarPlataforma, corpo);
    try {
      const r = await p.entrar(
        pedido,
        this.rede(req),
        this.idPlataforma(req),
        estacaoDaRequisicao(req),
        req.ip,
      );
      if (r.tipo === 'segundo-fator')
        return { segundoFator: r.segundoFator, ...(r.otpauth ? { otpauth: r.otpauth } : {}) };
      res.header(
        'set-cookie',
        cookiesPlataforma(r.id, r.csrf, { maxIdadeSegundos: r.ttlSegundos, prefixoHost: this.prefixoHost }),
      );
      return r.eu;
    } catch (e) {
      this.erro(e);
    }
  }

  @Get('eu')
  @Publica('a própria conta da plataforma: 401 sem a sessão dela')
  async eu(@Req() req: Req): Promise<EuPlataforma> {
    const { p } = this.servicos();
    const id = this.idPlataforma(req);
    let lido: Awaited<ReturnType<ServicoPlataforma['ler']>> = null;
    try {
      lido = await p.ler(id, this.rede(req));
    } catch (e) {
      this.erro(e);
    }
    if (!lido) throw new ErroProblema('nao-autenticado', 401, 'Sessão da plataforma necessária');
    return p.eu(lido.conta, lido.registro);
  }

  /** Sair da conta da plataforma: encerra também a sessão "como" aberta neste navegador. */
  @Delete('sessao')
  @HttpCode(204)
  @Publica('sair da própria conta da plataforma (CSRF próprio conferido no handler)')
  @AuditadoNoHandler('o encerramento do "como" vai à sessao_suporte pelo serviço de sessão')
  async sair(@Req() req: Req, @Res({ passthrough: true }) res: Res): Promise<void> {
    const { p } = this.servicos();
    const id = this.idPlataforma(req);
    if (id) {
      try {
        await this.conta(req, true);
      } catch (e) {
        // Sessão já vencida: só apaga os cookies. CSRF errado com sessão viva: recusa.
        if (e instanceof ErroProblema && e.getStatus() === 403) throw e;
      }
      await this.voltarDoComo(req);
      await p.sair(id);
    }
    res.header('set-cookie', [
      ...cookiesPlataformaApagados(this.prefixoHost),
      ...cookiesApagados(this.prefixoHost),
    ]);
  }

  /** Convite: a pessoa define a própria senha (sem sessão; o token vale uma vez e vence). */
  @Post('convite')
  @HttpCode(204)
  @Publica('definição da senha pelo convite (token de uso único conferido pelo hash)')
  @AuditadoNoHandler(
    'a auditoria das contas (senha definida) gravada pelo serviço; as sessões "como" da conta encerram',
  )
  async aceitarConvite(@Body() corpo: unknown, @Req() req: Req): Promise<void> {
    const { p } = this.servicos();
    const r = esquemaAceitarConvite.safeParse(corpo);
    if (!r.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'A senha tem de ter ao menos 12 caracteres.',
      );
    try {
      const idConta = await p.aceitarConvite(r.data.token, r.data.senha, estacaoDaRequisicao(req));
      // Credencial nova: as sessões "como" abertas com a antiga terminam (as da plataforma caem pela marca).
      await this.como?.encerrarDaConta(idConta, null, 'senha-redefinida');
    } catch (e) {
      this.erro(e);
    }
  }

  // ── Designação (só a PLATAFORMA) ─────────────────────────────────────────────────────────────

  @Get('suportes')
  @Publica('designação: só a conta da plataforma (conferida no serviço)')
  async suportes(@Req() req: Req): Promise<ContaPlataformaTela[]> {
    const conta = await this.conta(req);
    try {
      return await this.servicos().p.listarContas(conta);
    } catch (e) {
      this.erro(e);
    }
  }

  @Post('suportes')
  @HttpCode(201)
  @Publica('designação: só a conta da plataforma (CSRF próprio; conferida no serviço)')
  @AuditadoNoHandler('a auditoria das contas (suporte.conta.criada) na mesma transação')
  async criarSuporte(@Body() corpo: unknown, @Req() req: Req): Promise<{ id: string; convite: ConviteTela }> {
    const conta = await this.conta(req, true);
    const d = this.analisar(esquemaNovoSuporte, corpo);
    try {
      return await this.servicos().p.criarSuporte(conta, d.email, d.nome ?? null, estacaoDaRequisicao(req));
    } catch (e) {
      this.erro(e);
    }
  }

  @Put('suportes/:id')
  @HttpCode(204)
  @Publica('designação: só a conta da plataforma (CSRF próprio; conferida no serviço)')
  @AuditadoNoHandler('a auditoria das contas (suporte.funcao.alterada) na mesma transação')
  async funcao(@Param('id') id: string, @Body() corpo: unknown, @Req() req: Req): Promise<void> {
    const conta = await this.conta(req, true);
    if (!NUMERO.test(id)) throw new ErroProblema('nao-encontrado', 404, 'Suporte não encontrado');
    const d = this.analisar(esquemaFuncaoSuporte, corpo);
    const { p, c } = this.servicos();
    try {
      await p.definirFuncao(conta, id, d.ativo, estacaoDaRequisicao(req));
      if (!d.ativo) await c.encerrarDaConta(id, null, 'funcao-retirada');
    } catch (e) {
      this.erro(e);
    }
  }

  @Put('suportes/:id/atribuicoes')
  @HttpCode(200)
  @Publica('designação: só a conta da plataforma (CSRF próprio; conferida no serviço)')
  @AuditadoNoHandler('a auditoria das contas (suporte.atribuicoes.alteradas) na mesma transação')
  async atribuicoes(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: Req,
  ): Promise<{ ligados: string[]; desligados: string[] }> {
    const conta = await this.conta(req, true);
    if (!NUMERO.test(id)) throw new ErroProblema('nao-encontrado', 404, 'Suporte não encontrado');
    const d = this.analisar(esquemaAtribuicoes, corpo);
    const { p, c } = this.servicos();
    const rede = this.rede(req) ?? '';
    try {
      const r = await p.definirAtribuicoes(
        conta,
        id,
        rede,
        d.estabelecimentos,
        c.estabelecimentos(conta).map((e) => e.codigo),
        estacaoDaRequisicao(req),
      );
      if (r.desligados.length > 0) await c.encerrarDaConta(id, r.desligados, 'atribuicao-retirada');
      return r;
    } catch (e) {
      this.erro(e);
    }
  }

  @Post('suportes/:id/convite')
  @HttpCode(201)
  @Publica('designação: só a conta da plataforma (CSRF próprio; conferida no serviço)')
  @AuditadoNoHandler(
    'a auditoria das contas (suporte.convite.gerado) na mesma transação; as sessões da conta encerram',
  )
  async convite(@Param('id') id: string, @Req() req: Req): Promise<ConviteTela> {
    const conta = await this.conta(req, true);
    if (!NUMERO.test(id)) throw new ErroProblema('nao-encontrado', 404, 'Suporte não encontrado');
    const { p, c } = this.servicos();
    try {
      // Senha e segundo fator zerados: as sessões da plataforma da conta caem pela marca das credenciais e as
      // sessões "como" abertas terminam aqui, na hora (a reação natural à credencial vazada revoga o acesso).
      const cv = await p.novoConvite(conta, id, estacaoDaRequisicao(req));
      await c.encerrarDaConta(id, null, 'convite-reemitido');
      return cv;
    } catch (e) {
      this.erro(e);
    }
  }

  // ── "Login como" ────────────────────────────────────────────────────────────────────────────

  @Get('como/estabelecimentos')
  @Publica('modal do "login como": plataforma (todos) ou suporte (atribuídos), conferido no serviço')
  async estabelecimentos(@Req() req: Req): Promise<EstabelecimentoComo[]> {
    const conta = await this.conta(req);
    try {
      return this.servicos().c.estabelecimentos(conta);
    } catch (e) {
      this.erro(e);
    }
  }

  @Get('como/grupos')
  @Publica('modal do "login como": só no estabelecimento permitido à conta (conferido no serviço)')
  async grupos(@Req() req: Req, @Query('estabelecimento') hospital?: string): Promise<GrupoComo[]> {
    const conta = await this.conta(req);
    try {
      return await this.servicos().c.grupos(conta, String(hospital ?? ''));
    } catch (e) {
      this.erro(e);
    }
  }

  @Get('como/usuarios')
  @Publica('modal do "login como": só no estabelecimento permitido à conta (conferido no serviço)')
  async usuarios(
    @Req() req: Req,
    @Query('estabelecimento') hospital?: string,
    @Query('grupo') grupo?: string,
  ): Promise<UsuarioComo[]> {
    const conta = await this.conta(req);
    if (!grupo || grupo.length > 31) throw new ErroProblema('entrada-invalida', 400, 'Grupo inválido');
    try {
      return await this.servicos().c.usuarios(conta, String(hospital ?? ''), grupo);
    } catch (e) {
      this.erro(e);
    }
  }

  /** ADR 0022: padrão de "em nome de quem gravar" do acesso total no estabelecimento (só a PLATAFORMA). */
  @Get('como/em-nome-de')
  @Publica('modal do "login como": padrão do acesso total (só a plataforma; conferido no serviço)')
  async emNomeDe(@Req() req: Req, @Query('estabelecimento') hospital?: string): Promise<EmNomeDePadrao> {
    const conta = await this.conta(req);
    try {
      return this.servicos().c.emNomeDePadrao(conta, String(hospital ?? ''));
    } catch (e) {
      this.erro(e);
    }
  }

  /** Abre a sessão "como": a sessão do alvo (cookie da sessão do SPDATA), marcada com o ator real. */
  @Post('como')
  @HttpCode(201)
  @Publica('abre a sessão "como" (conta, função e atribuição conferidas; CSRF próprio)')
  @AuditadoNoHandler(
    'sessao_suporte antes da sessão do alvo; o aviso ao Auditor (outbox) depois dela, sem ele a sessão é desfeita',
  )
  async entrarComo(
    @Body() corpo: unknown,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Res,
  ): Promise<Sessao> {
    const conta = await this.conta(req, true);
    const pedido = this.analisar(esquemaEntrarComo, corpo);
    const idAnterior = lerCookieSessao(req.headers['cookie'] as string | undefined, this.prefixoHost);
    // Uma sessão "como" (ou do SPDATA) aberta neste navegador termina antes da nova.
    await this.voltarDoComo(req);
    try {
      const r = await this.servicos().c.entrar(
        conta,
        pedido,
        this.rede(req),
        idAnterior,
        estacaoDaRequisicao(req),
      );
      const op = { maxIdadeSegundos: r.ttlSegundos, prefixoHost: this.prefixoHost };
      res.header('set-cookie', [cookieSessao(r.idSessao, op), cookieCsrf(r.csrf, op)]);
      return r.sessao;
    } catch (e) {
      this.erro(e);
    }
  }

  /**
   * "Voltar à minha conta": encerra a sessão "como" deste navegador (a conta da plataforma continua). Vale
   * também com a sessão da plataforma já vencida (30 min sem atividade nela enquanto se trabalha no "como"):
   * aí o pedido é conferido pelo CSRF da própria sessão do SPDATA, e a sessão "como" termina do mesmo jeito
   * (nunca fica viva no navegador depois de a tela dizer que voltou). Os cookies do SPDATA saem sempre.
   */
  @Delete('como')
  @HttpCode(204)
  @Publica('encerra a sessão "como" deste navegador (CSRF próprio ou o da sessão do SPDATA)')
  @AuditadoNoHandler('o encerramento vai à sessao_suporte pelo serviço de sessão')
  async voltar(@Req() req: Req, @Res({ passthrough: true }) res: Res): Promise<void> {
    let autorizado = false;
    try {
      await this.conta(req, true);
      autorizado = true;
    } catch (e) {
      if (!(e instanceof ErroProblema) || ![401, 403].includes(e.getStatus())) throw e;
    }
    if (!autorizado && !(await this.csrfDoSpdataConfere(req)))
      throw new ErroProblema('sem-permissao', 403, 'Requisição não autenticada (CSRF)');
    await this.voltarDoComo(req);
    res.header('set-cookie', cookiesApagados(this.prefixoHost));
  }

  /** Token duplo da sessão do SPDATA deste navegador (cookie sgh_csrf = cabeçalho x-csrf = o do registro). */
  private async csrfDoSpdataConfere(req: Req): Promise<boolean> {
    const id = lerCookieSessao(req.headers['cookie'] as string | undefined, this.prefixoHost);
    if (!id || !this.sessao) return false;
    const doCookie = lerCookie(req.headers['cookie'] as string | undefined, COOKIE_CSRF);
    const bruto = req.headers[CABECALHO_CSRF];
    const doCabecalho = Array.isArray(bruto) ? bruto[0] : bruto;
    if (!doCookie || doCookie !== doCabecalho) return false;
    return this.sessao.csrfConfere(id, this.rede(req), doCabecalho).catch(() => false);
  }

  private async voltarDoComo(req: Req): Promise<void> {
    const id = lerCookieSessao(req.headers['cookie'] as string | undefined, this.prefixoHost);
    if (id && this.sessao) await this.sessao.sair(id, this.rede(req)).catch(() => undefined);
  }

  // ── Auditoria ─────────────────────────────────────────────────────────────────────────────

  @Get('auditoria/sessoes')
  @Publica('auditoria: plataforma (todas) ou suporte (as próprias), conferido no serviço')
  async sessoes(@Req() req: Req, @Query('estabelecimento') hospital?: string): Promise<SessaoComoTela[]> {
    const conta = await this.conta(req);
    try {
      return await this.servicos().c.sessoes(conta, hospital ? { hospital } : {});
    } catch (e) {
      this.erro(e);
    }
  }

  @Get('auditoria/sessoes/:id')
  @Publica('auditoria: plataforma (todas) ou suporte (as próprias), conferido no serviço')
  async detalhe(@Param('id') id: string, @Req() req: Req): Promise<DetalheSessaoComoTela> {
    const conta = await this.conta(req);
    if (!NUMERO.test(id)) throw new ErroProblema('nao-encontrado', 404, 'Sessão não encontrada');
    try {
      return await this.servicos().c.detalhe(conta, id);
    } catch (e) {
      this.erro(e);
    }
  }

  @Get('auditoria/sessoes/:id/trilha-legado')
  @Publica('auditoria (R3): TBCABTRILHA × "como"; conferido no serviço')
  async cruzamento(@Param('id') id: string, @Req() req: Req): Promise<CruzamentoTrilhaTela[]> {
    const conta = await this.conta(req);
    if (!NUMERO.test(id)) throw new ErroProblema('nao-encontrado', 404, 'Sessão não encontrada');
    try {
      return await this.servicos().c.cruzamento(conta, id);
    } catch (e) {
      this.erro(e);
    }
  }

  @Post('auditoria/sessoes/:id/encerrar')
  @HttpCode(204)
  @Publica('revogar sessão "como" aberta (CSRF próprio; conferido no serviço)')
  @AuditadoNoHandler('sessao_suporte (revogada) e a marca de revogação no armazém')
  async encerrar(@Param('id') id: string, @Req() req: Req): Promise<void> {
    const conta = await this.conta(req, true);
    if (!NUMERO.test(id)) throw new ErroProblema('nao-encontrado', 404, 'Sessão não encontrada');
    try {
      await this.servicos().c.revogar(conta, id);
    } catch (e) {
      this.erro(e);
    }
  }

  @Post('auditoria/correcoes')
  @HttpCode(200)
  @Publica('Corrigir/Desfazer: plataforma ou suporte atribuído ao estabelecimento (CSRF próprio)')
  @AuditadoNoHandler('a correção e a trilha na mesma transação da compensação')
  async corrigir(
    @Body() corpo: unknown,
    @Req() req: Req,
  ): Promise<PreviaCorrecaoTela | ResultadoCorrecaoTela> {
    const conta = await this.conta(req, true);
    const pedido = this.analisar(esquemaCorrigir, corpo);
    const { c } = this.servicos();
    try {
      if (pedido.previa) return await c.previa(conta, pedido);
      return await c.corrigir(
        conta,
        pedido,
        estacaoDaRequisicao(req),
        correlacaoDaRequisicao(req, 'correcao'),
      );
    } catch (e) {
      this.erro(e);
    }
  }

  @Get('auditoria/contas')
  @Publica('auditoria das mudanças de função e de atribuição: só a plataforma (conferido no serviço)')
  async eventos(@Req() req: Req): Promise<AuditoriaContaTela[]> {
    const conta = await this.conta(req);
    try {
      return await this.servicos().c.eventosConta(conta);
    } catch (e) {
      this.erro(e);
    }
  }
}
