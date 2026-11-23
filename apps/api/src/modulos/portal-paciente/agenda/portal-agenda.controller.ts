// Portal do paciente, etapa 2 do M50 (ficha, seção 7; regras 3, 4, 8 e 13): agendar, pré-check-in, pagamento e
// pesquisa. As rotas são @Publica para a guarda das sessões internas: cada handler confere a SESSÃO DO PORTAL (o
// mesmo cookie e o mesmo CSRF da etapa 1) e o escopo `agendamentos` do titular escolhido. O retorno do gateway é
// público (o servidor relê a transação no gateway antes de confirmar; o corpo nunca é a prova).
//   GET  /api/paciente/agenda/opcoes?tipo                                agendas, serviços e convênios do portal
//   GET  /api/paciente/agenda/horarios?tipo&servico&agenda&convenio&de&modalidade   horários livres (200)
//   GET  /api/paciente/agenda/marcacoes                                  meus agendamentos
//   POST /api/paciente/agenda/marcacoes                                  agenda.agendarConsulta / agendarExame
//   POST /api/paciente/agenda/marcacoes/:tipo/:id/cancelamento           agenda.cancelarConsulta / cancelarExame
//   POST /api/paciente/agenda/marcacoes/consulta/:id/remarcacao          agenda.remarcarConsulta
//   POST /api/paciente/agenda/marcacoes/exame/:id/remarcacao             agenda.remarcarExame (W0-10)
//   GET  /api/paciente/pre-checkin/:tipo/:id · POST /api/paciente/pre-checkin/arquivo · PUT /api/paciente/pre-checkin/:tipo/:id
//   GET  /api/paciente/pagamentos · POST /api/paciente/pagamentos/:tipo/:id
//   POST /api/paciente/pagamentos/cobrancas/:id/conferencia · POST …/cobrancas/:id/simulacao (só o gateway simulado)
//   POST /api/paciente/pagamentos/retorno                                o retorno do gateway (idempotente)
//   POST /api/paciente/pesquisas/:tipo/:id                               portal.responderPesquisa
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  esquemaAgendarPortal,
  esquemaArquivoPreCheckin,
  esquemaBuscaHorariosPortal,
  esquemaCancelarPortal,
  esquemaIniciarPagamentoPortal,
  esquemaPesquisaPortal,
  esquemaPreCheckinPortal,
  esquemaRemarcarPortal,
  esquemaRetornoGateway,
  type TipoAgendaOnline,
  lerIdBanco,
} from '@sgh/contratos';
import { AuditadoNoHandler, Publica } from '../../../autorizacao/decoradores.js';
import { CONFIGURACAO, type Configuracao } from '../../../configuracao.js';
import { ErroProblema } from '../../../problema.filter.js';
import { lerCookie } from '../../../sessao/cookies.js';
import { corpo } from '../../exames/public-api.js';
import type { PortalNoPedido, ServicoPortalPaciente } from '../aplicacao/servico.js';
import {
  CABECALHO_CSRF_PACIENTE,
  COOKIE_CSRF_PACIENTE,
  COOKIE_PACIENTE,
  COOKIE_PACIENTE_DEV,
  SERVICO_PORTAL_PACIENTE,
} from '../portal-paciente.controller.js';
import type { ServicoAgendaPortal } from './servico.js';

export const SERVICO_AGENDA_PORTAL = Symbol('SERVICO_AGENDA_PORTAL');

interface Req {
  readonly headers: Record<string, string | string[] | undefined>;
}

const um = (v: string | string[] | undefined): string | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
const idRota = (v: string): number => {
  if (lerIdBanco(v) === null) throw new ErroProblema('nao-encontrado', 404, 'Não encontrado');
  return Number(v);
};
const tipoRota = (v: string): TipoAgendaOnline => {
  if (v !== 'consulta' && v !== 'exame') throw new ErroProblema('nao-encontrado', 404, 'Não encontrado');
  return v;
};
const numeroOuNulo = (v: string | undefined): number | null => (v ? lerIdBanco(v) : null);

@Controller('paciente')
export class PortalAgendaController {
  constructor(
    @Inject(CONFIGURACAO) private readonly configuracao: Configuracao,
    @Inject(SERVICO_PORTAL_PACIENTE) private readonly portal: ServicoPortalPaciente,
    @Inject(SERVICO_AGENDA_PORTAL) private readonly agenda: ServicoAgendaPortal,
  ) {}

