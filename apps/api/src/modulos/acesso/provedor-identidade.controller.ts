// LOGIN ÚNICO CORPORATIVO (01-ADM L61). Rotas (porta própria; sem banco do cliente, 503):
//   Cadastro (gestor de acessos, acesso.perfil.gerir):
//   GET  /api/acesso/provedores-identidade                          provedores do estabelecimento
//   POST /api/acesso/provedores-identidade                          criar ou alterar (com a versão) o provedor
//   GET  /api/acesso/provedores-identidade/:id/grupos               perfil padrão por grupo do diretório
//   POST /api/acesso/provedores-identidade/:id/grupos               novo mapa {grupoExterno, perfil, soEsteEstabelecimento}
//   POST /api/acesso/provedores-identidade/grupos/:g/desativar      {versao}
//   GET  /api/acesso/provedores-identidade/:id/vinculos             contas ligadas ao provedor
//   POST /api/acesso/provedores-identidade/:id/vinculos             ligar {login, identificador, email}
//   POST /api/acesso/provedores-identidade/vinculos/:v/desligar     {versao}  (religar: .../religar)
//   Entrada (pública):
//   GET  /api/sessao/provedores?estabelecimento=                    botões da tela de entrada (código e nome)
//   POST /api/sessao/provedor/inicio   {estabelecimento, provedor}  endereço do provedor (estado, nonce, PKCE)
//   POST /api/sessao/provedor/retorno  {estado, codigo, codigoSegundoFator?}  confere o token e abre a sessão
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { EVENTOS_AUDITAVEIS, PERMISSOES_ACESSO, type Sessao } from '@sgh/contratos';
import { z } from 'zod';
import { Auditar, AuditadoNoHandler, Permissao, Publica } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { CONFIGURACAO, type Configuracao } from '../../configuracao.js';
import { ErroProblema } from '../../problema.filter.js';
import {
  cookieCsrf,
  cookiePosto,
  cookieSessao,
  lerCookiePosto,
  lerCookieSessao,
} from '../../sessao/cookies.js';
import type { ResolvedorRede } from '../../sessao/rede.js';
import { ErroSessao, type ServicoSessao } from '../../sessao/servico-sessao.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { contextoDoEstabelecimento } from '../cadastro/contexto-nucleo.js';
import { RESOLVEDOR_REDE, SERVICO_SESSAO, TIPO_ERRO } from './acesso.controller.js';
import { EntradaOidc, ErroEntradaOidc } from './entrada-oidc.js';
import {
  PORTA_PROVEDOR_IDENTIDADE,
  type PortaProvedorIdentidadePropria,
} from './provedor-identidade-propria.js';
import { createHash, randomBytes } from 'node:crypto';

export const ENTRADA_OIDC = Symbol('ENTRADA_OIDC');
const AMBIENTES_SEM_PREFIXO = new Set(['dev', 'ci']);
/** Caminho da tela que recebe a volta do provedor (código e estado na consulta). */
export const CAMINHO_RETORNO_PROVEDOR = '/entrar/provedor';

const esquemaInicio = z
  .object({ estabelecimento: z.string().min(1).max(10), provedor: z.string().min(1).max(30) })
  .strict();
const esquemaRetorno = z
  .object({
    estado: z.string().min(16).max(100),
    codigo: z.string().min(1).max(2000).optional(),
    codigoSegundoFator: z.string().max(20).optional(),
  })
  .strict();

type Req = RequisicaoAutorizada & { ip?: string };
interface Res {
  header(nome: string, valor: string | readonly string[]): unknown;
}

const RECUSAS: Readonly<Record<string, string>> = {
  'provedor-inativo': 'O provedor de identidade está desativado.',
  'vinculo-inativo': 'O vínculo desta identidade com a conta foi desligado. Procure o gestor de acessos.',
  'vinculo-vencido': 'O vínculo desta identidade venceu. Procure o gestor de acessos.',
  'sem-vinculo': 'Esta identidade não está ligada a nenhuma conta. Procure o gestor de acessos.',
};

@Controller()
export class ProvedorIdentidadeController {
  constructor(
    @Inject(CONFIGURACAO) private readonly configuracao: Configuracao,
    @Inject(RESOLVEDOR_REDE) private readonly resolvedor: ResolvedorRede,
    @Optional() @Inject(SERVICO_SESSAO) private readonly servico: ServicoSessao | null = null,
    @Optional()
    @Inject(PORTA_PROVEDOR_IDENTIDADE)
    private readonly porta: PortaProvedorIdentidadePropria | null = null,
    @Optional() @Inject(ENTRADA_OIDC) private readonly oidc: EntradaOidc | null = null,
  ) {}

