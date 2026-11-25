// Rotas das rotinas agendadas (01-SIS L95, ficha F3.9). Sem banco próprio, 503.
// - GET  /api/administracao/rotinas (config.rotina.ler): rotinas com última e próxima execução, atraso e pedido pendente;
// - GET  /api/administracao/rotinas/:id/execucoes (config.rotina.ler): histórico com as etapas e quem disparou;
// - POST /api/administracao/rotinas/:id/acionar (config.rotina.acionar): pede a execução à mão;
// - POST /api/administracao/rotinas/:id/suspensao (config.rotina.acionar): suspende ou retoma ({ versao, acao }).
// Gravações pelo executor, com a trilha na mesma transação.
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
} from '@nestjs/common';
import { PERMISSOES_M10_CODIGOS as C } from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoGravacao } from '../agenda/apoio.js';
import { sessaoDe } from '../cadastro/comum.js';
import { problema } from './comum.js';
import type { RotinasAgendadasPropria } from './rotinas-agendadas-propria.js';

export const ROTINAS_AGENDADAS = Symbol('ROTINAS_AGENDADAS');

const corpoDe = (c: unknown): Record<string, unknown> =>
  c && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {};

@Controller()
export class RotinasAgendadasController {
  constructor(
    @Optional() @Inject(ROTINAS_AGENDADAS) private readonly porta: RotinasAgendadasPropria | null = null,
  ) {}

  private banco(): RotinasAgendadasPropria {
    if (!this.porta)
      throw new ErroProblema('indisponivel', 503, 'Rotinas agendadas indisponíveis neste ambiente');
    return this.porta;
  }

  private gravacao(req: RequisicaoAutorizada, rotulo: string) {
    const s = sessaoDe(req);
    const g = contextoGravacao(s, rotulo, false);
    return {
      hospital: s.hospital,
      login: s.login,
      correlacao: g.correlacao,
      chaveIdempotencia: g.chaveIdempotencia,
      ...(g.enderecoIp ? { enderecoIp: g.enderecoIp } : {}),
    };
  }

  @Get('administracao/rotinas')
  @Permissao(C.rotinaLer)
  async painel(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.banco()
      .painel({ hospital: s.hospital, login: s.login })
      .catch((x: unknown) => problema(x));
  }

  @Get('administracao/rotinas/:id/execucoes')
  @Permissao(C.rotinaLer)
  async historico(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: RequisicaoAutorizada,
    @Query('limite') limite?: string,
  ) {
    const s = sessaoDe(req);
    return this.banco()
      .historico({ hospital: s.hospital, login: s.login }, id, Number(limite) || 50)
      .catch((x: unknown) => problema(x));
  }

  @Post('administracao/rotinas/:id/acionar')
  @HttpCode(200)
  @Permissao(C.rotinaAcionar)
  @AuditadoNoHandler('sistema.rotina_acionar pelo executor (trilha na mesma transação)')
  async acionar(@Param('id', ParseIntPipe) id: number, @Req() req: RequisicaoAutorizada) {
    return this.banco()
      .acionar(this.gravacao(req, 'rotina-acionar'), { id })
      .catch((x: unknown) => problema(x));
  }

  @Post('administracao/rotinas/:id/suspensao')
  @HttpCode(200)
  @Permissao(C.rotinaAcionar)
  @AuditadoNoHandler('sistema.rotina_suspensao pelo executor (trilha na mesma transação)')
  async suspensao(
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.banco()
      .suspensao(this.gravacao(req, 'rotina-suspensao'), { ...corpoDe(corpo), id })
      .catch((x: unknown) => problema(x));
  }
}