  private sessao(req: Req, escrita = false): Promise<PortalNoPedido> {
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

  @Get('agenda/opcoes')
  @Header('cache-control', 'no-store')
  @Publica(
    'as agendas, os serviços e os convênios liberados no portal (sessão do portal e escopo conferidos)',
  )
  async opcoes(@Query('tipo') tipo: string | undefined, @Req() req: Req) {
    return this.agenda.opcoes(await this.sessao(req), tipoRota(tipo ?? 'consulta'));
  }

  @Get('agenda/horarios')
  @Header('cache-control', 'no-store')
  @Publica('os horários livres das agendas liberadas no portal (sessão do portal e escopo conferidos)')
  async horarios(@Query() q: Record<string, string | undefined>, @Req() req: Req) {
    const b = corpo(esquemaBuscaHorariosPortal, {
      tipo: q['tipo'] ?? 'consulta',
      servico: numeroOuNulo(q['servico']),
      agenda: numeroOuNulo(q['agenda']),
      convenio: Number(q['convenio'] ?? 'x'),
      de: q['de'] || null,
      // M50, etapa 4: só as agendas que oferecem a teleconsulta.
      modalidade: q['modalidade'] === 'teleconsulta' ? 'teleconsulta' : 'presencial',
    });
    return this.agenda.horarios(await this.sessao(req), b);
  }

  @Get('agenda/marcacoes')
  @Header('cache-control', 'no-store')
  @Publica('os agendamentos do titular escolhido (sessão do portal e escopo conferidos)')
  async marcacoes(@Req() req: Req) {
    return this.agenda.agendamentos(await this.sessao(req));
  }

  @Post('agenda/marcacoes')
  @HttpCode(200)
  @Publica('marcar consulta ou exame pelo portal (sessão, CSRF e escopo conferidos; canal portal)')
  @AuditadoNoHandler(
    'agenda.agendarConsulta / agendarExame pelo executor (usuário SGH.PORTAL) e portal.agendamento.registrado na SGH_TRILHA',
  )
  async agendar(@Body() b: unknown, @Req() req: Req) {
    return this.agenda.agendar(
      await this.sessao(req, true),
      corpo(esquemaAgendarPortal, b),
      um(req.headers['idempotency-key']),
    );
  }

  @Post('agenda/marcacoes/:tipo/:id/cancelamento')
  @HttpCode(200)
  @Publica('cancelar pelo portal até o prazo da agenda (sessão, CSRF e escopo conferidos)')
  @AuditadoNoHandler(
    'agenda.cancelarConsulta / cancelarExame pelo executor e portal.agendamento.registrado na SGH_TRILHA',
  )
  async cancelar(@Param('tipo') tipo: string, @Param('id') id: string, @Body() b: unknown, @Req() req: Req) {
    const e = corpo(esquemaCancelarPortal, b);
    return this.agenda.cancelar(
      await this.sessao(req, true),
      tipoRota(tipo),
      idRota(id),
      e.motivo,
      um(req.headers['idempotency-key']),
    );
  }

  @Post('agenda/marcacoes/consulta/:id/remarcacao')
  @HttpCode(200)
  @Publica(
    'remarcar a consulta pelo portal (sessão, CSRF e escopo conferidos; o horário anterior é liberado)',
  )
  @AuditadoNoHandler('agenda.remarcarConsulta pelo executor e portal.agendamento.registrado na SGH_TRILHA')
  async remarcar(@Param('id') id: string, @Body() b: unknown, @Req() req: Req) {
    return this.agenda.remarcar(
      await this.sessao(req, true),
      idRota(id),
      corpo(esquemaRemarcarPortal, b),
      um(req.headers['idempotency-key']),
    );
  }

  @Post('agenda/marcacoes/exame/:id/remarcacao')
  @HttpCode(200)
  @Publica('remarcar o exame pelo portal (sessão, CSRF e escopo conferidos; o horário anterior é liberado)')
  @AuditadoNoHandler('agenda.remarcarExame pelo executor e portal.agendamento.registrado na SGH_TRILHA')
  async remarcarExame(@Param('id') id: string, @Body() b: unknown, @Req() req: Req) {
    return this.agenda.remarcar(
      await this.sessao(req, true),
      idRota(id),
      corpo(esquemaRemarcarPortal, b),
      um(req.headers['idempotency-key']),
      'exame',
    );
  }

  @Get('pre-checkin/:tipo/:id')
  @Header('cache-control', 'no-store')
  @Publica('o pré-check-in de uma marcação do titular (sessão do portal e escopo conferidos)')
  async preCheckin(@Param('tipo') tipo: string, @Param('id') id: string, @Req() req: Req) {
    return this.agenda.preCheckin(await this.sessao(req), tipoRota(tipo), idRota(id));
  }

  @Post('pre-checkin/arquivo')
  @HttpCode(201)
  @Publica('o arquivo de um documento do pré-check-in ao armazenamento de objetos (sessão e CSRF do portal)')
  @AuditadoNoHandler('o arquivo vai ao armazenamento de objetos; a trilha vai com o envio do pré-check-in')
  async arquivo(@Body() b: unknown, @Req() req: Req) {
    const e = corpo(esquemaArquivoPreCheckin, b);
    return this.agenda.enviarArquivo(await this.sessao(req, true), e.tipo, Buffer.from(e.conteudo, 'base64'));
  }

  @Put('pre-checkin/:tipo/:id')
  @Publica('enviar ou reenviar o pré-check-in (sessão, CSRF e escopo conferidos; nada vai ao cadastro)')
  @AuditadoNoHandler('portal.enviarPreCheckin: SGH_POR_PRECHECKIN com a SGH_TRILHA na mesma transação')
  async enviarPreCheckin(
    @Param('tipo') tipo: string,
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: Req,
  ) {
    return this.agenda.enviarPreCheckin(
      await this.sessao(req, true),
      tipoRota(tipo),
      idRota(id),
      corpo(esquemaPreCheckinPortal, b),
    );
  }

  @Get('pagamentos')
  @Header('cache-control', 'no-store')
  @Publica('as cobranças do titular escolhido (sessão do portal e escopo conferidos)')
  async pagamentos(@Req() req: Req) {
    return this.agenda.pagamentos(await this.sessao(req));
  }

  @Post('pagamentos/retorno')
  @HttpCode(204)
  @Publica('o retorno do gateway de pagamento: o servidor relê a transação no gateway antes de confirmar')
  @AuditadoNoHandler('portal.confirmarPagamento: SGH_POR_PAGAMENTO e SGH_FAT_PAGAMENTO com a SGH_TRILHA')
  async retorno(@Body() b: unknown): Promise<void> {
    const e = corpo(esquemaRetornoGateway, b);
    await this.agenda.confirmar(e.hospital, e.transacao, 'retorno');
  }

  @Post('pagamentos/cobrancas/:id/conferencia')
  @HttpCode(200)
  @Publica('conferir no gateway se a cobrança foi paga (sessão, CSRF e escopo conferidos; idempotente)')
  @AuditadoNoHandler('portal.confirmarPagamento: SGH_POR_PAGAMENTO e SGH_FAT_PAGAMENTO com a SGH_TRILHA')
  async conferir(@Param('id') id: string, @Req() req: Req) {
    return this.agenda.conferirPagamento(await this.sessao(req, true), idRota(id));
  }

  @Post('pagamentos/cobrancas/:id/simulacao')
  @HttpCode(200)
  @Publica('simular o pagamento no gateway simulado (só fora de produção; sessão, CSRF e escopo conferidos)')
  @AuditadoNoHandler('portal.confirmarPagamento pelo retorno simulado: SGH_POR_PAGAMENTO com a SGH_TRILHA')
  async simular(@Param('id') id: string, @Body() b: unknown, @Req() req: Req) {
    if (this.configuracao.ambiente === 'producao')
      throw new ErroProblema('nao-encontrado', 404, 'Não encontrado');
    const aprovar = (b as Record<string, unknown> | null)?.['aprovar'] !== false;
    return this.agenda.simular(await this.sessao(req, true), idRota(id), aprovar);
  }

  @Post('pagamentos/:tipo/:id')
  @HttpCode(201)
  @Publica('abrir a cobrança Pix ou cartão da marcação particular (sessão, CSRF e escopo conferidos)')
  @AuditadoNoHandler('portal.iniciarPagamento: SGH_POR_PAGAMENTO com a SGH_TRILHA na mesma transação')
  async iniciar(@Param('tipo') tipo: string, @Param('id') id: string, @Body() b: unknown, @Req() req: Req) {
    const e = corpo(esquemaIniciarPagamentoPortal, b);
    return this.agenda.iniciarPagamento(await this.sessao(req, true), tipoRota(tipo), idRota(id), e.forma);
  }

  @Post('pesquisas/:tipo/:id')
  @HttpCode(200)
  @Publica('responder a pesquisa de satisfação depois do atendimento (sessão, CSRF e escopo conferidos)')
  @AuditadoNoHandler('portal.responderPesquisa: SGH_POR_PESQUISA com a SGH_TRILHA na mesma transação')
  async pesquisa(@Param('tipo') tipo: string, @Param('id') id: string, @Body() b: unknown, @Req() req: Req) {
    return this.agenda.responderPesquisa(
      await this.sessao(req, true),
      tipoRota(tipo),
      idRota(id),
      corpo(esquemaPesquisaPortal, b),
    );
  }
}
