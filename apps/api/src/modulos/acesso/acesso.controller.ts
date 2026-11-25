// Porta de entrada (M05): seletor de estabelecimento, login no banco do cliente, sessão no servidor (cookie HttpOnly
// + CSRF por token duplo), reautenticação, unidade e troca de senha (pelo Executor do núcleo).
// A sessão sintética (M07) só responde em dev/ci quando NÃO há sessão real (mantida para os testes).
// F2-L: o controlador não importa os módulos de configuração, cadastro nem assinatura. A entrada com certificado, o
// "Esqueci a senha" e a troca rápida chegam por portas opcionais; o que o boot não montou porque o módulo ainda não
// foi migrado (SERVICOS_NAO_MIGRADOS) responde 501, e o que foi montado mas está sem serviço, 503.
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Optional,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  type DesafioLoginCertificado,
  type DisponibilidadeLoginCertificado,
  esquemaDesafioLoginCertificado,
  esquemaRespostaAgenteLocal,
  esquemaEncerrarMinhasSessoes,
  esquemaDefinirPin,
  esquemaRetirarPin,
  esquemaTrocaRapida,
  type SituacaoPinTela,
  esquemaEntrar,
  esquemaEntrarAdministradorPlataforma,
  esquemaCodigoSegundoFator,
  esquemaEscolherUnidade,
  esquemaReautenticar,
  esquemaTrocarSenha,
  esquemaPedirRecuperacaoSenha,
  esquemaUsarRecuperacaoSenha,
  type DisponibilidadeRecuperacaoSenha,
  type PedirRecuperacaoSenha,
  type RespostaAgenteLocal,
  type RespostaPedidoRecuperacaoSenha,
  type ResultadoRecuperacaoSenha,
  type EstabelecimentosEntrada,
  type MarcaPublica,
  type MinhaSessaoTela,
  type Sessao,
} from '@sgh/contratos';
import { CONFIGURACAO, type Configuracao } from '../../configuracao.js';
import { ErroProblema, tipoPorStatus } from '../../problema.filter.js';
import { ErroOperacao } from '@sgh/nucleo';
import { mensagemRegraSenha, type RegraPoliticaSenha } from '@sgh/dominio-acesso';
import { logger } from '../../logger.js';
import {
  CABECALHO_CSRF,
  COOKIE_CSRF,
  cookieCsrf,
  cookieSessao,
  cookiePosto,
  cookiesApagados,
  lerCookie,
  lerCookiePosto,
  lerCookieSessao,
} from '../../sessao/cookies.js';
import { createHash, randomBytes } from 'node:crypto';
import type { ResolvedorRede } from '../../sessao/rede.js';
import { ErroSessao, type OrigemPedido, ServicoSessao } from '../../sessao/servico-sessao.js';
import { PERMISSOES_ACESSO } from '@sgh/contratos';
import { AuditadoNoHandler, Permissao, Publica } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import { descreverDispositivo } from '../../sessao/dispositivo.js';
import { SessaoSintetica } from './sessao-sintetica.js';
import type { ServicoTrocaRapida } from '../../sessao/troca-rapida.js';
import { problemaDoAcessoEmail } from './acesso-email-erros.js';

export const SERVICO_SESSAO = Symbol('SERVICO_SESSAO');
export const SESSAO_SINTETICA = Symbol('SESSAO_SINTETICA');
export const RESOLVEDOR_REDE = Symbol('RESOLVEDOR_REDE');
/** M49 (etapa 3): a conferência do certificado da entrada sem senha (o serviço da assinatura). */
export const SERVICO_LOGIN_CERTIFICADO = Symbol('SERVICO_LOGIN_CERTIFICADO');
export const SERVICO_RECUPERACAO_SENHA = Symbol('SERVICO_RECUPERACAO_SENHA');
/** W1-01 (parte 11b2): troca rápida de usuário por PIN (D-W101-36). */
export const SERVICO_TROCA_RAPIDA = Symbol('SERVICO_TROCA_RAPIDA');
/** F2-L: os serviços opcionais que o boot não monta porque o módulo deles ainda não foi migrado (respondem 501). */
export const SERVICOS_NAO_MIGRADOS = Symbol('SERVICOS_NAO_MIGRADOS');

export type ServicoOpcionalAcesso = 'certificado' | 'recuperacao' | 'trocaRapida';

/** O que o controlador usa da entrada com certificado (o serviço da assinatura; módulo fora do boot da F2-L). */
export interface PortaLoginCertificado {
  disponivel(rede: string, estabelecimento: string): Promise<DisponibilidadeLoginCertificado>;
  desafio(
    rede: string,
    e: { estabelecimento: string; login: string },
    ip?: string | null,
  ): Promise<DesafioLoginCertificado>;
  conferir(
    rede: string,
    r: RespostaAgenteLocal,
    origem: OrigemPedido,
  ): Promise<{ estabelecimento: string; login: string }>;
}

