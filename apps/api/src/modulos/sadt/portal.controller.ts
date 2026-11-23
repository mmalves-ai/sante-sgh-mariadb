// Portal de resultados (M26; ficha, seção 7 e regra 9). São @Publica para a guarda das sessões internas: o portal é
// outro domínio de identidade (paciente pelo protocolo e a data de nascimento; médico externo pela conta própria com o
// segundo fator) e cada handler confere a SESSÃO DO PORTAL (cookie próprio, HttpOnly) e, nas que mudam estado, o CSRF
// por token duplo próprio (cookie sgh_portal_csrf + cabeçalho x-csrf-portal). O estabelecimento vem do endereço.
//   POST   /api/portal/:hospital/paciente            entrar como paciente (limite de tentativas e de taxa)
//   POST   /api/portal/:hospital/medico              entrar como médico externo (senha + segundo fator)
//   POST   /api/portal/:hospital/autocadastro        autocadastro do médico solicitante (fica pendente)
//   GET    /api/portal/estabelecimento               o estabelecimento padrão do endereço
//   GET    /api/portal/eu                            a sessão do portal
//   GET    /api/portal/laudos                        os laudos liberados de setores publicados do acesso
//   POST   /api/portal/laudos/:liberacao             abrir o laudo (grava data e IP da visualização)
//   DELETE /api/portal/sessao                        sair
//   GET    /api/portal/:hospital/validar/:codigo     validação pública do laudo (sem conteúdo clínico)
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import {
  esquemaAutocadastroMedico,
  esquemaEntrarPortalMedico,
  esquemaEntrarPortalPaciente,
  type LaudoPortalAberto,
  type ListaPortal,
  type SessaoPortal,
  type ValidacaoLaudo,
  lerIdBanco,
} from '@sgh/contratos';
import { AuditadoNoHandler, Publica } from '../../autorizacao/decoradores.js';
import { CONFIGURACAO, type Configuracao } from '../../configuracao.js';
import { ErroProblema } from '../../problema.filter.js';
import { lerCookie } from '../../sessao/cookies.js';
import { corpo } from '../exames/public-api.js';
import type { EntradaFeita, ServicoPortal } from './aplicacao/portal.js';

export const SERVICO_PORTAL = Symbol('SERVICO_PORTAL');
export const COOKIE_PORTAL = '__Host-sgh_portal';
export const COOKIE_PORTAL_DEV = 'sgh_portal';
export const COOKIE_CSRF_PORTAL = 'sgh_portal_csrf';
export const CABECALHO_CSRF_PORTAL = 'x-csrf-portal';
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

@Controller('portal')
export class PortalController {
  constructor(
    @Inject(CONFIGURACAO) private readonly configuracao: Configuracao,
    @Inject(SERVICO_PORTAL) private readonly portal: ServicoPortal,
  ) {}

  private get prefixoHost(): boolean {
    return !SEM_PREFIXO.has(this.configuracao.ambiente);
  }
  private get nomeCookie(): string {
    return this.prefixoHost ? COOKIE_PORTAL : COOKIE_PORTAL_DEV;
  }

