// Portal do médico externo (M50, etapa 3; ficha, seção 7 e regras 1, 6 e 13). As rotas são @Publica para a guarda das
// sessões internas: é o portal de resultados do M26 (outro domínio de identidade, a conta em conta_portal_profissional_externo), e
// cada handler confere a SESSÃO DO PORTAL (o cookie do M26, HttpOnly) com o perfil de médico externo e, nas que mudam
// estado, o CSRF por token duplo do portal (cookie sgh_portal_csrf + cabeçalho x-csrf-portal). Nada vem da tela sobre
// quem é o médico: o profissional e os códigos saem do vínculo da conta, no servidor.
//   GET  /api/portal/medico-externo/extrato?competencia        o extrato de produção e repasse dele
//   GET  /api/portal/medico-externo/extrato/conta?competencia  a conta de cada valor na competência
//   GET  /api/portal/medico-externo/agenda?de&ate             a agenda cirúrgica dele e os pedidos desta conta
//   GET  /api/portal/medico-externo/opcoes                    salas, convênios, caráter e anestesia do pedido
//   GET  /api/portal/medico-externo/procedimentos?q           busca do procedimento (teto 30)
//   POST /api/portal/medico-externo/pedidos                   pedido de cirurgia (solicitado; não ocupa a sala)
//   POST /api/portal/medico-externo/pedidos/:id/retirar       o médico retira o próprio pedido não confirmado
//   POST /api/portal/medico-externo/pedidos/:id/alteracao     W0-10: altera o pedido não confirmado (versão e motivo)
//   POST /api/portal/medico-externo/conta/senha               W0-10: a senha nova (senha e código atuais)
//   GET  /api/portal/medico-externo/conta/email               W0-10: o pedido de troca do e-mail pendente
//   POST /api/portal/medico-externo/conta/email               W0-10: pede a troca (link no e-mail NOVO)
//   POST /api/portal/medico-externo/conta/email/cancelar      W0-10: desiste do pedido pendente
//   POST /api/portal/medico-externo/email/confirmacao?h=      W0-10: o link do e-mail novo (público, pelo token)
//   GET  /api/portal/medico-externo/pacientes                 W0-10 (M4): meus pacientes (vínculo assistencial)
//   GET  /api/portal/medico-externo/pacientes/:paciente       W0-10 (M4): o resumo do prontuário (403 sem vínculo)
//   GET  /api/portal/medico-externo/criticos                  W0-10 (M5): avisos de crítico dos pacientes do médico
//   POST /api/portal/medico-externo/criticos/:aviso/ciencia   W0-10 (M5): a ciência com a conduta (registro novo)
//   GET  /api/portal/medico-externo/assinaturas               W0-10 (M6): a fila de assinatura remota do profissional
//   POST /api/portal/medico-externo/assinaturas               W0-10 (M6): assina o lote (certificado em nuvem; PSC)
//   POST /api/portal/medico-externo/assinaturas/retorno       W0-10 (M6): a volta do provedor (state e código)
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  type OnModuleDestroy,
  type OnModuleInit,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  type AgendaPortalMedico,
  type ContaDoMedicoResposta,
  type CriticosPortalMedico,
  type AssinaturasPortalMedico,
  esquemaAssinarPortalMedico,
  esquemaRetornoAssinaturaPortalMedico,
  type InicioAssinaturaPortalMedico,
  type ResultadoAssinaturaPortalMedico,
  esquemaCienciaCriticoMedico,
  esquemaConfirmarTrocaEmailMedico,
  esquemaPedidoCirurgiaPortal,
  esquemaPedirTrocaEmailMedico,
  esquemaAlterarPedidoPortal,
  esquemaRetirarPedidoPortal,
  esquemaTrocarSenhaMedico,
  type ExtratoPortalMedico,
  type MeusPacientesPortalMedico,
  type OpcoesPortalMedico,
  type ProntuarioPortalMedico,
  type ResultadoPortalMedico,
  type TrocaEmailMedicoPedida,
} from '@sgh/contratos';
import { AuditadoNoHandler, Publica } from '../../autorizacao/decoradores.js';
import { CONFIGURACAO, type Configuracao } from '../../configuracao.js';
import { ErroProblema } from '../../problema.filter.js';
import { lerCookie } from '../../sessao/cookies.js';
import { corpo } from '../exames/public-api.js';
import {
  CABECALHO_CSRF_PORTAL,
  COOKIE_CSRF_PORTAL,
  COOKIE_PORTAL,
  COOKIE_PORTAL_DEV,
  SERVICO_PORTAL,
  type ServicoPortal,
} from '../sadt/public-api.js';
import type { ServicoPortalMedico } from './aplicacao/servico.js';