/** O que o controlador usa do "Esqueci a senha" (depende da configuração; módulo fora do boot da F2-L). */
export interface PortaRecuperacaoSenha {
  disponivel(rede: string, estabelecimento: string): Promise<DisponibilidadeRecuperacaoSenha>;
  pedir(
    rede: string,
    p: PedirRecuperacaoSenha,
    ip: string | null,
    origem: OrigemPedido,
  ): Promise<RespostaPedidoRecuperacaoSenha>;
  usar(rede: string, token: string, origem: OrigemPedido): Promise<ResultadoRecuperacaoSenha>;
}

interface Req {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly ip?: string;
}
interface Res {
  header(nome: string, valor: string | string[]): unknown;
}

export const TIPO_ERRO: Record<ErroSessao['tipo'], [import('@sgh/contratos').TipoProblema, number, string]> =
  {
    'credencial-invalida': ['nao-autenticado', 401, 'Usuário ou senha inválidos'],
    'muitas-tentativas': ['muitas-tentativas', 429, 'Muitas tentativas'],
    'segundo-fator-necessario': ['nao-autenticado', 401, 'Segundo fator necessário'],
    'reautenticacao-necessaria': ['reautenticacao-necessaria', 401, 'Confirme a senha'],
    'sessao-bloqueada': ['sessao-bloqueada', 423, 'Sessão bloqueada'],
    'sessao-encerrada': ['nao-autenticado', 401, 'Sessão encerrada'],
    indisponivel: ['indisponivel', 503, 'Serviço indisponível'],
    'estabelecimento-invalido': ['entrada-invalida', 400, 'Estabelecimento inválido'],
    'primeiro-acesso': ['primeiro-acesso', 403, 'Senha ainda não definida'],
    'rede-desconhecida': ['rede-desconhecida', 404, 'Endereço sem rede configurada'],
    'trilha-indisponivel': ['trilha-indisponivel', 503, 'Trilha de auditoria indisponível'],
    'senha-recusada': ['entrada-invalida', 422, 'Senha nova recusada'],
    'troca-indisponivel': ['operacao-bloqueada', 409, 'Troca de senha indisponível'],
    'limite-sessoes': ['recusa-de-negocio', 409, 'Limite de sessões simultâneas'],
    'sessao-nao-encontrada': ['nao-encontrado', 404, 'Sessão não encontrada'],
    'pin-recusado': ['entrada-invalida', 422, 'PIN recusado'],
    'troca-rapida-recusada': ['nao-autenticado', 401, 'Usuário ou PIN não conferem'],
    'troca-rapida-desligada': ['operacao-bloqueada', 409, 'Troca rápida desligada'],
  };

const AMBIENTES_SEM_PREFIXO = new Set(['dev', 'ci']);

/**
 * Linha do log de uma recusa de login ou de troca de senha: rota, status, códigos das regras (ou o tipo da recusa) e
 * login. Nunca a senha nem o resumo: o registro é montado só destes campos.
 */
export function registroRecusa(
  rota: string,
  e: unknown,
  login: string | null,
): { rota: string; status: number; codigos: string[]; login: string | null } | null {
  if (e instanceof ErroSessao) {
    const status = TIPO_ERRO[e.tipo][1];
    const codigos = e.falhas?.length ? [...e.falhas] : [e.codigo ?? e.tipo];
    return { rota, status, codigos, login: e.login ?? login };
  }
  if (e instanceof ErroOperacao)
    return { rota, status: e.problema.status, codigos: [e.problema.codigo ?? 'recusa-da-operacao'], login };
  return null;
}

export function registrarRecusa(rota: string, e: unknown, login: string | null): void {
  const r = registroRecusa(rota, e, login);
  if (r && r.status < 500) logger.warn(r, 'recusa de senha');
}

@Controller()
export class AcessoController {
  constructor(
    @Inject(CONFIGURACAO) private readonly configuracao: Configuracao,
    @Inject(SERVICO_SESSAO) private readonly servico: ServicoSessao | null,
    @Inject(SESSAO_SINTETICA) private readonly sintetica: SessaoSintetica,
    @Inject(RESOLVEDOR_REDE) private readonly resolvedor: ResolvedorRede,
    @Optional()
    @Inject(SERVICO_LOGIN_CERTIFICADO)
    private readonly certificado: PortaLoginCertificado | null = null,
    @Optional()
    @Inject(SERVICO_RECUPERACAO_SENHA)
    private readonly recuperacao: PortaRecuperacaoSenha | null = null,
    @Optional()
    @Inject(SERVICO_TROCA_RAPIDA)
    private readonly trocaRapida: ServicoTrocaRapida | null = null,
    @Optional()
    @Inject(SERVICOS_NAO_MIGRADOS)
    private readonly naoMigrados: ReadonlySet<ServicoOpcionalAcesso> | null = null,
  ) {}

