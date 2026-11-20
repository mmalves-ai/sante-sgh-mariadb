// BFF do portal do prestador credenciado da operadora própria (M56, etapa 8, F7; ficha, seção 7; cap-08 §8.3.5). As rotas
// são @Publica para a guarda das sessões internas: é outro domínio de identidade (a conta em SGH_OPE_PORTAL_ACESSO), e
// cada handler confere a SESSÃO DO PORTAL DO PRESTADOR (cookie HttpOnly próprio) e, nas que mudam estado, o CSRF por
// token duplo (cookie sgh_portal_prestador_csrf + cabeçalho x-csrf-portal-prestador). Nada vem da tela sobre quem é o
// prestador: sai da conta, no servidor. A sessão dá `operadora.portal.acessar` só às funções liberadas.
//   POST /api/portal-prestador/:hospital/ativacao       a ativação com o código de uso único (senha e segundo fator)
//   POST /api/portal-prestador/:hospital/entrada        a entrada (e-mail, senha e código do aplicativo)
//   POST /api/portal-prestador/saida                    a saída
//   GET  /api/portal-prestador/sessao                   a própria sessão (401 sem ela)
//   GET  /api/portal-prestador/apoio                    os tipos de guia e a data do servidor (função 1)
//   GET  /api/portal-prestador/procedimentos?busca      a terminologia TUSS (função 1)
//   GET  /api/portal-prestador/autorizacoes?busca&apos  os pedidos do prestador (função 3)
//   GET  /api/portal-prestador/autorizacoes/:id         um pedido do prestador com os itens (função 3)
//   POST /api/portal-prestador/autorizacoes             o pedido de autorização (função 1; origem "Portal autorizador")
//   POST /api/portal-prestador/autorizacoes/:id/cancelar  o cancelamento do pedido dele não decidido (função 2)
//   GET  /api/portal-prestador/protocolos/:numero       a situação de um protocolo dele (função 7)
//   POST /api/portal-prestador/protocolos               W0-10: o prestador abre um protocolo de atendimento (função 7)
//   POST /api/portal-prestador/conta/senha              W0-10: a troca da senha (senha atual e código do aplicativo)
//   POST /api/portal-prestador/conta/autenticador       W0-10: o início da troca do autenticador (devolve o novo)
//   POST /api/portal-prestador/conta/autenticador/confirmacao  W0-10: o código do aplicativo novo grava a troca
//   POST /api/portal-prestador/autorizacoes/:id/complemento     W0-10: a resposta ao complemento, com até 5 anexos (corpo
//                                                               `application/vnd.sgh.anexos+json`, teto próprio)
//   GET  /api/portal-prestador/autorizacoes/:id/anexos/:anexo   W0-10: um anexo da resposta (só do próprio prestador)
//   POST /api/portal-prestador/protocolos/:id/interacoes/:evento/resposta  W0-10: a resposta a uma interação da operadora
//                                                               no protocolo, com um anexo (mesmo corpo com teto próprio)
//   GET  /api/portal-prestador/protocolos/:id/respostas/:resposta/anexo     W0-10: o anexo da resposta (só do prestador)
//   GET  /api/portal-prestador/elegibilidade            W0-10 (M7): as últimas consultas; POST: a consulta registrada
//   POST /api/portal-prestador/contas                   W0-10 (M8): o envio do lote XML TISS (o protocolo); GET: os lotes
//   GET  /api/portal-prestador/contas/:id/demonstrativo W0-10 (M8): o demonstrativo de análise de um lote do prestador
//   GET  /api/portal-prestador/contas/:id/demonstrativo-pagamento  W0-10 (M8): o demonstrativo de pagamento (lote pago)
//   GET  /api/portal-prestador/contas/:id/glosas        W0-10 (M8): as glosas do lote, com o recurso de cada item
//   POST /api/portal-prestador/contas/:id/recursos      W0-10 (M8): o recurso de glosa por item de uma guia
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  type OnModuleInit,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  type ApoioPortalPrestador,
  type AutorizacaoPortal,
  CABECALHO_CSRF_PORTAL_PRESTADOR,
  COOKIE_CSRF_PORTAL_PRESTADOR,
  COOKIE_PORTAL_PRESTADOR,
  COOKIE_PORTAL_PRESTADOR_DEV,
  type ProtocoloPortal,
  esquemaAtivarPortalPrestador,
  esquemaBuscaProcedimento,
  esquemaConsultarElegibilidadePortal,
  type ConsultasElegibilidadePortal,
  type ContasPortal,
  esquemaFiltroContasPortal,
  esquemaRegistrarRecursoItens,
  type GlosasContaPortal,
  esquemaReceberConta,
  type ResultadoConta,
  type ElegibilidadePortal,
  type AutenticadorNovoPortalPrestador,
  esquemaCancelarAutorizacao,
  esquemaConfirmarAutenticadorPortalPrestador,
  esquemaEntrarPortalPrestador,
  esquemaFiltroAutorizacoesPortal,
  esquemaIniciarAutenticadorPortalPrestador,
  esquemaRegistrarAutorizacao,
  esquemaResponderComplementoPortal,
  esquemaAbrirProtocoloPortal,
  esquemaResponderInteracaoPortal,
  LIMITE_CORPO_ANEXOS_PORTAL,
  esquemaTrocarSenhaPortalPrestador,
  ROTAS_PORTAL_PRESTADOR as R,
  type ResultadoAutorizacao,
  type ResultadoComplementoPortal,
  type ResultadoInteracaoPortal,
  type ResultadoProtocoloPortalAberto,
  type SessaoPortalPrestador,
  TIPO_CORPO_ANEXOS_PORTAL,
} from '@sgh/contratos';
import { AuditadoNoHandler, Publica } from '../../autorizacao/decoradores.js';
import { CONFIGURACAO, type Configuracao } from '../../configuracao.js';
import { ErroProblema } from '../../problema.filter.js';
import { lerCookie } from '../../sessao/cookies.js';
import { corpo } from '../exames/public-api.js';
import { PORTA_CONTAS_OPERADORA, type PortaContasOperadora } from './contas-porta.js';
import { ServicoContasPortalPrestador } from './portal-prestador-contas.js';
import {
  type EntradaPortalPrestador,
  ORIGEM_PORTAL,
  SERVICO_PORTAL_PRESTADOR,
  type ServicoPortalPrestador,
} from './portal-prestador-servico.js';

