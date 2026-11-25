// Rotas do envio de documentos à Rede Nacional de Dados em Saúde (C2-085, 08-INTG L130; sem chave de liberação: só a
// permissão; o destino real depende do credenciamento e, fora de produção, é sempre o simulador):
//   GET  /api/integracoes/rnds/envios?paciente=&situacao=   monitor dos envios (vacina, sumário e resultado)
//   GET  /api/integracoes/rnds/envios/:id/versoes           as versões do envio (original, substituição, cancelamento)
//   GET  /api/integracoes/rnds/pacientes/:id                visão por paciente: documentos, envio, bloqueio e ações
//   POST /api/integracoes/rnds/envios                       pede o envio, a substituição ou o cancelamento (motivo)
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
import { PERMISSOES_M34_CODIGOS as P } from '@sgh/contratos';
import { SITUACOES_ENVIO_RNDS } from '@sgh/dominio-integracao';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import type { ContextoComunicacao } from './comunicacao-base-propria.js';
import { PORTA_RNDS_ENVIO, type PortaRndsEnvioPropria } from './rnds-envio-propria.js';

const TRILHA =
  'pedido de envio, substituição ou cancelamento à rede nacional pelo executor (trilha na mesma transação)';

@Controller('integracoes/rnds')
export class RndsEnvioController {
  constructor(
    @Optional()
    @Inject(PORTA_RNDS_ENVIO)
    private readonly porta: PortaRndsEnvioPropria | null = null,
  ) {}

  private com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaRndsEnvioPropria, c: ContextoComunicacao) => Promise<T>,
  ): Promise<T> {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta as ContextoComunicacao).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('envios')
  @Permissao(P.fhirLer)
  envios(
    @Req() req: RequisicaoAutorizada,
    @Query('paciente') paciente?: string,
    @Query('situacao') situacao?: string,
  ) {
    const p = Number(paciente);
    const s = (SITUACOES_ENVIO_RNDS as readonly string[]).includes(situacao ?? '') ? situacao! : null;
    return this.com(req, async (porta, c) => ({
      itens: await porta.envios(c, { paciente: Number.isInteger(p) && p > 0 ? p : null, situacao: s }),
    }));
  }

  @Get('envios/:id/versoes')
  @Permissao(P.fhirLer)
  versoes(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, async (p, c) => ({ itens: await p.versoes(c, id) }));
  }

  @Get('pacientes/:id')
  @Permissao(P.fhirLer)
  paciente(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.paciente(c, id));
  }

  @Post('envios')
  @HttpCode(201)
  @Permissao(P.fhirEnviar)
  @AuditadoNoHandler(TRILHA)
  solicitar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.solicitar(c, corpo));
  }
}