  /** Serviço opcional ausente: 501 se o módulo dele ainda não foi migrado (fora do boot); senão, 503. */
  private ausente(servico: ServicoOpcionalAcesso): never {
    if (this.naoMigrados?.has(servico))
      throw new ErroProblema(
        'recurso-desligado',
        501,
        'Módulo não migrado',
        'Este recurso ainda não está disponível nesta versão do sistema.',
      );
    throw new ErroProblema('indisponivel', 503, 'Serviço indisponível');
  }

  /** Prefixo __Host- no nome do cookie: falha para o lado seguro (só dev e ci ficam sem ele). */
  private get prefixoHost(): boolean {
    return !AMBIENTES_SEM_PREFIXO.has(this.configuracao.ambiente);
  }

  private erro(e: unknown): never {
    if (e instanceof ErroSessao) {
      const [tipo, status, titulo] = TIPO_ERRO[e.tipo];
      const regras = e.falhas?.map((c) => ({ codigo: c, mensagem: mensagemRegraSenha(c) }));
      const detalhe = regras?.length
        ? `${e.detalhe ?? 'A senha nova não cumpre a política de senha.'} ${regras.map((r) => r.mensagem).join(' ')}`
        : e.detalhe;
      throw new ErroProblema(tipo, status, titulo, detalhe, {
        ...(e.codigo ? { codigo: e.codigo } : {}),
        ...(e.falhas ? { falhas: e.falhas } : {}),
        ...(regras?.length ? { regras } : {}),
      });
    }
    const p = problemaDoAcessoEmail(e);
    if (p) throw p;
    throw e;
  }

  /** Rede do endereço de acesso (Host), nunca de dado do cliente (ARQ-2). */
  private rede(req: Req): string | null {
    const host = req.headers['host'];
    return this.resolvedor.resolver(Array.isArray(host) ? host[0] : host);
  }

  /** Estação e correlação do pedido para a trilha (MAQUINA_USUARIO "ESTACAO:origem"). */
  private origem(req: Req, posto: string | null = this.postoDoCookie(req)): OrigemPedido {
    const dispositivo = descreverDispositivo(req.headers['user-agent']);
    return {
      estacao: estacaoDaRequisicao(req),
      correlacao: correlacaoDaRequisicao(req, 'sessao'),
      ...(dispositivo ? { dispositivo } : {}),
      // Só o resumo do identificador do posto entra no serviço (o valor fica no cookie do navegador).
      ...(posto ? { posto: createHash('sha256').update(posto).digest('hex').slice(0, 64) } : {}),
    };
  }

  private postoDoCookie(req: Req): string | null {
    return lerCookiePosto(req.headers['cookie'] as string | undefined, this.prefixoHost);
  }

  /** W1-01 (revisão): o posto do login forte; sem cookie válido, um identificador novo (cookie devolvido junto). */
  private postoDaEntrada(req: Req): string {
    return this.postoDoCookie(req) ?? randomBytes(32).toString('base64url');
  }

  private servicoOu503(): ServicoSessao {
    if (!this.servico) throw new ErroProblema('indisponivel', 503, 'Serviço indisponível');
    return this.servico;
  }

  private idSessao(req: Req): string | null {
    return lerCookieSessao(req.headers['cookie'] as string | undefined, this.prefixoHost);
  }

  /**
   * CSRF por token duplo: o cabeçalho X-CSRF tem de ser igual ao cookie CSRF E ao token guardado na
   * sessão (tempo constante). Toda rota com sessão real que muda estado passa por aqui.
   */
  private async conferirCsrf(req: Req, id: string): Promise<void> {
    const servico = this.servicoOu503();
    const doCookie = lerCookie(req.headers['cookie'] as string | undefined, COOKIE_CSRF);
    const bruto = req.headers[CABECALHO_CSRF];
    const doCabecalho = Array.isArray(bruto) ? bruto[0] : bruto;
    const ok =
      !!doCookie &&
      !!doCabecalho &&
      doCookie === doCabecalho &&
      (await servico.csrfConfere(id, this.rede(req), doCabecalho).catch(() => false));
    if (!ok) throw new ErroProblema('sem-permissao', 403, 'Requisição não autenticada (CSRF)');
  }