const SEM_PREFIXO = new Set(['dev', 'ci']);

interface Req {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly ip?: string;
}
interface Res {
  header(nome: string, valor: string | string[]): unknown;
}

const hospitalDaRota = (h: string): string => {
  if (!/^[a-z0-9]{1,10}$/.test(h))
    throw new ErroProblema('nao-encontrado', 404, 'Estabelecimento não encontrado');
  return h;
};
const um = (v: string | string[] | undefined): string | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
const idRota = (v: string): number => {
  if (!/^[1-9]\d{0,17}$/.test(v)) throw new ErroProblema('nao-encontrado', 404, 'Pedido não encontrado');
  return Number(v);
};

const anexoRota = (v: string): number => {
  if (!/^[1-9]\d{0,17}$/.test(v)) throw new ErroProblema('nao-encontrado', 404, 'Anexo não encontrado');
  return Number(v);
};

/** O pedaço do Fastify usado para o tipo do corpo com anexos (o JSON padrão, com teto próprio). */
interface InstanciaComParser {
  hasContentTypeParser(tipo: string): boolean;
  addContentTypeParser(tipo: string, opcoes: { parseAs: 'string'; bodyLimit: number }, parser: unknown): void;
  getDefaultJsonParser(proto: 'error', construtor: 'error'): unknown;
}

@Controller()
export class PortalPrestadorController implements OnModuleInit {
  private readonly contas: ServicoContasPortalPrestador;

