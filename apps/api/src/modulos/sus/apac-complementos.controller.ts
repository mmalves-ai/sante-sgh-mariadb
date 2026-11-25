// Laudos específicos e sessões da APAC (F7, 06-SUS linha 56). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/sus/apac-complementos/:laudo                          laudos complementares, pendência e sessões
//   POST /api/sus/apac-complementos/:laudo/laudos/:tipo             { versao, dados } grava (oncologia, auditiva,
//                                                                   medicamento, odontologia)
//   POST /api/sus/apac-complementos/:laudo/laudos/:tipo/retirar     { versao } (marcado como excluído)
//   POST /api/sus/apac-complementos/:laudo/sessoes                  { versao, data, ... } registra a sessão
//   POST /api/sus/apac-complementos/sessoes/:id/cancelar            { versao } (marcada como excluída)
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
  Req,
} from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  laudoDaRota,
  PORTA_APAC_COMPLEMENTOS,
  type PortaApacComplementosPropria,
} from './apac-complementos-propria.js';

const TRILHA = 'laudo específico e sessão da APAC pelo executor (trilha na mesma transação)';

@Controller('sus/apac-complementos')
export class ApacComplementosController {
  constructor(
    @Optional()
    @Inject(PORTA_APAC_COMPLEMENTOS)
    private readonly porta: PortaApacComplementosPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaApacComplementosPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get(':laudo')
  @Permissao('faturamento.sus.ler')
  complementos(@Req() req: RequisicaoAutorizada, @Param('laudo', ParseIntPipe) laudo: number) {
    return this.com(req, (p, c) => p.complementos(c, laudo));
  }

  @Post(':laudo/laudos/:tipo')
  @HttpCode(200)
  @Permissao('faturamento.susApac.registrar')
  @AuditadoNoHandler(TRILHA)
  gravarLaudo(
    @Req() req: RequisicaoAutorizada,
    @Param('laudo', ParseIntPipe) laudo: number,
    @Param('tipo') tipo: string,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.gravarLaudo(c, laudo, laudoDaRota(tipo), corpo));
  }

  @Post(':laudo/laudos/:tipo/retirar')
  @HttpCode(200)
  @Permissao('faturamento.susApac.registrar')
  @AuditadoNoHandler(TRILHA)
  retirarLaudo(
    @Req() req: RequisicaoAutorizada,
    @Param('laudo', ParseIntPipe) laudo: number,
    @Param('tipo') tipo: string,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.retirarLaudo(c, laudo, laudoDaRota(tipo), corpo));
  }

  @Post(':laudo/sessoes')
  @HttpCode(201)
  @Permissao('faturamento.susApac.registrar')
  @AuditadoNoHandler(TRILHA)
  registrarSessao(
    @Req() req: RequisicaoAutorizada,
    @Param('laudo', ParseIntPipe) laudo: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.registrarSessao(c, laudo, corpo));
  }

  @Post('sessoes/:id/cancelar')
  @HttpCode(200)
  @Permissao('faturamento.susApac.registrar')
  @AuditadoNoHandler(TRILHA)
  cancelarSessao(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.cancelarSessao(c, id, corpo));
  }
}