  /** PÚBLICA (DP-49): nome do produto e marca da rede. */
  @Get('marca')
  @Publica('marca da rede antes do login (DP-49); sem dado de pessoa')
  marca(): MarcaPublica {
    return {
      produto: this.configuracao.produtoNome,
      marca: this.configuracao.marca,
      rede: this.configuracao.rede,
      treino: this.configuracao.ambiente === 'treino',
    };
  }

  /** PÚBLICA: lista do seletor (ARQ-1/ARQ-2), só da rede do endereço, sem dado sensível. */
  @Get('estabelecimentos')
  @Publica('seletor da tela de entrada (ARQ-1/ARQ-2); só código, nome e disponibilidade')
  estabelecimentos(@Req() req: Req): EstabelecimentosEntrada {
    try {
      return this.servicoOu503().estabelecimentos(this.rede(req));
    } catch (e) {
      this.erro(e);
    }
  }

  /** POST /api/sessao: entrar. Define o cookie da sessão e o cookie CSRF; o corpo não traz token. */
  @Post('sessao')
  @HttpCode(201)
  @Publica('login: a própria entrada (senha conferida no banco do cliente)')
  async entrar(
    @Body() corpo: unknown,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Res,
  ): Promise<Sessao> {
    const servico = this.servicoOu503();
    const r = esquemaEntrar.safeParse(corpo);
    if (!r.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'Informe estabelecimento, login e senha.',
      );
    try {
      // A sessão que o navegador ainda trazia é apagada no servidor (identificador novo a cada login).
      const posto = this.postoDaEntrada(req);
      const login = await servico.entrar(r.data, this.rede(req), this.idSessao(req), this.origem(req, posto));
      const op = { maxIdadeSegundos: login.ttlSegundos, prefixoHost: this.prefixoHost };
      res.header('set-cookie', [
        cookieSessao(login.idSessao, op),
        cookieCsrf(login.csrf, op),
        cookiePosto(posto, this.prefixoHost),
      ]);
      return login.sessao;
    } catch (e) {
      registrarRecusa('POST /api/sessao', e, r.data.login);
      this.erro(e);
    }
  }

  /**
   * POST /api/sessao/plataforma: entrada do administrador da plataforma (decisão do dono 2026-11-20, b). Credencial do
   * banco plataforma; todas as permissões no cliente escolhido (ou no único deste endereço). Mesmos cookies da entrada.
   */
  @Post('sessao/plataforma')
  @HttpCode(201)
  @Publica('login do administrador da plataforma (senha conferida no banco plataforma)')
  async entrarPlataforma(
    @Body() corpo: unknown,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Res,
  ): Promise<Sessao> {
    const servico = this.servicoOu503();
    const r = esquemaEntrarAdministradorPlataforma.safeParse(corpo);
    if (!r.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'Informe estabelecimento, login e senha (e o cliente, se houver mais de um).',
      );
    // O código do segundo fator (aplicativo ou e-mail) vem à parte: o contrato da entrada da plataforma não o descreve.
    const codigo = esquemaCodigoSegundoFator.safeParse(
      corpo && typeof corpo === 'object'
        ? (corpo as Record<string, unknown>)['codigoSegundoFator']
        : undefined,
    );
    try {
      const posto = this.postoDaEntrada(req);
      const login = await servico.entrarPlataforma(
        { ...r.data, ...(codigo.success ? { codigoSegundoFator: codigo.data } : {}) },
        this.rede(req),
        this.idSessao(req),
        this.origem(req, posto),
      );
      const op = { maxIdadeSegundos: login.ttlSegundos, prefixoHost: this.prefixoHost };
      res.header('set-cookie', [
        cookieSessao(login.idSessao, op),
        cookieCsrf(login.csrf, op),
        cookiePosto(posto, this.prefixoHost),
      ]);
      return login.sessao;
    } catch (e) {
      registrarRecusa('POST /api/sessao/plataforma', e, r.data.login);
      this.erro(e);
    }
  }

  // ── W1-01 (parte 7): "Esqueci a senha" (chave acesso.recuperacaoSenha e o servidor de envio do e-mail) ──

  @Get('sessao/recuperacao/disponivel')
  @Publica('o "Esqueci a senha" está liberado no estabelecimento? (sem dado de pessoa)')
  async recuperacaoDisponivel(
    @Query('estabelecimento') estabelecimento: string | undefined,
    @Req() req: Req,
  ): Promise<DisponibilidadeRecuperacaoSenha> {
    const rede = this.rede(req);
    if (!rede || !this.recuperacao) return { disponivel: false };
    return this.recuperacao.disponivel(rede, String(estabelecimento ?? '').slice(0, 10));
  }