  constructor(
    @Inject(CONFIGURACAO) private readonly configuracao: Configuracao,
    @Inject(SERVICO_PORTAL_PRESTADOR) private readonly portal: ServicoPortalPrestador,
    private readonly adaptador: HttpAdapterHost,
    @Inject(PORTA_CONTAS_OPERADORA) portaContas: PortaContasOperadora,
  ) {
    this.contas = new ServicoContasPortalPrestador(portal, portaContas);
  }

  /**
   * W0-10: o corpo com anexos (5 de até 2 MB em base64) passa do teto padrão do JSON; ele vem com um tipo próprio, que só
   * esta rota aceita (o esquema é estrito), com o mesmo parser JSON seguro do Fastify e o teto de 15 MB.
   */
  onModuleInit(): void {
    const f = this.adaptador.httpAdapter?.getInstance?.() as InstanciaComParser | undefined;
    if (!f?.hasContentTypeParser || f.hasContentTypeParser(TIPO_CORPO_ANEXOS_PORTAL)) return;
    f.addContentTypeParser(
      TIPO_CORPO_ANEXOS_PORTAL,
      { parseAs: 'string', bodyLimit: LIMITE_CORPO_ANEXOS_PORTAL },
      f.getDefaultJsonParser('error', 'error'),
    );
  }

  private get nomeCookie(): string {
    return SEM_PREFIXO.has(this.configuracao.ambiente)
      ? COOKIE_PORTAL_PRESTADOR_DEV
      : COOKIE_PORTAL_PRESTADOR;
  }

  private cookies(e: EntradaPortalPrestador): string[] {
    return [
      [
        `${this.nomeCookie}=${e.id}`,
        'Path=/',
        'HttpOnly',
        'Secure',
        'SameSite=Strict',
        `Max-Age=${e.ttlSegundos}`,
      ].join('; '),
      [
        `${COOKIE_CSRF_PORTAL_PRESTADOR}=${e.csrf}`,
        'Path=/',
        'Secure',
        'SameSite=Strict',
        `Max-Age=${e.ttlSegundos}`,
      ].join('; '),
    ];
  }

  private idSessao(req: Req): string | null {
    return lerCookie(um(req.headers['cookie']) ?? undefined, this.nomeCookie);
  }

  private sessao(req: Req, escrita = false) {
    return this.portal.sessao(
      this.idSessao(req),
      escrita
        ? {
            cookie: lerCookie(um(req.headers['cookie']) ?? undefined, COOKIE_CSRF_PORTAL_PRESTADOR),
            cabecalho: um(req.headers[CABECALHO_CSRF_PORTAL_PRESTADOR]),
          }
        : undefined,
    );
  }

  private ip(req: Req): string {
    return (req.ip ?? 'desconhecido').slice(0, 50);
  }

  @Post(R.ativar)
  @HttpCode(200)
  @Publica(
    'ativação do acesso do prestador ao portal (código de uso único conferido no serviço; limite de taxa)',
  )
  @AuditadoNoHandler('a ativação (SGH_OPE_PORTAL_ACESSO) com a SGH_TRILHA na mesma transação')
  ativar(@Param('hospital') hospital: string, @Body() b: unknown, @Req() req: Req) {
    return this.portal.ativar(hospitalDaRota(hospital), corpo(esquemaAtivarPortalPrestador, b), this.ip(req));
  }

  @Post(R.entrar)
  @HttpCode(200)
  @Publica(
    'entrada do prestador no portal (senha Argon2id e segundo fator conferidos no serviço; limite de taxa)',
  )
  @AuditadoNoHandler('a tentativa de entrada (SGH_OPE_PORTAL_ACESSO) com a SGH_TRILHA na mesma transação')
  async entrar(
    @Param('hospital') hospital: string,
    @Body() b: unknown,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Res,
  ): Promise<SessaoPortalPrestador> {
    const r = await this.portal.entrar(
      hospitalDaRota(hospital),
      corpo(esquemaEntrarPortalPrestador, b),
      this.ip(req),
    );
    res.header('set-cookie', this.cookies(r));
    return r.sessao;
  }

