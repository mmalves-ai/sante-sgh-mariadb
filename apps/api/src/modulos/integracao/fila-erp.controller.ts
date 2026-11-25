// Rotas da fila com o sistema de gestão corporativo (ERP) do hospital (F8, 08-INTG L136; sem chave de liberação: só a
// permissão):
//   GET  /api/integracoes/erp/sistemas                 sistemas corporativos cadastrados (categoria erp)
//   GET  /api/integracoes/erp/lotes?tipo=&situacao=    monitor dos lotes (pagar, receber, estoque, compras, faturamento)
//   GET  /api/integracoes/erp/lotes/:id                o lote com os itens e o retorno de cada um (conciliação)
//   POST /api/integracoes/erp/lotes                    gera o lote do tipo no período
//   POST /api/integracoes/erp/lotes/:id/enviar         envia ao ERP (simulador fora de produção) e aplica o retorno
//   POST /api/integracoes/erp/lotes/:id/retorno        importa o retorno do ERP item a item (idempotente)
//   POST /api/integracoes/erp/lotes/:id/conciliar      concilia (nada pendente; total do ERP confere)
//   POST /api/integracoes/erp/lotes/:id/cancelar       cancela antes do envio, com motivo (nada é apagado)
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
import { SITUACOES_LOTE_ERP, TIPOS_FILA_ERP, type TipoFilaErp } from '@sgh/dominio-integracao';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import type { ContextoComunicacao } from './comunicacao-base-propria.js';
import { PORTA_FILA_ERP, type PortaFilaErpPropria } from './fila-erp-propria.js';

export const PERMISSOES_FILA_ERP = {
  ler: 'integracao.filaErp.ler',
  operar: 'integracao.filaErp.operar',
} as const;
const TRILHA =
  'geração, envio, retorno, conciliação e cancelamento do lote do ERP pelo executor (trilha na mesma transação)';

@Controller('integracoes/erp')
export class FilaErpController {
  constructor(
    @Optional()
    @Inject(PORTA_FILA_ERP)
    private readonly porta: PortaFilaErpPropria | null = null,
  ) {}

  private com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaFilaErpPropria, c: ContextoComunicacao) => Promise<T>,
  ): Promise<T> {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta as ContextoComunicacao).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('sistemas')
  @Permissao(PERMISSOES_FILA_ERP.ler)
  sistemas(@Req() req: RequisicaoAutorizada) {
    return this.com(req, async (p, c) => ({ itens: await p.sistemas(c) }));
  }

  @Get('lotes')
  @Permissao(PERMISSOES_FILA_ERP.ler)
  lotes(
    @Req() req: RequisicaoAutorizada,
    @Query('tipo') tipo?: string,
    @Query('situacao') situacao?: string,
  ) {
    const t = (TIPOS_FILA_ERP as readonly string[]).includes(tipo ?? '') ? (tipo as TipoFilaErp) : null;
    const s = (SITUACOES_LOTE_ERP as readonly string[]).includes(situacao ?? '') ? situacao! : null;
    return this.com(req, async (p, c) => ({ itens: await p.lotes(c, { tipo: t, situacao: s }) }));
  }

  @Get('lotes/:id')
  @Permissao(PERMISSOES_FILA_ERP.ler)
  lote(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.detalhe(c, id));
  }

  @Post('lotes')
  @HttpCode(201)
  @Permissao(PERMISSOES_FILA_ERP.operar)
  @AuditadoNoHandler(TRILHA)
  gerar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.gerar(c, corpo));
  }

  @Post('lotes/:id/enviar')
  @HttpCode(200)
  @Permissao(PERMISSOES_FILA_ERP.operar)
  @AuditadoNoHandler(TRILHA)
  enviar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.enviar(c, id, corpo));
  }

  @Post('lotes/:id/retorno')
  @HttpCode(200)
  @Permissao(PERMISSOES_FILA_ERP.operar)
  @AuditadoNoHandler(TRILHA)
  retorno(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.importarRetorno(c, id, corpo));
  }

  @Post('lotes/:id/conciliar')
  @HttpCode(200)
  @Permissao(PERMISSOES_FILA_ERP.operar)
  @AuditadoNoHandler(TRILHA)
  conciliar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.conciliar(c, id, corpo));
  }

  @Post('lotes/:id/cancelar')
  @HttpCode(200)
  @Permissao(PERMISSOES_FILA_ERP.operar)
  @AuditadoNoHandler(TRILHA)
  cancelar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.cancelar(c, id, corpo));
  }
}