  /** POST /api/sessao/recuperacao: a mesma resposta para qualquer login; o token vai só ao e-mail institucional. */
  @Post('sessao/recuperacao')
  @HttpCode(202)
  @Publica('pedido de recuperação de senha: resposta genérica, limite por hora por conta e por origem')
  @AuditadoNoHandler(
    'acesso.senha.recuperacao-pedida na trilha depois da resposta (só o login; nunca o token)',
  )
  pedirRecuperacao(@Body() corpo: unknown, @Req() req: Req): Promise<RespostaPedidoRecuperacaoSenha> {
    if (!this.recuperacao) this.ausente('recuperacao');
    const r = esquemaPedirRecuperacaoSenha.safeParse(corpo);
    if (!r.success)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Informe estabelecimento e login.');
    return this.recuperacao.pedir(this.redeOu404(req), r.data, req.ip ?? null, this.origem(req));
  }

  /** POST /api/sessao/recuperacao/usar: o token (uso único) vira a senha provisória; troca no próximo acesso. */
  @Post('sessao/recuperacao/usar')
  @HttpCode(200)
  @Publica('o token de uso único do e-mail institucional é a prova de posse (consumido de forma atômica)')
  @AuditadoNoHandler('executor: trilha_auditoria na mesma transação da operação acesso.redefinir-senha')
  async usarRecuperacao(@Body() corpo: unknown, @Req() req: Req): Promise<ResultadoRecuperacaoSenha> {
    if (!this.recuperacao) this.ausente('recuperacao');
    const r = esquemaUsarRecuperacaoSenha.safeParse(corpo);
    if (!r.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Link inválido ou vencido',
        'O link de recuperação é inválido. Peça outro em "Esqueci a senha".',
      );
    try {
      return await this.recuperacao.usar(this.redeOu404(req), r.data.token, this.origem(req));
    } catch (e) {
      if (e instanceof ErroOperacao) {
        const p = e.problema;
        throw new ErroProblema(
          p.status === 409 ? 'recusa-de-negocio' : tipoPorStatus(p.status),
          p.status,
          p.title,
          p.detail,
          p.codigo ? { codigo: p.codigo } : {},
        );
      }
      throw e;
    }
  }

  // ── M49 (etapa 3): entrada com certificado ICP-Brasil A1/A3 pelo agente local (chave acesso.loginCertificado) ──

  private servicoCertificado(): PortaLoginCertificado {
    if (!this.certificado) this.ausente('certificado');
    return this.certificado;
  }

  private redeOu404(req: Req): string {
    const r = this.rede(req);
    if (!r) throw new ErroProblema('rede-desconhecida', 404, 'Endereço sem rede configurada');
    return r;
  }

  @Get('sessao/certificado/disponivel')
  @Publica('a entrada com certificado está liberada no estabelecimento? (sem dado de pessoa)')
  async certificadoDisponivel(
    @Query('estabelecimento') estabelecimento: string | undefined,
    @Req() req: Req,
  ): Promise<DisponibilidadeLoginCertificado> {
    const rede = this.rede(req);
    if (!rede || !this.certificado) return { disponivel: false, agenteLocal: null };
    return this.certificado.disponivel(rede, String(estabelecimento ?? '').slice(0, 10));
  }

  @Post('sessao/certificado/desafio')
  @HttpCode(200)
  @Publica(
    'desafio de uso único da entrada com certificado (o agente local assina o hash; emissão limitada por origem)',
  )
  @AuditadoNoHandler('só o desafio no armazém das sessões; a recusa da entrada vai à trilha na resposta')
  certificadoDesafio(@Body() corpo: unknown, @Req() req: Req): Promise<DesafioLoginCertificado> {
    const r = esquemaDesafioLoginCertificado.safeParse(corpo);
    if (!r.success)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Informe estabelecimento e login.');
    return this.servicoCertificado().desafio(this.redeOu404(req), r.data, req.ip ?? null);
  }

