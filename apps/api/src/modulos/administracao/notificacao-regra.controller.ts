// Rotas da notificação por regra (01-ADM L76). Sem banco próprio, 503.
// - GET  /api/administracao/notificacao-regras (config.alerta.ler): regras de alerta com destinatários, regras de
//   consolidação, cenários e canais;
// - GET  /api/administracao/notificacao-regras/envios[?canal=&situacao=] (config.alerta.ler): histórico de envio e a
//   medição da resposta por canal (30 dias, com as parcelas);
// - POST /api/administracao/notificacao-regras/regras-alerta | consolidacoes | consolidar | envios/:id/situacao
//   (config.alerta.editar): gravações pelo executor (trilha na mesma transação); a regra global (de todos os
//   estabelecimentos) só muda de conteúdo e situação geral pelo administrador da plataforma;
// - GET  /api/acesso/notificacoes/meus-envios e POST /api/acesso/notificacoes/meus-envios/:id/resposta
//   (acesso.notificacao.responder): a resposta do destinatário, sempre da própria conta.
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
import type { NotificacaoRegraPropria } from './notificacao-regra-propria.js';

export const NOTIFICACAO_REGRA = Symbol('NOTIFICACAO_REGRA');

const corpoDe = (c: unknown): Record<string, unknown> =>
  c && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {};
const CODIGO = /^[A-Za-z0-9._-]{1,30}$/;

@Controller()
export class NotificacaoRegraController {
  constructor(
    @Optional() @Inject(NOTIFICACAO_REGRA) private readonly porta: NotificacaoRegraPropria | null = null,
  ) {}

  private banco(): NotificacaoRegraPropria {
    if (!this.porta)
      throw new ErroProblema('indisponivel', 503, 'Notificação por regra indisponível neste ambiente');
    return this.porta;
  }

  private gravacao(req: RequisicaoAutorizada, rotulo: string) {
    const s = sessaoDe(req);
    const g = contextoGravacao(s, rotulo, false);
    // Administrador da plataforma (direto ou na sessão "como"): altera a regra global de todos os estabelecimentos.
    const plataforma =
      req.sgh?.sessao.usuario.ator === 'plataforma' || req.sghComo?.atorTipo === 'plataforma';
    return {
      hospital: s.hospital,
      login: s.login,
      ...(plataforma ? { plataforma: true } : {}),
      correlacao: g.correlacao,
      chaveIdempotencia: g.chaveIdempotencia,
      ...(g.enderecoIp ? { enderecoIp: g.enderecoIp } : {}),
    };
  }

  @Get('administracao/notificacao-regras')
  @Permissao(C.alertaLer)
  async painel(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.banco()
      .painel({ hospital: s.hospital, login: s.login })
      .catch((x: unknown) => problema(x));
  }

  @Get('administracao/notificacao-regras/envios')
  @Permissao(C.alertaLer)
  async historico(
    @Req() req: RequisicaoAutorizada,
    @Query('canal') canal?: string,
    @Query('situacao') situacao?: string,
  ) {
    const s = sessaoDe(req);
    return this.banco()
      .historico(
        { hospital: s.hospital, login: s.login },
        {
          ...(typeof canal === 'string' && CODIGO.test(canal) ? { canal } : {}),
          ...(typeof situacao === 'string' && CODIGO.test(situacao) ? { situacao } : {}),
        },
      )
      .catch((x: unknown) => problema(x));
  }

  @Post('administracao/notificacao-regras/regras-alerta')
  @HttpCode(200)
  @Permissao(C.alertaEditar)
  @AuditadoNoHandler('notificacao.regra_alerta pelo executor (trilha na mesma transação)')
  async regraAlerta(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.banco()
      .gravarRegraAlerta(this.gravacao(req, 'notificacao-regra'), corpoDe(corpo))
      .catch((x: unknown) => problema(x));
  }

  @Post('administracao/notificacao-regras/consolidacoes')
  @HttpCode(200)
  @Permissao(C.alertaEditar)
  @AuditadoNoHandler('notificacao.consolidacao pelo executor (trilha na mesma transação)')
  async consolidacao(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.banco()
      .gravarRegraConsolidacao(this.gravacao(req, 'notificacao-consolidacao'), corpoDe(corpo))
      .catch((x: unknown) => problema(x));
  }

  @Post('administracao/notificacao-regras/consolidar')
  @HttpCode(200)
  @Permissao(C.alertaEditar)
  @AuditadoNoHandler('notificacao.consolidar pelo executor (trilha na mesma transação)')
  async consolidar(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.banco()
      .consolidarAgora(this.gravacao(req, 'notificacao-consolidar'), corpoDe(corpo))
      .catch((x: unknown) => problema(x));
  }

  @Post('administracao/notificacao-regras/envios/:id/situacao')
  @HttpCode(200)
  @Permissao(C.alertaEditar)
  @AuditadoNoHandler('notificacao.envio_situacao pelo executor (trilha na mesma transação)')
  async situacao(
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.banco()
      .registrarSituacao(this.gravacao(req, 'notificacao-situacao'), { ...corpoDe(corpo), envio: id })
      .catch((x: unknown) => problema(x));
  }

  @Get('acesso/notificacoes/meus-envios')
  @Permissao(C.notificacaoResponder)
  async meus(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.banco()
      .meusEnvios({ hospital: s.hospital, login: s.login })
      .then((envios) => ({ envios }))
      .catch((x: unknown) => problema(x));
  }

  @Post('acesso/notificacoes/meus-envios/:id/resposta')
  @HttpCode(200)
  @Permissao(C.notificacaoResponder)
  @AuditadoNoHandler('notificacao.envio_responder pelo executor (trilha na mesma transação)')
  async responder(
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.banco()
      .responderEnvio(this.gravacao(req, 'notificacao-resposta'), { ...corpoDe(corpo), envio: id })
      .catch((x: unknown) => problema(x));
  }
}