  @Post(R.sair)
  @HttpCode(200)
  @Publica('saída do portal do prestador (a sessão do portal deixa de valer)')
  sair(@Req() req: Req, @Res({ passthrough: true }) res: Res): { ok: true } {
    this.portal.sair(this.idSessao(req));
    res.header('set-cookie', [`${this.nomeCookie}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`]);
    return { ok: true };
  }

  @Get(R.sessao)
  @Header('cache-control', 'no-store')
  @Publica('a própria sessão do portal do prestador: 401 sem ela')
  eu(@Req() req: Req): SessaoPortalPrestador {
    return this.portal.eu(this.sessao(req));
  }

  @Get(R.apoio)
  @Header('cache-control', 'no-store')
  @Publica('o apoio do pedido pelo portal do prestador (sessão conferida no handler)')
  apoio(@Req() req: Req): Promise<ApoioPortalPrestador> {
    return this.portal.apoio(this.sessao(req));
  }

  @Get(R.procedimentos)
  @Header('cache-control', 'no-store')
  @Publica('a terminologia TUSS para o pedido pelo portal do prestador (sessão conferida no handler)')
  procedimentos(@Query() q: Record<string, string | undefined>, @Req() req: Req) {
    const f = esquemaBuscaProcedimento.safeParse(q ?? {});
    if (!f.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Parâmetros inválidos',
        'Digite ao menos 2 caracteres para buscar.',
      );
    return this.portal.procedimentos(this.sessao(req), f.data.busca);
  }

  @Get(R.autorizacoes)
  @Header('cache-control', 'no-store')
  @Publica('os pedidos de autorização do prestador da sessão do portal (conferida no handler)')
  @AuditadoNoHandler('a leitura vai à SGH_TRILHA (operadora.portal.autorizacao-lida) sem dado pessoal')
  autorizacoes(
    @Query() q: Record<string, string | undefined>,
    @Req() req: Req,
  ): Promise<{ itens: AutorizacaoPortal[]; proxima: number | null }> {
    const f = esquemaFiltroAutorizacoesPortal.safeParse(q ?? {});
    if (!f.success)
      throw new ErroProblema('entrada-invalida', 400, 'Parâmetros inválidos', 'Filtro inválido.');
    return this.portal.autorizacoesDoPrestador(
      this.sessao(req),
      { ...(f.data.busca ? { busca: f.data.busca } : {}), ...(f.data.apos ? { apos: f.data.apos } : {}) },
      this.ip(req),
    );
  }

  @Get(R.autorizacao)
  @Header('cache-control', 'no-store')
  @Publica('um pedido de autorização do prestador da sessão do portal (conferida no handler)')
  @AuditadoNoHandler('a leitura vai à SGH_TRILHA (operadora.portal.autorizacao-lida) sem dado pessoal')
  autorizacao(@Param('id') id: string, @Req() req: Req) {
    return this.portal.autorizacaoDoPrestador(this.sessao(req), idRota(id), this.ip(req));
  }

  @Post(R.autorizacoes)
  @HttpCode(200)
  @Publica(
    'pedido de autorização do prestador (sessão e CSRF do portal conferidos no handler; prestador da conta)',
  )
  @AuditadoNoHandler(
    'operadora.registrarAutorizacao (SGH_OPE_AUTORIZACAO) com a SGH_TRILHA na mesma transação',
  )
  solicitar(@Body() b: unknown, @Req() req: Req): Promise<ResultadoAutorizacao> {
    const s = this.sessao(req, true);
    const entrada = (b ?? {}) as Record<string, unknown>;
    // O prestador e a origem saem da conta e do portal; o executante não vem do portal (nunca da tela).
    const e = corpo(esquemaRegistrarAutorizacao, {
      ...entrada,
      prestador: s.prestador,
      executante: null,
      origem: ORIGEM_PORTAL,
    });
    return this.portal.solicitar(s, e, this.ip(req));
  }