  /** POST /api/sessao/certificado: a resposta do agente local; conferida, abre a sessão como o login. */
  @Post('sessao/certificado')
  @HttpCode(201)
  @Publica(
    'entrada com certificado: a assinatura do desafio conferida no servidor (cadeia, revogação, CPF, vínculo)',
  )
  @AuditadoNoHandler(
    'sessao.login.ok (ou sessao.login.certificado-falho) na trilha, como a entrada com senha',
  )
  async entrarComCertificado(
    @Body() corpo: unknown,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Res,
  ): Promise<Sessao> {
    const servico = this.servicoOu503();
    const r = esquemaRespostaAgenteLocal.safeParse(corpo);
    if (!r.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'Resposta do agente local inválida.',
      );
    const rede = this.redeOu404(req);
    const conta = await this.servicoCertificado().conferir(rede, r.data, this.origem(req));
    try {
      const posto = this.postoDaEntrada(req);
      const login = await servico.entrarComCertificado(
        conta,
        rede,
        this.idSessao(req),
        this.origem(req, posto),
      );
      const op = { maxIdadeSegundos: login.ttlSegundos, prefixoHost: this.prefixoHost };
      res.header('set-cookie', [
        cookieSessao(login.idSessao, op),
        cookieCsrf(login.csrf, op),
        cookiePosto(posto, this.prefixoHost),
      ]);
      return login.sessao;
    } catch (e) {
      this.erro(e);
    }
  }

  /** GET /api/sessao: sessão real (cookie) ou, só em dev/ci sem cookie, a sintética (para os testes). */
  @Get('sessao')
  @Publica('a própria sessão: responde 401 sem sessão válida')
  async atual(@Req() req: Req): Promise<Sessao> {
    const rede = this.rede(req);
    const id = this.servico ? this.idSessao(req) : null;
    if (this.servico && id) {
      try {
        // ler() grava o bloqueio por inatividade; tocar() nunca mexe em sessão bloqueada.
        const lido = await this.servico.ler(id, rede);
        if (lido) {
          if (!lido.sessao.bloqueada) await this.servico.tocar(id, rede);
          return lido.sessao;
        }
      } catch (e) {
        this.erro(e);
      }
      // Cookie de sessão que não vale (expirada, apagada ou de outra rede): nunca cai na sintética.
      throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária', 'Entre para continuar.');
    }
    if (rede && this.sintetica.disponivel()) return await this.sintetica.atual();
    throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária', 'Entre para continuar.');
  }

  /** DELETE /api/sessao: sair (apaga a sessão no servidor e os cookies). */
  @Delete('sessao')
  @HttpCode(204)
  @Publica('sair: só encerra a própria sessão (CSRF conferido no handler)')
  async sair(@Req() req: Req, @Res({ passthrough: true }) res: Res): Promise<void> {
    const id = this.servico ? this.idSessao(req) : null;
    if (this.servico && id) {
      await this.conferirCsrf(req, id);
      try {
        await this.servico.sair(id, this.rede(req), this.origem(req));
      } catch (e) {
        this.erro(e);
      }
    }
    res.header('set-cookie', cookiesApagados(this.prefixoHost));
  }

  @Post('sessao/reautenticar')
  @HttpCode(200)
  @Publica('reautenticação da própria sessão, inclusive bloqueada (CSRF e senha conferidos no handler)')
  async reautenticar(@Body() corpo: unknown, @Req() req: Req): Promise<Sessao> {
    const servico = this.servicoOu503();
    const id = this.idSessao(req);
    if (!id) throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    await this.conferirCsrf(req, id);
    const r = esquemaReautenticar.safeParse(corpo);
    if (!r.success) throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Informe a senha.');
    try {
      return await servico.reautenticar(id, this.rede(req), r.data.senha, this.origem(req));
    } catch (e) {
      this.erro(e);
    }
  }

  @Post('sessao/unidade')
  @HttpCode(200)
  @Publica('escolha da unidade da própria sessão, entre as dela (CSRF no handler)')
  async unidade(@Body() corpo: unknown, @Req() req: Req): Promise<Sessao> {
    const servico = this.servicoOu503();
    const id = this.idSessao(req);
    if (!id) throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    await this.conferirCsrf(req, id);
    const r = esquemaEscolherUnidade.safeParse(corpo);
    if (!r.success) throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos');
    try {
      return await servico.escolherUnidade(id, this.rede(req), r.data.codigo);
    } catch (e) {
      this.erro(e);
    }
  }

  /**
   * Troca de estabelecimento = novo login (ficha do M05). Com sessão real, encerra e pede novo login; em
   * dev/ci sem sessão real, troca a sintética em memória (os testes da casca do M07 continuam valendo).
   */
  @Post('sessao/estabelecimento')
  @HttpCode(200)
  @Publica('troca de estabelecimento = novo login (encerra a sessão; CSRF no handler)')
  async trocar(
    @Body() corpo: unknown,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Res,
  ): Promise<Sessao> {
    const id = this.servico ? this.idSessao(req) : null;
    if (this.servico && id) {
      await this.conferirCsrf(req, id);
      try {
        await this.servico.sair(id, this.rede(req), this.origem(req));
      } catch (e) {
        this.erro(e);
      }
      res.header('set-cookie', cookiesApagados(this.prefixoHost));
      throw new ErroProblema(
        'outro-estabelecimento',
        409,
        'Entre de novo no outro estabelecimento',
        'Trocar de estabelecimento é um novo login.',
      );
    }
    if (!this.rede(req) || !this.sintetica.disponivel())
      throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    const c = corpo as { codigo?: unknown };
    if (typeof c?.codigo !== 'string')
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Informe o estabelecimento.');
    const nova = this.sintetica.trocar(c.codigo);
    if (!nova)
      throw new ErroProblema('nao-encontrado', 404, 'Estabelecimento não encontrado', 'Escolha um da lista.');
    return nova;
  }

