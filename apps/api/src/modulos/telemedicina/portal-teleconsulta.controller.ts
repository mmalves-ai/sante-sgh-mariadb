// Portal do paciente, sala de espera virtual da teleconsulta (`/paciente/teleconsulta/:id`):
// as rotas são @Publica para a guarda das sessões internas: cada handler confere a SESSÃO DO PORTAL (o mesmo cookie e o
// mesmo CSRF da etapa 1) e o escopo `agendamentos` do titular escolhido.
//   GET  /api/paciente/teleconsultas                      as teleconsultas do titular e o termo vigente
//   GET  /api/paciente/teleconsultas/:id                  a sala de espera (a sala do médico, quando aberta)
//   POST /api/paciente/teleconsultas/:id/espera           o termo aceito e o local informado (portal.entrarSalaEspera)
//   POST /api/paciente/teleconsultas/:id/entrada          entrar na sala do médico
import { Body, Controller, Get, Header, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import { esquemaEntrarSalaEspera, lerIdBanco } from '@sgh/contratos';
import { AuditadoNoHandler, Publica } from '../../autorizacao/decoradores.js';
import { CONFIGURACAO, type Configuracao } from '../../configuracao.js';
import { ErroProblema } from '../../problema.filter.js';
import { lerCookie } from '../../sessao/cookies.js';
import { corpo } from '../exames/public-api.js';
import type { PortalNoPedido, ServicoPortalPaciente } from '../portal-paciente/aplicacao/servico.js';
import {
  CABECALHO_CSRF_PACIENTE,
  COOKIE_CSRF_PACIENTE,
  COOKIE_PACIENTE,
  COOKIE_PACIENTE_DEV,
  SERVICO_PORTAL_PACIENTE,
} from '../portal-paciente/portal-paciente.controller.js';
import { SERVICO_TELEMEDICINA } from './telemedicina.controller.js';
import type { ServicoTelemedicina } from './servico.js';

interface Req {
  readonly headers: Record<string, string | string[] | undefined>;
}

const um = (v: string | string[] | undefined): string | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
const idRota = (v: string): number => {
  if (lerIdBanco(v) === null) throw new ErroProblema('nao-encontrado', 404, 'Não encontrado');
  return Number(v);
};

@Controller('paciente/teleconsultas')
export class PortalTeleconsultaController {
  constructor(
    @Inject(CONFIGURACAO) private readonly configuracao: Configuracao,
    @Optional() @Inject(SERVICO_PORTAL_PACIENTE) private readonly portal: ServicoPortalPaciente | null,
    @Inject(SERVICO_TELEMEDICINA) private readonly tele: ServicoTelemedicina,
  ) {}

  private sessao(req: Req, escrita = false): Promise<PortalNoPedido> {
    // Sem o módulo do portal montado, as rotas do paciente ficam indisponíveis (503), nunca abertas.
    if (!this.portal)
      throw new ErroProblema('indisponivel', 503, 'Indisponível', 'O portal do paciente não está montado.');
    const nome = ['dev', 'ci'].includes(this.configuracao.ambiente) ? COOKIE_PACIENTE_DEV : COOKIE_PACIENTE;
    const cookies = um(req.headers['cookie']) ?? undefined;
    return this.portal.sessao(
      lerCookie(cookies, nome),
      escrita
        ? {
            cookie: lerCookie(cookies, COOKIE_CSRF_PACIENTE),
            cabecalho: um(req.headers[CABECALHO_CSRF_PACIENTE]),
          }
        : undefined,
    );
  }

  @Get()
  @Header('cache-control', 'no-store')
  @Publica('as teleconsultas do titular escolhido (sessão do portal e escopo conferidos)')
  async lista(@Req() req: Req) {
    return this.tele.listaPortal(await this.sessao(req));
  }

  @Get(':id')
  @Header('cache-control', 'no-store')
  @Publica('a sala de espera da teleconsulta do titular (sessão do portal e escopo conferidos)')
  async detalhe(@Param('id') id: string, @Req() req: Req) {
    return this.tele.detalhePortal(await this.sessao(req), idRota(id));
  }

  @Post(':id/espera')
  @HttpCode(200)
  @Publica('aceitar o termo e informar o local da teleconsulta (sessão, CSRF e escopo conferidos)')
  @AuditadoNoHandler('portal.entrarSalaEspera com a trilha na mesma transação')
  async espera(@Param('id') id: string, @Body() b: unknown, @Req() req: Req) {
    return this.tele.entrarSalaEspera(
      await this.sessao(req, true),
      idRota(id),
      corpo(esquemaEntrarSalaEspera, b),
    );
  }

  @Post(':id/entrada')
  @HttpCode(200)
  @Publica('entrar na sala do médico (sessão, CSRF e escopo conferidos)')
  @AuditadoNoHandler('entrada do paciente na sala com a trilha na mesma transação')
  async entrada(@Param('id') id: string, @Req() req: Req) {
    return this.tele.entrarNaSala(await this.sessao(req, true), idRota(id));
  }
}