  @Post(R.cancelar)
  @HttpCode(200)
  @Publica(
    'o prestador cancela o próprio pedido não decidido (sessão e CSRF do portal conferidos no handler)',
  )
  @AuditadoNoHandler(
    'operadora.cancelarAutorizacao (SGH_OPE_AUTORIZACAO) com a SGH_TRILHA na mesma transação',
  )
  cancelar(@Param('id') id: string, @Body() b: unknown, @Req() req: Req): Promise<ResultadoAutorizacao> {
    const s = this.sessao(req, true);
    return this.portal.cancelar(s, idRota(id), corpo(esquemaCancelarAutorizacao, b), this.ip(req));
  }

  @Post(R.complemento)
  @HttpCode(200)
  @Publica(
    'o prestador responde ao complemento pedido pelo auditor numa autorização dele (sessão e CSRF do portal conferidos no handler)',
  )
  @AuditadoNoHandler(
    'operadora.responderComplementoPortal (SGH_OPE_AUTORIZACAO, _EVT e SGH_OPE_AUT_ANEXO) com a SGH_TRILHA na mesma transação',
  )
  responderComplemento(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: Req,
  ): Promise<ResultadoComplementoPortal> {
    const s = this.sessao(req, true);
    return this.portal.responderComplemento(
      s,
      idRota(id),
      corpo(esquemaResponderComplementoPortal, b),
      this.ip(req),
    );
  }

  @Get(R.anexo)
  @Header('cache-control', 'no-store')
  @Publica('um anexo da resposta ao complemento do prestador da sessão do portal (conferida no handler)')
  @AuditadoNoHandler('a leitura vai à SGH_TRILHA (operadora.portal.autorizacao-lida) sem dado pessoal')
  async anexo(
    @Param('id') id: string,
    @Param('anexo') anexo: string,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Res,
  ): Promise<Buffer> {
    const x = await this.portal.anexoDoComplemento(
      this.sessao(req),
      idRota(id),
      anexoRota(anexo),
      this.ip(req),
    );
    res.header('content-type', x.tipo);
    res.header('content-disposition', `attachment; filename="${encodeURIComponent(x.nome)}"`);
    res.header('x-anexo-sha256', x.sha256);
    res.header('x-content-type-options', 'nosniff');
    return x.bytes;
  }

  @Get(R.protocolo)
  @Header('cache-control', 'no-store')
  @Publica('a situação de um protocolo do prestador da sessão do portal (conferida no handler)')
  protocolo(@Param('numero') numero: string, @Req() req: Req): Promise<ProtocoloPortal> {
    return this.portal.protocolo(this.sessao(req), numero);
  }

  @Post(R.protocolos)
  @HttpCode(200)
  @Publica('o prestador abre um protocolo de atendimento (sessão e CSRF do portal conferidos no handler)')
  @AuditadoNoHandler(
    'operadora.registrarProtocolo pelo portal (SGH_OPE_PROTOCOLO e o evento) com a SGH_TRILHA na mesma transação',
  )
  abrirProtocolo(@Body() b: unknown, @Req() req: Req): Promise<ResultadoProtocoloPortalAberto> {
    const s = this.sessao(req, true);
    return this.portal.abrirProtocolo(s, corpo(esquemaAbrirProtocoloPortal, b), this.ip(req));
  }

  @Post(R.interacaoResposta)
  @HttpCode(200)
  @Publica(
    'o prestador responde a uma interação da operadora num protocolo dele (sessão e CSRF do portal conferidos no handler)',
  )
  @AuditadoNoHandler(
    'operadora.responderInteracaoPrestador (SGH_OPE_PROTOCOLO, _EVT e SGH_OPE_PROT_RESPOSTA) com a SGH_TRILHA na mesma transação',
  )
  responderInteracao(
    @Param('id') id: string,
    @Param('evento') evento: string,
    @Body() b: unknown,
    @Req() req: Req,
  ): Promise<ResultadoInteracaoPortal> {
    const s = this.sessao(req, true);
    return this.portal.responderInteracao(
      s,
      idRota(id),
      idRota(evento),
      corpo(esquemaResponderInteracaoPortal, b),
      this.ip(req),
    );
  }