  /**
   * POST /api/sessao/senha: troca da própria senha (W1-01). A senha atual conferida vale como reautenticação; a
   * gravação é a operação acesso.trocar-senha pelo Executor do núcleo (credencial, histórico e trilha na mesma
   * transação). Recusa da política: 422 com `falhas` (só códigos). Sem a porta de senha: 409 (troca indisponível).
   */
  @AuditadoNoHandler('executor: trilha_auditoria na mesma transação da operação acesso.trocar-senha')
  @Post('sessao/senha')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.senhaTrocar)
  async senha(@Body() corpo: unknown, @Req() req: Req): Promise<Sessao> {
    const servico = this.servicoOu503();
    const id = this.idSessao(req);
    if (!id) throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    await this.conferirCsrf(req, id);
    const r = esquemaTrocarSenha.safeParse(corpo);
    if (!r.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'Informe a senha atual, a nova e a confirmação igual à nova.',
        { campos: [...new Set(r.error.issues.map((i) => String(i.path[0] ?? '')))].filter(Boolean) },
      );
    try {
      return await servico.trocarSenha(id, this.rede(req), r.data, this.origem(req));
    } catch (e) {
      registrarRecusa('POST /api/sessao/senha', e, null);
      if (e instanceof ErroOperacao) {
        // Recusa da receita (usuário bloqueado, alterado ao mesmo tempo…): só o código, nunca valores.
        const p = e.problema;
        throw new ErroProblema(
          p.status === 409 ? 'recusa-de-negocio' : tipoPorStatus(p.status),
          p.status,
          p.title,
          p.detail,
          {
            ...(p.codigo ? { codigo: p.codigo } : {}),
          },
        );
      }
      this.erro(e);
    }
  }

  /**
   * GET /api/sessao/senha/politica: as regras da política de senha vigente para a sessão (troca obrigatória ou
   * voluntária; administrador da plataforma usa a padrão do produto), com o código, o valor, a mensagem e se a tela
   * confere ao vivo. Nenhuma senha.
   */
  @Get('sessao/senha/politica')
  @Permissao(PERMISSOES_ACESSO.senhaTrocar)
  async politicaDaSenha(@Req() req: Req): Promise<{ login: string; regras: RegraPoliticaSenha[] }> {
    const servico = this.servicoOu503();
    const id = this.idSessao(req);
    if (!id) throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    try {
      return await servico.regrasSenha(id, this.rede(req));
    } catch (e) {
      this.erro(e);
    }
  }

  // ── W1-01 (parte 8): "Minhas sessões" (Preferências > Segurança) ──

  /** GET /api/sessao/sessoes: as sessões da própria pessoa no estabelecimento, a atual marcada. */
  @Get('sessao/sessoes')
  @Publica('as próprias sessões: responde 401 sem sessão válida; sem id, token nem endereço')
  async minhasSessoes(@Req() req: Req): Promise<MinhaSessaoTela[]> {
    const id = this.servico ? this.idSessao(req) : null;
    if (this.servico && id) {
      try {
        return await this.servico.minhasSessoes(id, this.rede(req));
      } catch (e) {
        this.erro(e);
      }
    }
    // dev/ci sem sessão real: a sintética é uma sessão só, sem outras para encerrar.
    if (this.rede(req) && this.sintetica.disponivel()) return [];
    throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária', 'Entre para continuar.');
  }

  /** POST /api/sessao/sessoes/encerrar: encerra as outras sessões (ou a da `ref`); a atual fica (é o Sair). */
  @Post('sessao/sessoes/encerrar')
  @HttpCode(200)
  @Publica('encerra só as próprias sessões (CSRF conferido no handler; cada uma vai à trilha)')
  async encerrarMinhasSessoes(@Body() corpo: unknown, @Req() req: Req): Promise<{ encerradas: number }> {
    const servico = this.servicoOu503();
    const id = this.idSessao(req);
    if (!id) throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    await this.conferirCsrf(req, id);
    const r = esquemaEncerrarMinhasSessoes.safeParse(corpo ?? {});
    if (!r.success) throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Sessão inválida.');
    try {
      return {
        encerradas: await servico.encerrarMinhasSessoes(
          id,
          this.rede(req),
          r.data.ref ?? null,
          this.origem(req),
        ),
      };
    } catch (e) {
      this.erro(e);
    }
  }

  // ── W1-01 (parte 11b2): PIN da troca rápida (Preferências > Segurança) e a troca na estação ──

  private trocaOu503(): ServicoTrocaRapida {
    if (!this.trocaRapida) this.ausente('trocaRapida');
    return this.trocaRapida;
  }

  /** Sessão real obrigatória (o PIN é da pessoa: a sintética não tem onde guardar). */
  private idOu401(req: Req): string {
    const id = this.servico ? this.idSessao(req) : null;
    if (!id) throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária', 'Entre para continuar.');
    return id;
  }

  private dadosInvalidos(issues: readonly { message: string }[]): never {
    throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', issues[0]?.message ?? undefined);
  }

  /** GET /api/sessao/pin: a situação do próprio PIN (definido, bloqueado, desde quando), sem o PIN nem o hash. */
  @Get('sessao/pin')
  @Permissao(PERMISSOES_ACESSO.senhaTrocar)
  async situacaoPin(@Req() req: Req): Promise<SituacaoPinTela> {
    const troca = this.trocaOu503();
    const id = this.idOu401(req);
    try {
      return await troca.situacao(id, this.rede(req));
    } catch (e) {
      this.erro(e);
    }
  }

  /** POST /api/sessao/pin: define ou troca o próprio PIN; a senha confere antes (reautenticação; CSRF). */
  @AuditadoNoHandler('o PIN e a trilha (acesso.pin.definido, sem o PIN nem o hash) na mesma transação')
  @Post('sessao/pin')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.senhaTrocar)
  async definirPin(@Body() corpo: unknown, @Req() req: Req): Promise<SituacaoPinTela> {
    const troca = this.trocaOu503();
    const id = this.idOu401(req);
    await this.conferirCsrf(req, id);
    const r = esquemaDefinirPin.safeParse(corpo);
    if (!r.success) this.dadosInvalidos(r.error.issues);
    try {
      return await troca.definir(id, this.rede(req), r.data, this.origem(req));
    } catch (e) {
      this.erro(e);
    }
  }

  /** POST /api/sessao/pin/retirar: retira o próprio PIN, com a senha (CSRF). */
  @AuditadoNoHandler('o PIN e a trilha (acesso.pin.retirado, com o motivo) na mesma transação')
  @Post('sessao/pin/retirar')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.senhaTrocar)
  async retirarPin(@Body() corpo: unknown, @Req() req: Req): Promise<SituacaoPinTela> {
    const troca = this.trocaOu503();
    const id = this.idOu401(req);
    await this.conferirCsrf(req, id);
    const r = esquemaRetirarPin.safeParse(corpo);
    if (!r.success) this.dadosInvalidos(r.error.issues);
    try {
      return await troca.retirar(id, this.rede(req), r.data, this.origem(req));
    } catch (e) {
      this.erro(e);
    }
  }

  /**
   * POST /api/sessao/troca-rapida: login + PIN na estação. Com a sessão anterior (cookie), o CSRF dela confere e ela
   * fica BLOQUEADA; a nova recebe cookies novos, como no entrar. Toda recusa é a mesma resposta genérica (401).
   */
  @Post('sessao/troca-rapida')
  @HttpCode(201)
  @Publica(
    'troca rápida: entrada por PIN depois do login forte de hoje na estação (conferida no serviço; trilha)',
  )
  async trocarUsuario(
    @Body() corpo: unknown,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Res,
  ): Promise<Sessao> {
    const troca = this.trocaOu503();
    const idAnterior = this.idSessao(req);
    if (idAnterior) await this.conferirCsrf(req, idAnterior);
    const r = esquemaTrocaRapida.safeParse(corpo);
    if (!r.success)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Informe o usuário e o PIN.');
    try {
      const login = await troca.trocar(r.data, this.rede(req), idAnterior, this.origem(req));
      const op = { maxIdadeSegundos: login.ttlSegundos, prefixoHost: this.prefixoHost };
      res.header('set-cookie', [cookieSessao(login.idSessao, op), cookieCsrf(login.csrf, op)]);
      return login.sessao;
    } catch (e) {
      this.erro(e);
    }
  }

  // M59-F2: GET/POST/DELETE /api/sessao/segundo-fator saíram do Bloqueio: ficam em identidade/identidade.controller.ts.
}
