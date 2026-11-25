// Laboratório de apoio no banco do cliente (F3.5, 05-SADT linha 14):
//   GET  /api/sadt/apoio/:laboratorio/pendentes        as amostras coletadas do apoio que ainda não saíram
//   GET  /api/sadt/apoio/:laboratorio/de-para          o de-para de analito e de material (ativos e inativos)
//   GET  /api/sadt/apoio/:laboratorio/de-para/opcoes   os exames do apoio com os analitos e os materiais a incluir
//   POST /api/sadt/apoio/de-para/analito               inclui ou altera (desativa) o de-para de analito
//   POST /api/sadt/apoio/de-para/material              inclui ou altera (desativa) o de-para de material
//   GET  /api/sadt/apoio/remessas?laboratorio=         as remessas (abertas e fechadas primeiro)
//   POST /api/sadt/apoio/remessas                      abre a remessa com as pendentes (ou as amostras escolhidas)
//   GET  /api/sadt/apoio/remessas/:id                  a remessa com os itens e o que falta de de-para
//   GET  /api/sadt/apoio/remessas/:id/etiquetas        as etiquetas do apoio (só identificadores; texto e impressora)
//   POST /api/sadt/apoio/remessas/:id/acao             fechar, reabrir, enviar ou cancelar (com motivo)
//   POST /api/sadt/apoio/remessas/:id/retirar          retira um item da remessa aberta (fica cancelado)
// Tudo ligado para todos: o que cada cargo faz vem só da permissão de cada rota.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { EVENTOS_AUDITAVEIS, PERMISSOES_M34_CODIGOS as P } from '@sgh/contratos';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { semBancoDoCliente } from './sem-banco-cliente.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import type { ServicoApoioRemessa } from './aplicacao/apoio-remessa-propria.js';

export const SERVICO_APOIO_REMESSA = Symbol('SERVICO_APOIO_REMESSA');

@Controller('sadt/apoio')
export class ApoioRemessaController {
  constructor(@Inject(SERVICO_APOIO_REMESSA) private readonly servico: ServicoApoioRemessa | null) {}

  private get s(): ServicoApoioRemessa {
    if (!this.servico) throw semBancoDoCliente('O laboratório de apoio precisa do banco do cliente.');
    return this.servico;
  }

  @Get('remessas')
  @Permissao(P.apoioLer)
  async remessas(@Query('laboratorio') lab: string | undefined, @Req() req: RequisicaoAutorizada) {
    return { itens: await this.s.remessas(sessaoDe(req).porta, lab ? idDaRota(lab) : null) };
  }

  @Post('remessas')
  @HttpCode(200)
  @Permissao(P.apoioRemessa)
  @AuditadoNoHandler('a remessa e os itens com a trilha_auditoria na mesma transação')
  abrir(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.abrir(sessaoDe(req).porta, b);
  }

  @Get('remessas/:id')
  @Permissao(P.apoioLer)
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  remessa(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    return this.s.remessa(sessaoDe(req).porta, idDaRota(id));
  }

  @Get('remessas/:id/etiquetas')
  @Permissao(P.apoioRemessa)
  async etiquetas(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    return { itens: await this.s.etiquetas(sessaoDe(req).porta, idDaRota(id)) };
  }

  @Post('remessas/:id/acao')
  @HttpCode(200)
  @Permissao(P.apoioRemessa)
  @AuditadoNoHandler('a situação da remessa com a trilha_auditoria na mesma transação')
  agir(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.agir(sessaoDe(req).porta, idDaRota(id), b);
  }

  @Post('remessas/:id/retirar')
  @HttpCode(200)
  @Permissao(P.apoioRemessa)
  @AuditadoNoHandler('o item cancelado e a contagem da remessa com a trilha_auditoria na mesma transação')
  retirar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.retirarItem(sessaoDe(req).porta, idDaRota(id), b);
  }

  @Post('de-para/analito')
  @HttpCode(200)
  @Permissao(P.apoioDePara)
  @AuditadoNoHandler('o de-para de analito com a trilha_auditoria na mesma transação')
  deParaAnalito(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.salvarDeParaAnalito(sessaoDe(req).porta, b);
  }

  @Post('de-para/material')
  @HttpCode(200)
  @Permissao(P.apoioDePara)
  @AuditadoNoHandler('o de-para de material com a trilha_auditoria na mesma transação')
  deParaMaterial(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.salvarDeParaMaterial(sessaoDe(req).porta, b);
  }

  @Get(':laboratorio/pendentes')
  @Permissao(P.apoioLer)
  async pendentes(@Param('laboratorio') lab: string, @Req() req: RequisicaoAutorizada) {
    return { itens: await this.s.pendentes(sessaoDe(req).porta, idDaRota(lab)) };
  }

  @Get(':laboratorio/de-para/opcoes')
  @Permissao(P.apoioLer)
  opcoesDePara(@Param('laboratorio') lab: string, @Req() req: RequisicaoAutorizada) {
    return this.s.opcoesDePara(sessaoDe(req).porta, idDaRota(lab));
  }

  @Get(':laboratorio/de-para')
  @Permissao(P.apoioLer)
  dePara(@Param('laboratorio') lab: string, @Req() req: RequisicaoAutorizada) {
    return this.s.dePara(sessaoDe(req).porta, idDaRota(lab));
  }
}
