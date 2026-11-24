// Pedido de exames, cancelamento do item, kit com versão, recoleta e sub-amostras (F3.5, 05-SADT linhas 4, 5 e 7):
//   POST /api/sadt/pedidos/avaliar               as restrições do pedido na hora (nada gravado)
//   POST /api/sadt/pedidos                       abre a requisição com os itens (avulsos e kits) e as exceções
//   POST /api/sadt/itens/:id/cancelar            cancela o item com o motivo do cadastro
//   GET  /api/sadt/itens/:id/eventos             a trilha clínica do item pedido
//   GET  /api/sadt/pedidos/motivos               motivos ativos de cancelamento e de recoleta
//   GET  /api/sadt/kits; POST /api/sadt/kits     kits vigentes; nova versão do kit (a anterior fica no histórico)
//   GET  /api/sadt/recoletas?abertas&paciente    recoletas (pendentes por padrão)
//   POST /api/sadt/amostras/:id/recoleta         pede a recoleta com o motivo
//   POST /api/sadt/recoletas/:id/coletar|cancelar
//   POST /api/sadt/amostras/:id/subamostras      gera as alíquotas pelas regras do exame
// Tudo ligado para todos: o que cada cargo faz vem só da permissão de cada rota.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  esquemaCancelarItem,
  esquemaCancelarRecoleta,
  esquemaPedidoExames,
  esquemaPedirRecoleta,
  esquemaVersaoKit,
  type ServicoPedidoSadt,
} from './aplicacao/pedido-propria.js';

export const SERVICO_PEDIDO_SADT = Symbol('SERVICO_PEDIDO_SADT');

@Controller('sadt')
export class PedidoSadtController {
  constructor(@Inject(SERVICO_PEDIDO_SADT) private readonly servico: ServicoPedidoSadt | null) {}

  private get s(): ServicoPedidoSadt {
    if (!this.servico)
      throw new ErroProblema('indisponivel', 503, 'O pedido de exames precisa do banco do cliente.');
    return this.servico;
  }

  @Post('pedidos/avaliar')
  @HttpCode(200)
  @Permissao('sadt.requisicao.ler')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  avaliar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.avaliarPedido(sessaoDe(req).porta, corpo(esquemaPedidoExames, b));
  }

  @Post('pedidos')
  @Permissao('sadt.requisicao.criar')
  @AuditadoNoHandler('a requisição e os itens com a trilha_auditoria na mesma transação')
  abrir(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.abrirPedido(sessaoDe(req).porta, corpo(esquemaPedidoExames, b));
  }

  @Get('pedidos/motivos')
  @Permissao('sadt.requisicao.ler')
  motivos(@Req() req: RequisicaoAutorizada) {
    return this.s.motivos(sessaoDe(req).porta);
  }

  @Post('itens/:id/cancelar')
  @HttpCode(200)
  @Permissao('sadt.requisicao.criar')
  @AuditadoNoHandler('o item cancelado e o evento com a trilha_auditoria na mesma transação')
  cancelar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.cancelarItem(sessaoDe(req).porta, idDaRota(id), corpo(esquemaCancelarItem, b));
  }

  @Get('itens/:id/eventos')
  @Permissao('sadt.requisicao.ler')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  async eventos(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const r = await this.s.eventosDoItem(sessaoDe(req).porta, idDaRota(id));
    if (r === null) throw new ErroProblema('nao-encontrado', 404, 'Registro não encontrado');
    return { itens: r };
  }

  @Get('kits')
  @Permissao('sadt.requisicao.ler')
  async kits(@Req() req: RequisicaoAutorizada) {
    return { itens: await this.s.kits(sessaoDe(req).porta) };
  }

  @Post('kits')
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('a versão do kit com a trilha_auditoria na mesma transação')
  versaoKit(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.salvarVersaoKit(sessaoDe(req).porta, corpo(esquemaVersaoKit, b));
  }

  @Get('recoletas')
  @Permissao('sadt.amostra.ler')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  async recoletas(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const paciente = q['paciente'] ? idDaRota(q['paciente']) : undefined;
    return {
      itens: await this.s.recoletas(sessaoDe(req).porta, {
        abertas: q['abertas'] !== 'nao',
        ...(paciente ? { paciente } : {}),
      }),
    };
  }

  @Post('amostras/:id/recoleta')
  @Permissao('sadt.amostra.rejeitar')
  @AuditadoNoHandler('a recoleta, a amostra rejeitada e os exames com a trilha_auditoria na mesma transação')
  pedirRecoleta(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.pedirRecoleta(sessaoDe(req).porta, idDaRota(id), corpo(esquemaPedirRecoleta, b));
  }

  @Post('recoletas/:id/coletar')
  @HttpCode(200)
  @Permissao('sadt.amostra.coletar')
  @AuditadoNoHandler('a amostra da recoleta com a trilha_auditoria na mesma transação')
  coletarRecoleta(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    return this.s.coletarRecoleta(sessaoDe(req).porta, idDaRota(id));
  }

  @Post('recoletas/:id/cancelar')
  @HttpCode(200)
  @Permissao('sadt.amostra.rejeitar')
  @AuditadoNoHandler('a recoleta cancelada com a trilha_auditoria na mesma transação')
  cancelarRecoleta(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.cancelarRecoleta(sessaoDe(req).porta, idDaRota(id), corpo(esquemaCancelarRecoleta, b));
  }

  @Post('amostras/:id/subamostras')
  @HttpCode(200)
  @Permissao('sadt.amostra.receber')
  @AuditadoNoHandler('as alíquotas e a primária aliquotada com a trilha_auditoria na mesma transação')
  subamostras(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    return this.s.gerarSubamostras(sessaoDe(req).porta, idDaRota(id));
  }
}