  private portaOu503(): PortaProvedorIdentidadePropria {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    return this.porta;
  }

  private com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaProvedorIdentidadePropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ): Promise<T> {
    const p = this.portaOu503();
    const s = sessaoDe(req);
    return fn(p, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  // ------------------------------------------------------------------- cadastro

  @Get('acesso/provedores-identidade')
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @Auditar(EVENTOS_AUDITAVEIS.grupoConsultado.codigo)
  listar(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.listar(c));
  }

  @Post('acesso/provedores-identidade')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @AuditadoNoHandler('o cadastro do provedor vai à trilha pelo executor (mesma transação)')
  gravarProvedor(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.gravarProvedor(c, corpo));
  }

  @Get('acesso/provedores-identidade/:id/grupos')
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @Auditar(EVENTOS_AUDITAVEIS.grupoConsultado.codigo)
  grupos(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.grupos(c, id));
  }

  @Post('acesso/provedores-identidade/:id/grupos')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @AuditadoNoHandler('o mapa de grupo vai à trilha pelo executor (mesma transação)')
  incluirGrupo(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.incluirGrupo(c, id, corpo));
  }

  @Post('acesso/provedores-identidade/grupos/:g/desativar')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @AuditadoNoHandler('a desativação do mapa de grupo vai à trilha pelo executor (mesma transação)')
  desativarGrupo(
    @Req() req: RequisicaoAutorizada,
    @Param('g', ParseIntPipe) g: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.desativarGrupo(c, g, corpo));
  }

  @Get('acesso/provedores-identidade/:id/vinculos')
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @Auditar(EVENTOS_AUDITAVEIS.grupoConsultado.codigo)
  vinculos(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.vinculos(c, id));
  }

  @Post('acesso/provedores-identidade/:id/vinculos')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @AuditadoNoHandler(
    'o vínculo da conta com a identidade externa vai à trilha pelo executor (mesma transação)',
  )
  ligarVinculo(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.ligarVinculo(c, id, corpo));
  }

  @Post('acesso/provedores-identidade/vinculos/:v/desligar')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @AuditadoNoHandler('o desligamento do vínculo vai à trilha pelo executor (mesma transação)')
  desligarVinculo(
    @Req() req: RequisicaoAutorizada,
    @Param('v', ParseIntPipe) v: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.alternarVinculo(c, v, false, corpo));
  }

  @Post('acesso/provedores-identidade/vinculos/:v/religar')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @AuditadoNoHandler('o religamento do vínculo vai à trilha pelo executor (mesma transação)')
  religarVinculo(
    @Req() req: RequisicaoAutorizada,
    @Param('v', ParseIntPipe) v: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.alternarVinculo(c, v, true, corpo));
  }

  // ------------------------------------------------------------------- entrada

  private get prefixoHost(): boolean {
    return !AMBIENTES_SEM_PREFIXO.has(this.configuracao.ambiente);
  }

  private redeOu404(req: Req): string {
    const host = req.headers['host'];
    const r = this.resolvedor.resolver(Array.isArray(host) ? host[0] : host);
    if (!r) throw new ErroProblema('rede-desconhecida', 404, 'Endereço sem rede configurada');
    return r;
  }

  private contexto(estabelecimento: string, req: Req) {
    return {
      ...contextoDoEstabelecimento(estabelecimento),
      hospital: estabelecimento,
      usuario: null,
      correlacao: correlacaoDaRequisicao(req, 'sessao').slice(0, 64),
    };
  }

  private retorno(req: Req): string {
    const host = String(req.headers['host'] ?? '');
    return `https://${host}${CAMINHO_RETORNO_PROVEDOR}`;
  }

  private erroEntrada(e: unknown): never {
    if (e instanceof ErroProblema) throw e;
    if (e instanceof ErroEntradaOidc)
      throw new ErroProblema('nao-autenticado', 401, 'Entrada pelo provedor recusada', e.message, {
        codigo: e.codigo,
      });
    if (e instanceof ErroSessao) {
      const [tipo, status, titulo] = TIPO_ERRO[e.tipo];
      throw new ErroProblema(tipo, status, titulo, e.detalhe, e.codigo ? { codigo: e.codigo } : {});
    }
    throw problemaDoCadastro(e);
  }

  @Get('sessao/provedores')
  @Publica('provedores de identidade ligados no estabelecimento (só código e nome; sem dado de pessoa)')
  async provedores(@Query('estabelecimento') estabelecimento: string | undefined, @Req() req: Req) {
    this.redeOu404(req);
    if (!this.porta || !this.oidc || !estabelecimento) return { provedores: [] };
    const est = String(estabelecimento).slice(0, 10);
    const provedores = await this.porta.provedoresDeEntrada(this.contexto(est, req)).catch(() => []);
    return { provedores };
  }

  @Post('sessao/provedor/inicio')
  @HttpCode(200)
  @Publica('o endereço do provedor de identidade para a entrada (estado, nonce e PKCE de uso único)')
  @AuditadoNoHandler('só o estado pendente na memória; a entrada (ou a recusa) vai à trilha na volta')
  async inicio(@Body() corpo: unknown, @Req() req: Req): Promise<{ url: string }> {
    this.redeOu404(req);
    const r = esquemaInicio.safeParse(corpo);
    if (!r.success) throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Informe o provedor.');
    if (!this.porta || !this.oidc)
      throw new ErroProblema('indisponivel', 503, 'Entrada por provedor indisponível');
    try {
      const p = await this.porta.provedorParaEntrada(
        this.contexto(r.data.estabelecimento, req),
        r.data.provedor,
      );
      if (!p)
        throw new ErroProblema(
          'nao-encontrado',
          404,
          'Provedor não encontrado',
          'Provedor inexistente ou inativo.',
        );
      return await this.oidc.iniciar(p, r.data.estabelecimento, this.retorno(req));
    } catch (e) {
      this.erroEntrada(e);
    }
  }

  @Post('sessao/provedor/retorno')
  @HttpCode(201)
  @Publica(
    'volta do provedor de identidade: token conferido no servidor (assinatura, emissor, público, nonce)',
  )
  @AuditadoNoHandler(
    'sessao.login.ok na trilha pela abertura da sessão; o uso e o vínculo novo pelo executor',
  )
  async retornoProvedor(
    @Body() corpo: unknown,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Res,
  ): Promise<Sessao> {
    const rede = this.redeOu404(req);
    const r = esquemaRetorno.safeParse(corpo);
    if (!r.success)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Volta do provedor inválida.');
    if (!this.porta || !this.oidc || !this.servico)
      throw new ErroProblema('indisponivel', 503, 'Entrada por provedor indisponível');
    const pend = this.oidc.pendente(r.data.estado);
    if (!pend)
      throw new ErroProblema(
        'nao-autenticado',
        401,
        'Entrada pelo provedor recusada',
        'A entrada expirou. Comece de novo.',
        {
          codigo: 'estado-invalido',
        },
      );
    const ctx = this.contexto(pend.estabelecimento, req);
    try {
      const p = await this.porta.provedorParaEntrada(ctx, pend.provedor);
      if (!p)
        throw new ErroProblema(
          'nao-encontrado',
          404,
          'Provedor não encontrado',
          'Provedor inexistente ou inativo.',
        );
      const identidade = await this.oidc.concluir(p, r.data.estado, r.data.codigo ?? null);
      const conta = await this.porta.resolverEntrada(ctx, p.id, identidade);
      if ('recusa' in conta) {
        this.oidc.encerrar(r.data.estado);
        throw new ErroProblema(
          'nao-autenticado',
          401,
          'Entrada pelo provedor recusada',
          RECUSAS[conta.recusa],
          {
            codigo: conta.recusa,
          },
        );
      }
      const posto =
        lerCookiePosto(req.headers['cookie'] as string | undefined, this.prefixoHost) ??
        randomBytes(32).toString('base64url');
      const login = await this.servico.entrarPorProvedorExterno(
        {
          estabelecimento: pend.estabelecimento,
          login: conta.login,
          codigoSegundoFator: r.data.codigoSegundoFator,
        },
        rede,
        lerCookieSessao(req.headers['cookie'] as string | undefined, this.prefixoHost),
        {
          estacao: estacaoDaRequisicao(req),
          correlacao: correlacaoDaRequisicao(req, 'sessao'),
          posto: createHash('sha256').update(posto).digest('hex').slice(0, 64),
        },
      );
      this.oidc.encerrar(r.data.estado);
      const op = { maxIdadeSegundos: login.ttlSegundos, prefixoHost: this.prefixoHost };
      res.header('set-cookie', [
        cookieSessao(login.idSessao, op),
        cookieCsrf(login.csrf, op),
        cookiePosto(posto, this.prefixoHost),
      ]);
      return login.sessao;
    } catch (e) {
      this.erroEntrada(e);
    }
  }
}
