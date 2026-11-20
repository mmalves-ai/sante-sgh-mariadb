// Portal do paciente (M50, etapa 1; ficha, seção 7 e regras 1, 5 e 13). As rotas são @Publica para a guarda das sessões
// internas: o portal é outro domínio de identidade (a conta do paciente em SGH_POR_CONTA) e cada handler confere a
// SESSÃO DO PORTAL (cookie próprio, HttpOnly) e, nas que mudam estado, o CSRF por token duplo próprio (cookie
// sgh_pac_csrf + cabeçalho x-csrf-paciente). A sessão do portal nunca vale nas rotas internas, e a interna nunca vale
// aqui. O estabelecimento vem do endereço.
//   GET    /api/paciente/estabelecimento               o estabelecimento padrão do endereço
//   POST   /api/paciente/:hospital/convite             primeiro acesso, passo 1: convite e nascimento (cookie de 10 min)
//   POST   /api/paciente/ativacao                      passo 2: e-mail, senha e termos → o otpauth do autenticador
//   POST   /api/paciente/ativacao/segundo-fator        passo 3: o primeiro código → conta ativa e sessão aberta
//   POST   /api/paciente/:hospital/entrada             entrar (e-mail, senha e código; tentativas e taxa)
//   GET/POST /api/paciente/copias · GET /api/paciente/copias/:protocolo/pdf   W0-10 (M2): cópia do prontuário
//   POST   /api/paciente/pedidos/:protocolo/cancelamento   W0-10: o titular cancela com motivo o pedido não respondido
//   GET    /api/paciente/portabilidade/:protocolo/ips   W0-10 (M3): o pacote FHIR R4/IPS do pedido de portabilidade atendido
//   GET    /api/paciente/eu · DELETE /api/paciente/sessao · PUT /api/paciente/titular
//   GET    /api/paciente/seguranca · POST /api/paciente/senha
//   POST   /api/paciente/email · DELETE /api/paciente/email/troca         W0-10: troca do e-mail (link no e-mail novo)
//   POST   /api/paciente/:hospital/email/confirmacao                     o link do e-mail novo (sem sessão; taxa)
//   POST   /api/paciente/segundo-fator/troca · …/troca/confirmacao       W0-10: troca do autenticador pelo titular
//   GET    /api/paciente/documentos · POST /api/paciente/documentos/:origem/:item · GET …/documento/:item/pdf
//   GET    /api/paciente/vinculos · POST …/vinculos/arquivo · POST …/vinculos · DELETE …/vinculos/:id
//   GET    /api/paciente/consentimentos · POST /api/paciente/consentimentos
//   GET    /api/paciente/pedidos · POST /api/paciente/pedidos
//   GET    /api/paciente/manifestacoes · POST /api/paciente/manifestacoes   W0-10 (M1): ouvidoria pelo portal
//   GET    /api/paciente/acessos?de&ate&pagina
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
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
  esquemaAbrirItemPortal,
  esquemaArquivoProva,
  esquemaAtivarContaPortal,
  esquemaConferirConvite,
  esquemaConferirCredenciaisPortal,
  esquemaConfirmarSegundoFator,
  esquemaConfirmarTrocaEmailPortal,
  esquemaConsentimentoPortal,
  esquemaEntrarContaPortal,
  esquemaEscolherTitular,
  esquemaFiltroAcessosTitular,
  esquemaPedidoTitularPortal,
  esquemaCancelarPedidoPortal,
  esquemaPedirCopiaPortal,
  esquemaManifestacaoPortal,
  esquemaPedirTrocaEmailPortal,
  esquemaPedirVinculo,
  esquemaTrocarSenhaPortal,
} from '@sgh/contratos';
import { AuditadoNoHandler, Publica } from '../../autorizacao/decoradores.js';
import { CONFIGURACAO, type Configuracao } from '../../configuracao.js';
import { ErroProblema } from '../../problema.filter.js';
import { lerCookie } from '../../sessao/cookies.js';
import { corpo } from '../exames/public-api.js';
import {
  type AtivacaoAberta,
  type PortalNoPedido,
  type SessaoAberta,
  ServicoPortalPaciente,
  VERSAO_CONSENTIMENTO,
  VERSAO_POLITICA,
  VERSAO_TERMO_USO,
} from './aplicacao/servico.js';

