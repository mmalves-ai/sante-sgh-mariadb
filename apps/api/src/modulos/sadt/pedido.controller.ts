// Pedido de exames, cancelamento do item, kit com versão, recoleta e sub-amostras (F3.5, 05-SADT linhas 4, 5 e 7):
//   POST /api/sadt/pedidos/avaliar               as restrições do pedido na hora (nada gravado)
//   POST /api/sadt/pedidos                       abre a requisição com os itens (avulsos e kits) e as exceções
//                                                (exceção nova só com sadt.requisicao.autorizarExcecao)
//   GET  /api/sadt/pedidos/atendimentos?busca    busca do atendimento por número, prontuário ou nome
//   GET  /api/sadt/pedidos/atendimentos/:id      cabeçalho do paciente e as requisições com os itens
//   POST /api/sadt/pedidos/atendimentos/:id/conta  lança na conta os exames pendentes de cobrança do atendimento
//   POST /api/sadt/itens/:id/cancelar            cancela o item com o motivo do cadastro
//   GET  /api/sadt/itens/:id/eventos             a trilha clínica do item pedido
//   GET  /api/sadt/pedidos/motivos               motivos ativos de cancelamento e de recoleta
//   GET  /api/sadt/kits; POST /api/sadt/kits     kits vigentes; nova versão do kit (a anterior fica no histórico)
//   GET  /api/sadt/recoletas?abertas&paciente    recoletas (pendentes por padrão)
//   POST /api/sadt/amostras/:id/recoleta         pede a recoleta com o motivo
//   POST /api/sadt/recoletas/:id/coletar|cancelar
//   POST /api/sadt/amostras/:id/subamostras      gera as alíquotas pelas regras do exame
//   GET  /api/sadt/postos-coleta?todos           postos de coleta (ativos por padrão)
//   POST /api/sadt/postos-coleta                 inclui o posto, ou altera o que já existe (com o id)
//   POST /api/sadt/postos-coleta/:id/situacao    inativa ou reativa o posto (nunca apaga)
//   POST /api/sadt/amostras/:id/etiqueta         reimprime a etiqueta da amostra (via numerada)
// A etiqueta da recoleta coletada e a de cada alíquota vão sozinhas à fila da estação (05-SADT linha 7).
// Tudo ligado para todos: o que cada cargo faz vem só da permissão de cada rota.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { pode } from '@sgh/dominio-acesso';
import { estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { semBancoDoCliente } from './sem-banco-cliente.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { FONTE_DOCUMENTO, type FonteDocumento } from '../documento/public-api.js';
import { corpo } from '../exames/public-api.js';
import {
  esquemaCancelarItem,
  esquemaCancelarRecoleta,
  esquemaColetarRecoleta,
  esquemaPedidoExames,
  esquemaPedirRecoleta,
  esquemaVersaoKit,
  type ServicoPedidoSadt,
} from './aplicacao/pedido-propria.js';
import {
  esquemaImprimirEtiqueta,
  esquemaPostoColeta,
  esquemaSituacaoPosto,
  type EtiquetasImpressas,
} from './aplicacao/posto-coleta-propria.js';

export const SERVICO_PEDIDO_SADT = Symbol('SERVICO_PEDIDO_SADT');

/** Quem grava pode autorizar a exceção à restrição do exame (permissão própria; o administrador da plataforma pode tudo). */
const autorizaExcecao = (req: RequisicaoAutorizada) =>
  !!req.sgh && pode(req.sgh.ability, 'sadt.requisicao.autorizarExcecao');

@Controller('sadt')
export class PedidoSadtController {
  constructor(
    @Inject(SERVICO_PEDIDO_SADT) private readonly servico: ServicoPedidoSadt | null,
    @Optional() @Inject(FONTE_DOCUMENTO) private readonly documento: FonteDocumento | null = null,
  ) {}

  /**
   * A etiqueta de cada amostra nova na fila da impressora da estação, com a impressão gravada na amostra. A coleta e a
   * aliquotagem já estão gravadas: se a fila falhar, a resposta diz que a etiqueta não saiu e a tela oferece reimprimir.
   */
  private async etiquetas(
    req: RequisicaoAutorizada,
    amostras: readonly number[],
    estacao: string | null,
    reimpressao: boolean,
  ): Promise<EtiquetasImpressas> {
    const s = sessaoDe(req);
    return this.s.postos.imprimirEtiquetas(s.porta, amostras, this.documento, {
      rede: s.rede,
      estabelecimento: s.hospital,
      estacao: (estacao || estacaoDaRequisicao(req)).slice(0, 64),
      reimpressao,
    });
  }

  private get s(): ServicoPedidoSadt {
    if (!this.servico) throw semBancoDoCliente('O pedido de exames precisa do banco do cliente.');
    return this.servico;
  }

  @Post('pedidos/avaliar')
  @HttpCode(200)
  @Permissao('sadt.requisicao.ler')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  avaliar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.avaliarPedido(sessaoDe(req).porta, corpo(esquemaPedidoExames, b), autorizaExcecao(req));
  }

  @Post('pedidos')
  @Permissao('sadt.requisicao.criar')
  @AuditadoNoHandler('a requisição e os itens com a trilha_auditoria na mesma transação')
  abrir(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.abrirPedido(sessaoDe(req).porta, corpo(esquemaPedidoExames, b), autorizaExcecao(req));
  }

  @Get('pedidos/atendimentos')
  @Permissao('sadt.requisicao.ler')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  async buscarAtendimentos(@Query('busca') busca: string | undefined, @Req() req: RequisicaoAutorizada) {
    return { itens: await this.s.buscarAtendimentos(sessaoDe(req).porta, String(busca ?? '').slice(0, 80)) };
  }

  @Get('pedidos/atendimentos/:id')
  @Permissao('sadt.requisicao.ler')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  async doAtendimento(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const r = await this.s.pedidosDoAtendimento(sessaoDe(req).porta, idDaRota(id));
    if (r === null) throw new ErroProblema('nao-encontrado', 404, 'Registro não encontrado');
    return { ...r, podeAutorizarExcecao: autorizaExcecao(req) };
  }

  @Post('pedidos/atendimentos/:id/conta')
  @HttpCode(200)
  @Permissao('sadt.requisicao.criar')
  @AuditadoNoHandler('os itens da conta e os exames cobrados com a trilha_auditoria na mesma transação')
  lancarNaConta(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    return this.s.lancarPendentesNaConta(sessaoDe(req).porta, idDaRota(id));
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
  async coletarRecoleta(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaColetarRecoleta, b ?? {});
    const estacao = (e.estacao || estacaoDaRequisicao(req)).slice(0, 64);
    const r = await this.s.coletarRecoleta(sessaoDe(req).porta, idDaRota(id), { ...e, estacao });
    const etiqueta = await this.etiquetas(req, [r.amostra], estacao, false).catch(() => null);
    return { ...r, etiquetaNaFila: (etiqueta?.naFila ?? 0) > 0 };
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
  async subamostras(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const r = await this.s.gerarSubamostras(sessaoDe(req).porta, idDaRota(id));
    const etiqueta = await this.etiquetas(
      req,
      r.subamostras.map((x) => x.id),
      null,
      false,
    ).catch(() => null);
    return { ...r, etiquetasNaFila: etiqueta?.naFila ?? 0 };
  }

  // ── Posto de coleta e reimpressão da etiqueta (05-SADT linha 7) ───────────────────────────────────────────

  @Get('postos-coleta')
  @Permissao('sadt.amostra.ler')
  async postos(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    return { itens: await this.s.postos.postos(sessaoDe(req).porta, { ativos: q['todos'] !== 'sim' }) };
  }

  @Post('postos-coleta')
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('o posto de coleta com a trilha_auditoria na mesma transação')
  salvarPosto(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.postos.salvarPosto(sessaoDe(req).porta, corpo(esquemaPostoColeta, b));
  }

  @Post('postos-coleta/:id/situacao')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('o posto inativado ou reativado com a trilha_auditoria na mesma transação')
  situarPosto(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.postos.situarPosto(sessaoDe(req).porta, idDaRota(id), corpo(esquemaSituacaoPosto, b));
  }

  @Post('amostras/:id/etiqueta')
  @HttpCode(200)
  @Permissao('sadt.amostra.coletar')
  @AuditadoNoHandler('a via da etiqueta na passagem da amostra com a trilha_auditoria na mesma transação')
  async reimprimir(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaImprimirEtiqueta, b ?? {});
    const r = await this.etiquetas(req, [idDaRota(id)], e.estacao, true);
    return { naFila: r.naFila, via: r.vias[0]?.via ?? null };
  }
}