  private cookies(e: EntradaFeita): string[] {
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
        `${COOKIE_CSRF_PORTAL}=${e.csrf}`,
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
            cookie: lerCookie(um(req.headers['cookie']) ?? undefined, COOKIE_CSRF_PORTAL),
            cabecalho: um(req.headers[CABECALHO_CSRF_PORTAL]),
          }
        : undefined,
    );
  }

  private ip(req: Req): string {
    return (req.ip ?? 'desconhecido').slice(0, 50);
  }

  @Get('estabelecimento')
  @Publica('o estabelecimento padrão do portal (o código, para o endereço sem estabelecimento)')
  estabelecimento(): { estabelecimento: string | null } {
    return { estabelecimento: this.portal.estabelecimentoPadrao };
  }

  @Post(':hospital/paciente')
  @HttpCode(200)
  @Publica('acesso do paciente ao portal (protocolo e data de nascimento, limite de tentativas e de taxa)')
  @AuditadoNoHandler('a tentativa de acesso (acesso ao portal) com a trilha_auditoria na mesma transação')
  async entrarPaciente(
    @Param('hospital') hospital: string,
    @Body() b: unknown,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Res,
  ): Promise<SessaoPortal> {
    const r = await this.portal.entrarPaciente(
      hospitalDaRota(hospital),
      corpo(esquemaEntrarPortalPaciente, b),
      this.ip(req),
    );
    res.header('set-cookie', this.cookies(r));
    return r.sessao;
  }

  @Post(':hospital/medico')
  @HttpCode(200)
  @Publica('acesso do médico externo ao portal (senha Argon2id e segundo fator conferidos no serviço)')
  @AuditadoNoHandler('a tentativa de acesso (acesso ao portal) com a trilha_auditoria na mesma transação')
  async entrarMedico(
    @Param('hospital') hospital: string,
    @Body() b: unknown,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Res,
  ): Promise<SessaoPortal> {
    const r = await this.portal.entrarMedico(
      hospitalDaRota(hospital),
      corpo(esquemaEntrarPortalMedico, b),
      this.ip(req),
    );
    res.header('set-cookie', this.cookies(r));
    return r.sessao;
  }

  @Post(':hospital/autocadastro')
  @HttpCode(200)
  @Publica('autocadastro do médico solicitante (fica pendente até a aprovação interna; limite de taxa)')
  @AuditadoNoHandler('o autocadastro (conta do médico externo) com a trilha_auditoria na mesma transação')
  autocadastro(@Param('hospital') hospital: string, @Body() b: unknown, @Req() req: Req) {
    return this.portal.autocadastro(
      hospitalDaRota(hospital),
      corpo(esquemaAutocadastroMedico, b),
      this.ip(req),
    );
  }

  @Get('eu')
  @Publica('a própria sessão do portal: 401 sem ela')
  eu(@Req() req: Req): SessaoPortal {
    return this.portal.eu(this.sessao(req));
  }

  @Get('laudos')
  @Publica('os laudos do acesso do portal (sessão do portal conferida no handler)')
  laudos(@Req() req: Req): Promise<ListaPortal> {
    return this.portal.laudos(this.sessao(req));
  }

  @Post('laudos/:liberacao')
  @HttpCode(200)
  @Publica('abrir o laudo no portal (sessão e CSRF do portal conferidos no handler)')
  @AuditadoNoHandler('sadt.registrarVisualizacaoPortal pelo executor e a leitura com a trilha_auditoria')
  abrir(
    @Param('liberacao') liberacao: string,
    @Body() b: unknown,
    @Req() req: Req,
  ): Promise<LaudoPortalAberto> {
    if (lerIdBanco(liberacao) === null) throw new ErroProblema('nao-encontrado', 404, 'Laudo não encontrado');
    const acao = (b as Record<string, unknown> | null)?.['acao'] === 'download' ? 'download' : 'visualizacao';
    return this.portal.abrir(this.sessao(req, true), Number(liberacao), this.ip(req), acao);
  }

  @Delete('sessao')
  @HttpCode(204)
  @Publica('sair do portal (apaga a sessão do portal)')
  @AuditadoNoHandler('o encerramento da sessão do portal não muda dado: só apaga a sessão em memória')
  sair(@Req() req: Req, @Res({ passthrough: true }) res: Res): void {
    this.portal.sair(this.idSessao(req));
    res.header('set-cookie', [
      [`${this.nomeCookie}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Strict', 'Secure'].join('; '),
      [`${COOKIE_CSRF_PORTAL}=`, 'Path=/', 'Max-Age=0', 'SameSite=Strict', 'Secure'].join('; '),
    ]);
  }

  @Get(':hospital/validar/:codigo')
  @Publica('validação pública do laudo pelo código de autenticação (sem conteúdo clínico)')
  validar(@Param('hospital') hospital: string, @Param('codigo') codigo: string): Promise<ValidacaoLaudo> {
    if (codigo.length > 40) throw new ErroProblema('nao-encontrado', 404, 'Laudo não encontrado');
    return this.portal.validar(hospitalDaRota(hospital), codigo);
  }
}