export const SERVICO_PORTAL_PACIENTE = Symbol('SERVICO_PORTAL_PACIENTE');
export const COOKIE_PACIENTE = '__Host-sgh_pac';
export const COOKIE_PACIENTE_DEV = 'sgh_pac';
export const COOKIE_ATIVACAO = '__Host-sgh_pac_atv';
export const COOKIE_ATIVACAO_DEV = 'sgh_pac_atv';
export const COOKIE_CSRF_PACIENTE = 'sgh_pac_csrf';
export const CABECALHO_CSRF_PACIENTE = 'x-csrf-paciente';
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
  if (!/^[1-9]\d{0,17}$/.test(v)) throw new ErroProblema('nao-encontrado', 404, 'Não encontrado');
  return Number(v);
};

@Controller('paciente')
export class PortalPacienteController {
  constructor(
    @Inject(CONFIGURACAO) private readonly configuracao: Configuracao,
    @Inject(SERVICO_PORTAL_PACIENTE) private readonly portal: ServicoPortalPaciente,
  ) {}

  private get prefixoHost(): boolean {
    return !SEM_PREFIXO.has(this.configuracao.ambiente);
  }
  private get nomeCookie(): string {
    return this.prefixoHost ? COOKIE_PACIENTE : COOKIE_PACIENTE_DEV;
  }
  private get nomeAtivacao(): string {
    return this.prefixoHost ? COOKIE_ATIVACAO : COOKIE_ATIVACAO_DEV;
  }

  private cookies(nome: string, e: { id: string; csrf: string; ttlSegundos: number }): string[] {
    return [
      [`${nome}=${e.id}`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict', `Max-Age=${e.ttlSegundos}`].join(
        '; ',
      ),
      [
        `${COOKIE_CSRF_PACIENTE}=${e.csrf}`,
        'Path=/',
        'Secure',
        'SameSite=Strict',
        `Max-Age=${e.ttlSegundos}`,
      ].join('; '),
    ];
  }