  @Get(R.anexoProtocolo)
  @Header('cache-control', 'no-store')
  @Publica(
    'o anexo de uma resposta do prestador da sessão do portal num protocolo dele (conferida no handler)',
  )
  @AuditadoNoHandler('a leitura vai à SGH_TRILHA (operadora.portal.autorizacao-lida) sem dado pessoal')
  async anexoProtocolo(
    @Param('id') id: string,
    @Param('resposta') resposta: string,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Res,
  ): Promise<Buffer> {
    const x = await this.portal.anexoDoProtocolo(
      this.sessao(req),
      idRota(id),
      anexoRota(resposta),
      this.ip(req),
    );
    res.header('content-type', x.tipo);
    res.header('content-disposition', `attachment; filename="${encodeURIComponent(x.nome)}"`);
    res.header('x-anexo-sha256', x.sha256);
    res.header('x-content-type-options', 'nosniff');
    return x.bytes;
  }

  @Get(R.elegibilidade)
  @Header('cache-control', 'no-store')
  @Publica('as últimas consultas de elegibilidade do prestador da sessão do portal (conferida no handler)')
  consultasElegibilidade(@Req() req: Req): Promise<ConsultasElegibilidadePortal> {
    return this.portal.consultasElegibilidade(this.sessao(req));
  }

  @Post(R.elegibilidade)
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  @Publica(
    'a elegibilidade do beneficiário pela carteirinha (sessão e CSRF do portal conferidos no handler; operadora da conta)',
  )
  @AuditadoNoHandler(
    'a consulta registrada em SGH_OPE_ELEG_CONSULTA com a SGH_TRILHA na mesma transação (operadora.portal.elegibilidade-consultada)',
  )
  elegibilidade(@Body() b: unknown, @Req() req: Req): Promise<ElegibilidadePortal> {
    const s = this.sessao(req, true);
    return this.portal.elegibilidade(s, corpo(esquemaConsultarElegibilidadePortal, b), this.ip(req));
  }

  @Post(R.senha)
  @HttpCode(200)
  @Publica(
    'o prestador troca a própria senha (sessão e CSRF do portal; senha atual e código conferidos no serviço)',
  )
  @AuditadoNoHandler('a troca (SGH_OPE_PORTAL_ACESSO) com a SGH_TRILHA na mesma transação; o erro também')
  trocarSenha(@Body() b: unknown, @Req() req: Req): Promise<{ mensagem: string }> {
    const s = this.sessao(req, true);
    return this.portal.trocarSenha(s, corpo(esquemaTrocarSenhaPortalPrestador, b), this.ip(req));
  }

  @Post(R.autenticador)
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  @Publica(
    'o início da troca do autenticador (sessão e CSRF do portal; senha e código atual conferidos no serviço)',
  )
  @AuditadoNoHandler(
    'o erro de senha ou código vai à SGH_TRILHA com o contador; o segredo novo fica só na sessão',
  )
  iniciarAutenticador(@Body() b: unknown, @Req() req: Req): Promise<AutenticadorNovoPortalPrestador> {
    const s = this.sessao(req, true);
    return this.portal.iniciarAutenticador(
      s,
      corpo(esquemaIniciarAutenticadorPortalPrestador, b),
      this.ip(req),
    );
  }