export const SERVICO_PORTAL_MEDICO = Symbol('SERVICO_PORTAL_MEDICO');
const SEM_PREFIXO = new Set(['dev', 'ci']);
const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

interface Req {
  readonly headers: Record<string, string | string[] | undefined>;
  /** W0-10 (M6): o IP de quem está no portal (a estação da trilha da assinatura). */
  readonly ip?: string;
}

const um = (v: string | string[] | undefined): string | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
const competenciaOuNula = (v: string | undefined): string | null => {
  const c = (v ?? '').trim();
  if (!c) return null;
  if (!COMPETENCIA.test(c))
    throw new ErroProblema('entrada-invalida', 400, 'Competência inválida', 'Use AAAA-MM.');
  return c;
};
const diaOuNulo = (v: string | undefined): string | null => {
  const d = (v ?? '').trim();
  if (!d) return null;
  if (!DIA.test(d)) throw new ErroProblema('entrada-invalida', 400, 'Data inválida', 'Use AAAA-MM-DD.');
  return d;
};
const idRota = (v: string): number => {
  if (!/^[1-9]\d{0,17}$/.test(v)) throw new ErroProblema('nao-encontrado', 404, 'Pedido não encontrado');
  return Number(v);
};

@Controller('portal/medico-externo')
export class PortalMedicoController implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(CONFIGURACAO) private readonly configuracao: Configuracao,
    @Inject(SERVICO_PORTAL) private readonly sessoes: ServicoPortal,
    @Inject(SERVICO_PORTAL_MEDICO) private readonly portal: ServicoPortalMedico,
  ) {}

  /** W0-10 (M5): a vigia que notifica o médico externo do crítico (só onde o app.module deu os estabelecimentos). */
  onModuleInit(): void {
    this.portal.iniciarAvisosCriticos();
  }

  onModuleDestroy(): void {
    this.portal.pararAvisosCriticos();
  }

  private get nomeCookie(): string {
    return SEM_PREFIXO.has(this.configuracao.ambiente) ? COOKIE_PORTAL_DEV : COOKIE_PORTAL;
  }

  private idSessao(req: Req): string | null {
    return lerCookie(um(req.headers['cookie']) ?? undefined, this.nomeCookie);
  }

  private sessao(req: Req, escrita = false) {
    return this.sessoes.sessao(
      this.idSessao(req),
      escrita
        ? {
            cookie: lerCookie(um(req.headers['cookie']) ?? undefined, COOKIE_CSRF_PORTAL),
            cabecalho: um(req.headers[CABECALHO_CSRF_PORTAL]),
          }
        : undefined,
    );
  }

  @Get('extrato')
  @Header('cache-control', 'no-store')
  @Publica('o extrato do médico externo (sessão do portal e o vínculo da conta conferidos no handler)')
  @AuditadoNoHandler('a leitura vai à trilha de auditoria (portal.medico.extratoLido) sem dado pessoal')
  extrato(@Query() q: Record<string, string>, @Req() req: Req): Promise<ExtratoPortalMedico> {
    return this.portal.extrato(this.sessao(req), this.idSessao(req), {
      competencia: competenciaOuNula(q['competencia']),
    });
  }

  @Get('extrato/conta')
  @Header('cache-control', 'no-store')
  @Publica('a conta de cada valor do extrato do médico externo (sessão do portal conferida no handler)')
  @AuditadoNoHandler('a leitura vai à trilha de auditoria (portal.medico.extratoLido) sem dado pessoal')
  conta(@Query() q: Record<string, string>, @Req() req: Req): Promise<ContaDoMedicoResposta> {
    const c = competenciaOuNula(q['competencia']);
    if (!c) throw new ErroProblema('entrada-invalida', 400, 'Competência inválida', 'Use AAAA-MM.');
    return this.portal.contaDoExtrato(this.sessao(req), this.idSessao(req), c);
  }

  @Get('pacientes')
  @Header('cache-control', 'no-store')
  @Publica(
    'meus pacientes do médico externo (vínculo assistencial pelos registros do profissional; sessão no handler)',
  )
  @AuditadoNoHandler('a leitura vai à trilha de auditoria (portal.medico.pacientesLidos) sem dado pessoal')
  pacientes(@Req() req: Req): Promise<MeusPacientesPortalMedico> {
    return this.portal.meusPacientes(this.sessao(req), this.idSessao(req));
  }

  @Get('pacientes/:paciente')
  @Header('cache-control', 'no-store')
  @Publica(
    'o resumo do prontuário de um paciente com vínculo assistencial do médico externo (sessão no handler)',
  )
  @AuditadoNoHandler(
    'o acesso remoto vai à trilha de auditoria (portal.medico.prontuarioAcessado) com o paciente; o negado também',
  )
  prontuario(@Param('paciente') paciente: string, @Req() req: Req): Promise<ProntuarioPortalMedico> {
    if (!/^[1-9]\d{0,17}$/.test(paciente))
      throw new ErroProblema('nao-encontrado', 404, 'Paciente não encontrado');
    return this.portal.prontuario(this.sessao(req), this.idSessao(req), Number(paciente));
  }

  @Get('assinaturas')
  @Header('cache-control', 'no-store')
  @Publica(
    'a fila de assinatura remota do profissional ligado à conta (sessão do portal conferida no handler)',
  )
  @AuditadoNoHandler('a leitura vai à trilha de auditoria (portal.medico.assinaturasLidas) sem dado pessoal')
  assinaturas(@Req() req: Req): Promise<AssinaturasPortalMedico> {
    return this.portal.assinaturas(this.sessao(req), this.idSessao(req), req.ip ?? null);
  }

  @Post('assinaturas')
  @HttpCode(200)
  @Publica(
    'o médico pede a assinatura remota do lote (sessão e CSRF do portal; o login e o certificado saem do vínculo)',
  )
  @AuditadoNoHandler(
    'as prévias e o pedido na assinatura de documentos (M49) com a trilha de auditoria; o pedido do portal vai à trilha (portal.medico.assinaturaPedida)',
  )
  assinar(@Body() b: unknown, @Req() req: Req): Promise<InicioAssinaturaPortalMedico> {
    const s = this.sessao(req, true);
    return this.portal.assinar(s, this.idSessao(req), corpo(esquemaAssinarPortalMedico, b), req.ip ?? null);
  }

  @Post('assinaturas/retorno')
  @HttpCode(200)
  @Publica('a volta do provedor da assinatura em nuvem (sessão e CSRF do portal; o state amarra ao pedido)')
  @AuditadoNoHandler(
    'a conclusão do lote na assinatura de documentos (M49) com a trilha de auditoria; o resultado vai à trilha (portal.medico.assinaturaConcluida)',
  )
  concluirAssinatura(@Body() b: unknown, @Req() req: Req): Promise<ResultadoAssinaturaPortalMedico> {
    const s = this.sessao(req, true);
    return this.portal.concluirAssinatura(
      s,
      this.idSessao(req),
      corpo(esquemaRetornoAssinaturaPortalMedico, b),
      req.ip ?? null,
    );
  }

  @Get('criticos')
  @Header('cache-control', 'no-store')
  @Publica(
    'os avisos de resultado crítico dos pacientes com vínculo assistencial do médico externo (sessão no handler)',
  )
  @AuditadoNoHandler('a leitura vai à trilha de auditoria (portal.medico.criticosLidos) sem dado pessoal')
  criticos(@Req() req: Req): Promise<CriticosPortalMedico> {
    return this.portal.criticos(this.sessao(req), this.idSessao(req));
  }

  @Post('criticos/:aviso/ciencia')
  @HttpCode(200)
  @Publica(
    'a ciência do resultado crítico pelo médico externo, com a conduta (sessão e CSRF do portal no handler)',
  )
  @AuditadoNoHandler(
    'a ciência (registro de ciência do prontuário) com a trilha de auditoria do prontuário e portal.medico.criticoCiente com o paciente',
  )
  ciencia(
    @Param('aviso') aviso: string,
    @Body() b: unknown,
    @Req() req: Req,
  ): Promise<ResultadoPortalMedico> {
    const s = this.sessao(req, true);
    return this.portal.cienciaCritico(
      s,
      this.idSessao(req),
      idRota(aviso),
      corpo(esquemaCienciaCriticoMedico, b),
    );
  }

  @Get('agenda')
  @Header('cache-control', 'no-store')
  @Publica(
    'a agenda cirúrgica do médico externo (só as cirurgias dele e os pedidos da conta; sessão no handler)',
  )
  @AuditadoNoHandler('a leitura vai à trilha de auditoria (portal.medico.agendaLida) sem dado pessoal')
  agenda(@Query() q: Record<string, string>, @Req() req: Req): Promise<AgendaPortalMedico> {
    return this.portal.agenda(this.sessao(req), this.idSessao(req), {
      de: diaOuNulo(q['de']),
      ate: diaOuNulo(q['ate']),
    });
  }

  @Get('opcoes')
  @Publica(
    'salas, convênios, caráter e anestesia do pedido de cirurgia (sessão do portal conferida no handler)',
  )
  opcoes(@Req() req: Req): Promise<OpcoesPortalMedico> {
    return this.portal.opcoes(this.sessao(req), this.idSessao(req));
  }

  @Get('procedimentos')
  @Publica('busca do procedimento do pedido de cirurgia (sessão do portal conferida no handler; teto 30)')
  procedimentos(@Query('q') q: string | undefined, @Req() req: Req) {
    return this.portal.procedimentos(this.sessao(req), this.idSessao(req), q ?? '');
  }

  @Post('pedidos')
  @HttpCode(201)
  @Publica(
    'pedido de cirurgia do médico externo (sessão e CSRF do portal conferidos no handler; limite por conta)',
  )
  @AuditadoNoHandler('a solicitação (agendamento_cirurgico) com a trilha de auditoria na mesma transação')
  pedir(@Body() b: unknown, @Req() req: Req): Promise<ResultadoPortalMedico> {
    const s = this.sessao(req, true);
    return this.portal.pedir(s, this.idSessao(req), corpo(esquemaPedidoCirurgiaPortal, b));
  }

  @Post('pedidos/:id/retirar')
  @HttpCode(200)
  @Publica('o médico externo retira o próprio pedido não confirmado (sessão e CSRF do portal no handler)')
  @AuditadoNoHandler(
    'o cancelamento da solicitação (agendamento_cirurgico) com a trilha de auditoria na mesma transação',
  )
  retirar(@Param('id') id: string, @Body() b: unknown, @Req() req: Req): Promise<ResultadoPortalMedico> {
    const s = this.sessao(req, true);
    const e = corpo(esquemaRetirarPedidoPortal, b ?? {});
    return this.portal.retirar(s, this.idSessao(req), idRota(id), e.motivo ?? null);
  }

  @Post('pedidos/:id/alteracao')
  @HttpCode(200)
  @Publica(
    'o médico externo altera o próprio pedido não confirmado, com a versão vista e o motivo (sessão e CSRF do portal no handler)',
  )
  @AuditadoNoHandler(
    'a versão anterior (versão do pedido) e a alteração da solicitação com a trilha de auditoria na mesma transação',
  )
  alterar(@Param('id') id: string, @Body() b: unknown, @Req() req: Req): Promise<ResultadoPortalMedico> {
    const s = this.sessao(req, true);
    return this.portal.alterar(s, this.idSessao(req), idRota(id), corpo(esquemaAlterarPedidoPortal, b));
  }

  // ── W0-10: o médico troca a senha e o e-mail da própria conta ──────────────────────────────────────────────────────

  @Post('conta/senha')
  @HttpCode(200)
  @Publica(
    'o médico troca a senha da própria conta (sessão e CSRF do portal, senha e código atuais no handler)',
  )
  @AuditadoNoHandler(
    'a senha nova e o ato troca-senha (conta_portal_profissional_externo) com a trilha de auditoria na mesma transação',
  )
  trocarSenha(@Body() b: unknown, @Req() req: Req): Promise<ResultadoPortalMedico> {
    const s = this.sessao(req, true);
    return this.portal.trocarSenha(s, this.idSessao(req), corpo(esquemaTrocarSenhaMedico, b));
  }

  @Get('conta/email')
  @Header('cache-control', 'no-store')
  @Publica('o pedido de troca do e-mail pendente da própria conta (sessão do portal conferida no handler)')
  async trocaEmail(@Req() req: Req): Promise<{ pendente: TrocaEmailMedicoPedida | null }> {
    return { pendente: await this.portal.trocaEmailPendente(this.sessao(req), this.idSessao(req)) };
  }

  @Post('conta/email')
  @HttpCode(201)
  @Publica('o médico pede a troca do e-mail (sessão e CSRF do portal, senha e código atuais no handler)')
  @AuditadoNoHandler('o pedido (pedido de troca do e-mail) com a trilha de auditoria na mesma transação')
  pedirTrocaEmail(@Body() b: unknown, @Req() req: Req): Promise<TrocaEmailMedicoPedida> {
    const s = this.sessao(req, true);
    return this.portal.pedirTrocaEmail(s, this.idSessao(req), corpo(esquemaPedirTrocaEmailMedico, b));
  }

  @Post('conta/email/cancelar')
  @HttpCode(200)
  @Publica('o médico desiste da troca do e-mail pendente (sessão e CSRF do portal conferidos no handler)')
  @AuditadoNoHandler(
    'o pedido cancelado (pedido de troca do e-mail) com a trilha de auditoria na mesma transação',
  )
  cancelarTrocaEmail(@Req() req: Req): Promise<ResultadoPortalMedico> {
    const s = this.sessao(req, true);
    return this.portal.cancelarTrocaEmail(s, this.idSessao(req));
  }

  @Post('email/confirmacao')
  @HttpCode(200)
  @Publica(
    'o link enviado ao e-mail novo (sem sessão: o token de 256 bits, só em resumo no banco, é a prova)',
  )
  @AuditadoNoHandler('o e-mail novo e o ato troca-email com a trilha de auditoria na mesma transação')
  confirmarTrocaEmail(
    @Query('h') h: string | undefined,
    @Body() b: unknown,
  ): Promise<{ emailMascarado: string }> {
    const hospital = (h ?? '').trim();
    if (!/^[A-Za-z0-9_-]{1,10}$/.test(hospital))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Link inválido',
        'O link de confirmação está incompleto.',
      );
    return this.portal.confirmarTrocaEmail(hospital, corpo(esquemaConfirmarTrocaEmailMedico, b).token);
  }
}