  private apagar(nome: string): string {
    return [`${nome}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Strict', 'Secure'].join('; ');
  }

  private csrf(req: Req) {
    return {
      cookie: lerCookie(um(req.headers['cookie']) ?? undefined, COOKIE_CSRF_PACIENTE),
      cabecalho: um(req.headers[CABECALHO_CSRF_PACIENTE]),
    };
  }

  private idSessao(req: Req): string | null {
    return lerCookie(um(req.headers['cookie']) ?? undefined, this.nomeCookie);
  }

  private sessao(req: Req, escrita = false): Promise<PortalNoPedido> {
    return this.portal.sessao(this.idSessao(req), escrita ? this.csrf(req) : undefined);
  }

  private ip(req: Req): string {
    return (req.ip ?? 'desconhecido').slice(0, 50);
  }

  private abrir(res: Res, r: SessaoAberta) {
    res.header('set-cookie', [...this.cookies(this.nomeCookie, r), this.apagar(this.nomeAtivacao)]);
    return r.sessao;
  }

  @Get('estabelecimento')
  @Publica(
    'o estabelecimento padrão do portal do paciente e as versões vigentes dos termos (sem dado de pessoa)',
  )
  estabelecimento() {
    return {
      estabelecimento: this.portal.estabelecimentoPadrao,
      termoUso: VERSAO_TERMO_USO,
      politica: VERSAO_POLITICA,
      consentimento: VERSAO_CONSENTIMENTO,
    };
  }

  @Post(':hospital/convite')
  @HttpCode(204)
  @Publica(
    'primeiro acesso ao portal do paciente: o código do convite e a data de nascimento (erro genérico; taxa)',
  )
  @AuditadoNoHandler('a conferência errada do convite (SGH_POR_CONTA) com a SGH_TRILHA na mesma transação')
  async convite(
    @Param('hospital') hospital: string,
    @Body() b: unknown,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Res,
  ): Promise<void> {
    const r: AtivacaoAberta = await this.portal.conferirConvite(
      hospitalDaRota(hospital),
      corpo(esquemaConferirConvite, b),
      this.ip(req),
    );
    res.header('set-cookie', this.cookies(this.nomeAtivacao, r));
  }

  @Post('ativacao')
  @HttpCode(200)
  @Publica('primeiro acesso, passo 2: e-mail, senha e termos (cookie do primeiro acesso e CSRF conferidos)')
  @AuditadoNoHandler('nada é gravado neste passo: a conta só muda na confirmação do segundo fator')
  ativacao(@Body() b: unknown, @Req() req: Req) {
    return this.portal.iniciarAtivacao(
      lerCookie(um(req.headers['cookie']) ?? undefined, this.nomeAtivacao),
      this.csrf(req),
      corpo(esquemaAtivarContaPortal, b),
    );
  }

  @Post('ativacao/segundo-fator')
  @HttpCode(200)
  @Publica(
    'primeiro acesso, passo 3: o primeiro código do autenticador ativa a conta (cookie e CSRF conferidos)',
  )
  @AuditadoNoHandler('portal.criarConta: a ativação (SGH_POR_CONTA) com a SGH_TRILHA na mesma transação')
  async segundoFator(@Body() b: unknown, @Req() req: Req, @Res({ passthrough: true }) res: Res) {
    const r = await this.portal.confirmarSegundoFator(
      lerCookie(um(req.headers['cookie']) ?? undefined, this.nomeAtivacao),
      this.csrf(req),
      corpo(esquemaConfirmarSegundoFator, b),
    );
    return this.abrir(res, r);
  }

  @Post(':hospital/entrada')
  @HttpCode(200)
  @Publica(
    'entrada no portal do paciente: e-mail, senha Argon2id e segundo fator conferidos no serviço (taxa)',
  )
  @AuditadoNoHandler('a tentativa de entrada (SGH_POR_CONTA) com a SGH_TRILHA na mesma transação')
  async entrar(
    @Param('hospital') hospital: string,
    @Body() b: unknown,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Res,
  ) {
    const r = await this.portal.entrar(
      hospitalDaRota(hospital),
      corpo(esquemaEntrarContaPortal, b),
      this.ip(req),
    );
    return this.abrir(res, r);
  }

  @Get('eu')
  @Publica('a própria sessão do portal do paciente: 401 sem ela')
  async eu(@Req() req: Req) {
    return this.portal.eu(await this.sessao(req));
  }

  @Delete('sessao')
  @HttpCode(204)
  @Publica('sair do portal do paciente (apaga a sessão do portal)')
  @AuditadoNoHandler('o encerramento da sessão do portal não muda dado: só apaga a sessão em memória')
  sair(@Req() req: Req, @Res({ passthrough: true }) res: Res): void {
    this.portal.sair(this.idSessao(req));
    res.header('set-cookie', [
      this.apagar(this.nomeCookie),
      [`${COOKIE_CSRF_PACIENTE}=`, 'Path=/', 'Max-Age=0', 'SameSite=Strict', 'Secure'].join('; '),
    ]);
  }

  @Put('titular')
  @Publica(
    'escolher de quem a sessão do portal vê os dados (só o próprio ou um representado com vínculo vigente)',
  )
  @AuditadoNoHandler('a escolha só muda a sessão em memória: nada é gravado')
  async titular(@Body() b: unknown, @Req() req: Req) {
    const e = corpo(esquemaEscolherTitular, b);
    return this.portal.escolherTitular(await this.sessao(req, true), e.vinculo);
  }

  @Get('seguranca')
  @Publica('conta e segurança do portal: o e-mail mascarado e o último acesso (sessão do portal)')
  async seguranca(@Req() req: Req) {
    return this.portal.seguranca(await this.sessao(req));
  }

  @Post('senha')
  @HttpCode(204)
  @Publica(
    'trocar a senha do portal: a atual e o código do autenticador conferidos (sessão e CSRF do portal)',
  )
  @AuditadoNoHandler('a troca da senha (SGH_POR_CONTA) com a SGH_TRILHA na mesma transação')
  async senha(@Body() b: unknown, @Req() req: Req): Promise<void> {
    await this.portal.trocarSenha(await this.sessao(req, true), corpo(esquemaTrocarSenhaPortal, b));
  }

  @Post('email')
  @HttpCode(202)
  @Publica(
    'pedir a troca do e-mail de acesso: senha e código atuais; o link vai ao e-mail novo (sessão e CSRF do portal)',
  )
  @AuditadoNoHandler('portal.trocarEmail: SGH_POR_TROCA_EMAIL com a SGH_TRILHA na mesma transação')
  async pedirTrocaEmail(@Body() b: unknown, @Req() req: Req) {
    return this.portal.pedirTrocaEmail(await this.sessao(req, true), corpo(esquemaPedirTrocaEmailPortal, b));
  }

  @Delete('email/troca')
  @HttpCode(204)
  @Publica('desistir da troca do e-mail pendente (sessão e CSRF do portal)')
  @AuditadoNoHandler('portal.trocarEmail (cancelada): SGH_POR_TROCA_EMAIL com a SGH_TRILHA')
  async cancelarTrocaEmail(@Req() req: Req): Promise<void> {
    await this.portal.cancelarTrocaEmail(await this.sessao(req, true));
  }

  @Post(':hospital/email/confirmacao')
  @HttpCode(200)
  @Publica('o link de confirmação do e-mail novo (o token de 256 bits é a prova; limite de taxa por origem)')
  @AuditadoNoHandler('portal.trocarEmail (confirmada): SGH_POR_CONTA e SGH_POR_TROCA_EMAIL com a SGH_TRILHA')
  async confirmarTrocaEmail(@Param('hospital') hospital: string, @Body() b: unknown, @Req() req: Req) {
    return this.portal.confirmarTrocaEmail(
      hospitalDaRota(hospital),
      corpo(esquemaConfirmarTrocaEmailPortal, b),
      this.ip(req),
    );
  }

  @Post('segundo-fator/troca')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  @Publica(
    'trocar o autenticador, passo 1: senha e código atuais; o otpauth novo sai uma vez (sessão e CSRF do portal)',
  )
  @AuditadoNoHandler('o passo 1 só guarda o segredo novo em memória; a gravação e a trilha são do passo 2')
  async iniciarTrocaSegundoFator(@Body() b: unknown, @Req() req: Req) {
    return this.portal.iniciarTrocaSegundoFator(
      await this.sessao(req, true),
      corpo(esquemaConferirCredenciaisPortal, b),
    );
  }

  @Post('segundo-fator/troca/confirmacao')
  @HttpCode(204)
  @Publica('trocar o autenticador, passo 2: o primeiro código do aplicativo novo (sessão e CSRF do portal)')
  @AuditadoNoHandler('portal.trocarSegundoFator: SGH_POR_CONTA com a SGH_TRILHA na mesma transação')
  async confirmarTrocaSegundoFator(@Body() b: unknown, @Req() req: Req): Promise<void> {
    await this.portal.confirmarTrocaSegundoFator(
      await this.sessao(req, true),
      corpo(esquemaConfirmarSegundoFator, b),
    );
  }

  @Get('documentos')
  @Header('cache-control', 'no-store')
  @Publica(
    'resultados liberados e documentos assinados do titular escolhido (sessão do portal e escopo conferidos)',
  )
  async documentos(@Query('pagina') pagina: string | undefined, @Req() req: Req) {
    const p = Math.min(Math.max(1, Number(pagina) || 1), 1000);
    return this.portal.documentos(await this.sessao(req), p);
  }

  @Post('documentos/:origem/:item')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  @Publica('abrir um resultado ou documento no portal (sessão, CSRF e escopo conferidos)')
  @AuditadoNoHandler(
    'PORTAL_DOCUMENTO_VISTO na SGH_TRILHA; no resultado, sadt.registrarVisualizacaoPortal pelo executor',
  )
  async abrirItem(
    @Param('origem') origem: string,
    @Param('item') item: string,
    @Body() b: unknown,
    @Req() req: Req,
  ) {
    const baixar = (b as Record<string, unknown> | null)?.['baixar'] === true;
    const e = corpo(esquemaAbrirItemPortal, { origem, item, baixar });
    const n = await this.sessao(req, true);
    return e.origem === 'resultado'
      ? this.portal.abrirResultado(n, e, this.ip(req))
      : this.portal.abrirDocumento(n, e, this.ip(req));
  }

  @Get('documentos/documento/:item/pdf')
  @Header('cache-control', 'no-store')
  @Header('content-type', 'application/pdf')
  @Publica('o PDF assinado do documento do titular (sessão e escopo conferidos; o download vai à trilha)')
  @AuditadoNoHandler('PORTAL_DOCUMENTO_VISTO (download) na SGH_TRILHA')
  async pdf(@Param('item') item: string, @Req() req: Req, @Res({ passthrough: true }) res: Res) {
    const id = idRota(item);
    const pdf = await this.portal.pdfDoDocumento(await this.sessao(req), id, this.ip(req));
    res.header('content-disposition', `attachment; filename="documento-${id}.pdf"`);
    return Buffer.from(pdf);
  }

  @Get('vinculos')
  @Publica(
    'os vínculos de responsável legal da conta e quem tem acesso aos dados do titular (sessão do portal)',
  )
  async vinculos(@Req() req: Req) {
    return this.portal.vinculos(await this.sessao(req));
  }

  @Post('vinculos/arquivo')
  @HttpCode(201)
  @Publica(
    'o arquivo da prova de vínculo (foto ou PDF) ao armazenamento de objetos (sessão e CSRF do portal)',
  )
  @AuditadoNoHandler('o arquivo vai ao armazenamento de objetos; a trilha vai com o pedido do vínculo')
  async arquivo(@Body() b: unknown, @Req() req: Req) {
    const e = corpo(esquemaArquivoProva, b);
    return this.portal.enviarProva(await this.sessao(req, true), e.tipo, Buffer.from(e.conteudo, 'base64'));
  }

  @Post('vinculos')
  @HttpCode(201)
  @Publica(
    'pedir acesso como responsável legal com a prova (sessão e CSRF do portal; a conferência é humana)',
  )
  @AuditadoNoHandler('portal.vincularResponsavel: SGH_POR_RESPONSAVEL com a SGH_TRILHA na mesma transação')
  async pedirVinculo(@Body() b: unknown, @Req() req: Req) {
    return this.portal.pedirVinculo(
      await this.sessao(req, true),
      corpo(esquemaPedirVinculo, b),
      this.ip(req),
    );
  }

  @Delete('vinculos/:id')
  @HttpCode(204)
  @Publica('o titular revoga o acesso de um procurador (sessão e CSRF do portal)')
  @AuditadoNoHandler('portal.vincularResponsavel (encerramento) com a SGH_TRILHA na mesma transação')
  async revogar(@Param('id') id: string, @Req() req: Req): Promise<void> {
    await this.portal.revogarVinculo(await this.sessao(req, true), idRota(id));
  }

  @Get('consentimentos')
  @Publica('os consentimentos do titular escolhido (sessão do portal e escopo conferidos)')
  async consentimentos(@Req() req: Req) {
    return this.portal.consentimentos(await this.sessao(req));
  }

  @Post('consentimentos')
  @HttpCode(200)
  @Publica('dar, negar ou revogar um consentimento pelo portal (sessão, CSRF e escopo conferidos)')
  @AuditadoNoHandler(
    'portal.registrarConsentimento: SGH_CAD_CONSENTIMENTO com a SGH_TRILHA na mesma transação',
  )
  async consentir(@Body() b: unknown, @Req() req: Req) {
    return this.portal.registrarConsentimento(
      await this.sessao(req, true),
      corpo(esquemaConsentimentoPortal, b),
    );
  }

  @Get('pedidos')
  @Publica('os pedidos do titular abertos por esta conta (sessão do portal e escopo conferidos)')
  async pedidos(@Req() req: Req) {
    return this.portal.pedidos(await this.sessao(req));
  }

  @Post('pedidos')
  @HttpCode(201)
  @Publica('abrir um pedido do titular pelo portal (LGPD art. 18; sessão, CSRF e escopo conferidos)')
  @AuditadoNoHandler(
    'portal.registrarPedidoTitular: SGH_AUD_PEDIDO_TITULAR com a SGH_TRILHA na mesma transação',
  )
  async pedir(@Body() b: unknown, @Req() req: Req) {
    return this.portal.registrarPedido(await this.sessao(req, true), corpo(esquemaPedidoTitularPortal, b));
  }

  @Post('pedidos/:protocolo/cancelamento')
  @HttpCode(204)
  @Publica(
    'o titular cancela com motivo o pedido não respondido (LGPD art. 18; sessão, CSRF e escopo conferidos)',
  )
  @AuditadoNoHandler(
    'portal.cancelarPedidoTitular: SGH_AUD_PEDIDO_TITULAR com a SGH_TRILHA na mesma transação',
  )
  async cancelarPedido(@Param('protocolo') protocolo: string, @Body() b: unknown, @Req() req: Req) {
    if (!/^\d{4}-\d{6}$/.test(protocolo))
      throw new ErroProblema('nao-encontrado', 404, 'Pedido não encontrado', 'Protocolo inválido.');
    await this.portal.cancelarPedido(
      await this.sessao(req, true),
      protocolo,
      corpo(esquemaCancelarPedidoPortal, b),
    );
  }

  @Get('copias')
  @Header('cache-control', 'no-store')
  @Publica(
    'as cópias do prontuário pedidas para o titular: etapa, prazo e entrega (sessão e escopo conferidos)',
  )
  async copias(@Req() req: Req) {
    return this.portal.copias(await this.sessao(req));
  }

  @Post('copias')
  @HttpCode(201)
  @Publica(
    'pedir a cópia do prontuário como titular ou representante (LGPD art. 18 II; sessão, CSRF e escopo)',
  )
  @AuditadoNoHandler(
    'portal.registrarPedidoTitular e portal.copiaProntuario: SGH_AUD_PEDIDO_TITULAR e SGH_AUD_COPIA_ATO com a SGH_TRILHA',
  )
  async pedirCopia(@Body() b: unknown, @Req() req: Req) {
    return this.portal.pedirCopia(await this.sessao(req, true), corpo(esquemaPedirCopiaPortal, b));
  }

  @Get('portabilidade/:protocolo/ips')
  @Header('cache-control', 'no-store')
  @Header('content-type', 'application/fhir+json; charset=utf-8')
  @Publica(
    'o pacote de portabilidade FHIR/IPS do pedido atendido (LGPD art. 18 V; sessão e escopo conferidos; o download vai à trilha)',
  )
  @AuditadoNoHandler('portal.portabilidadeIps (geração e download, com o SHA-256) na SGH_TRILHA')
  async pacoteIps(
    @Param('protocolo') protocolo: string,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Res,
  ) {
    if (!/^\d{4}-\d{6}$/.test(protocolo))
      throw new ErroProblema('nao-encontrado', 404, 'Pedido não encontrado', 'Protocolo inválido.');
    const r = await this.portal.pacoteIps(await this.sessao(req), protocolo);
    res.header('content-disposition', `attachment; filename="portabilidade-ips-${protocolo}.json"`);
    res.header('x-pacote-sha256', r.hash);
    return Buffer.from(r.json, 'utf8');
  }

  @Get('copias/:protocolo/pdf')
  @Header('cache-control', 'no-store')
  @Header('content-type', 'application/pdf')
  @Publica(
    'o PDF da cópia do prontuário entregue pelo portal (sessão e escopo conferidos; o download vai à trilha)',
  )
  @AuditadoNoHandler('portal.copiaProntuario (download) na SGH_TRILHA')
  async pdfDaCopia(
    @Param('protocolo') protocolo: string,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Res,
  ) {
    if (!/^\d{4}-\d{6}$/.test(protocolo))
      throw new ErroProblema('nao-encontrado', 404, 'Cópia não encontrada', 'Protocolo inválido.');
    const pdf = await this.portal.pdfDaCopia(await this.sessao(req), protocolo);
    res.header('content-disposition', `attachment; filename="copia-prontuario-${protocolo}.pdf"`);
    return Buffer.from(pdf);
  }

  @Get('manifestacoes')
  @Publica(
    'as manifestações à ouvidoria feitas pelo portal: protocolo, situação e resposta (sessão e escopo conferidos)',
  )
  async manifestacoes(@Req() req: Req) {
    return this.portal.manifestacoes(await this.sessao(req));
  }

  @Post('manifestacoes')
  @HttpCode(201)
  @Publica(
    'a manifestação à ouvidoria pelo portal (elogio, reclamação, sugestão; sessão, CSRF e escopo conferidos)',
  )
  @AuditadoNoHandler(
    'qualidade.registrarManifestacao: SGH_QUA_OUVIDORIA (canal portal) com a SGH_TRILHA na mesma transação',
  )
  async registrarManifestacao(@Body() b: unknown, @Req() req: Req) {
    return this.portal.registrarManifestacao(
      await this.sessao(req, true),
      corpo(esquemaManifestacaoPortal, b),
    );
  }

  @Get('acessos')
  @Header('cache-control', 'no-store')
  @Publica(
    'quem acessou o próprio prontuário no período (sessão do portal; o titular ou o responsável com escopo)',
  )
  @AuditadoNoHandler('a consulta ao relatório (portal.acessos.consultados) na SGH_TRILHA')
  async acessos(
    @Query('de') de: string | undefined,
    @Query('ate') ate: string | undefined,
    @Query('pagina') pagina: string | undefined,
    @Req() req: Req,
  ) {
    const f = corpo(esquemaFiltroAcessosTitular, { de, ate, pagina: Number(pagina) || 1 });
    return this.portal.acessos(await this.sessao(req), f);
  }
}