  @Post(R.autenticadorConfirmar)
  @HttpCode(200)
  @Publica('a confirmação do autenticador novo (sessão e CSRF do portal; o código do aplicativo novo)')
  @AuditadoNoHandler('a troca (SGH_OPE_PORTAL_ACESSO) com a SGH_TRILHA na mesma transação')
  confirmarAutenticador(@Body() b: unknown, @Req() req: Req): Promise<{ mensagem: string }> {
    const s = this.sessao(req, true);
    return this.portal.confirmarAutenticador(
      s,
      corpo(esquemaConfirmarAutenticadorPortalPrestador, b).codigo,
      this.ip(req),
    );
  }

  @Get(R.contas)
  @Header('cache-control', 'no-store')
  @Publica('os lotes de contas do prestador da sessão do portal (conferida no handler; só os dele)')
  listaContas(@Query() q: Record<string, string | undefined>, @Req() req: Req): Promise<ContasPortal> {
    const f = esquemaFiltroContasPortal.safeParse(q ?? {});
    if (!f.success)
      throw new ErroProblema('entrada-invalida', 400, 'Parâmetros inválidos', 'Filtro inválido.');
    return this.contas.lista(this.sessao(req), f.data.apos);
  }

  @Post(R.contas)
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  @Publica(
    'o envio do lote XML TISS pelo prestador (sessão e CSRF do portal conferidos no handler; o lote tem de ser dele)',
  )
  @AuditadoNoHandler(
    'o lote (SGH_OPE_CONTA, as guias, os itens e o evento) com a SGH_TRILHA na mesma transação (operadora.portal.lote-enviado)',
  )
  enviarLote(@Body() b: unknown, @Req() req: Req): Promise<ResultadoConta> {
    const s = this.sessao(req, true);
    return this.contas.enviar(s, corpo(esquemaReceberConta, b), this.ip(req));
  }

  @Get(R.contaDemonstrativo)
  @Header('cache-control', 'no-store')
  @Publica('o demonstrativo de análise de um lote do prestador da sessão do portal (conferida no handler)')
  @AuditadoNoHandler('a leitura vai à SGH_TRILHA (operadora.portal.demonstrativo-baixado)')
  demonstrativoConta(
    @Param('id') id: string,
    @Req() req: Req,
  ): Promise<{ nome: string; xmlBase64: string; hash: string }> {
    return this.contas.demonstrativo(this.sessao(req), idRota(id), this.ip(req));
  }

  @Get(R.contaGlosas)
  @Header('cache-control', 'no-store')
  @Publica(
    'as glosas de um lote do prestador da sessão do portal (conferida no handler; 404 para o lote de outro)',
  )
  glosasConta(@Param('id') id: string, @Req() req: Req): Promise<GlosasContaPortal> {
    return this.contas.glosas(this.sessao(req), idRota(id));
  }

  @Post(R.contaRecursos)
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  @Publica(
    'o recurso de glosa por item do prestador (sessão e CSRF do portal conferidos no handler; o lote tem de ser dele)',
  )
  @AuditadoNoHandler(
    'o recurso (SGH_OPE_CONTA_RECURSO_ITEM e a guia) com a SGH_TRILHA na mesma transação (operadora.portal.recurso-item-enviado)',
  )
  recorrerConta(@Param('id') id: string, @Body() b: unknown, @Req() req: Req): Promise<ResultadoConta> {
    const s = this.sessao(req, true);
    return this.contas.recorrer(s, idRota(id), corpo(esquemaRegistrarRecursoItens, b), this.ip(req));
  }

  @Get(R.contaDemonstrativoPagamento)
  @Header('cache-control', 'no-store')
  @Publica(
    'o demonstrativo de pagamento de um lote quitado do prestador da sessão do portal (conferida no handler)',
  )
  @AuditadoNoHandler('a leitura vai à SGH_TRILHA (operadora.portal.demonstrativo-pagamento-baixado)')
  demonstrativoPagamentoConta(
    @Param('id') id: string,
    @Req() req: Req,
  ): Promise<{ nome: string; xmlBase64: string; hash: string }> {
    return this.contas.demonstrativo(this.sessao(req), idRota(id), this.ip(req), 'pagamento');
  }
}
