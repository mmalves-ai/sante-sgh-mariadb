// Interface com os equipamentos do laboratório (F3.5, 05-SADT linha 13): o cadastro da interface com o equipamento, o
// de-para de exames e de analitos, o pedido que vai ao equipamento e o resultado que volta, pela fila de integração.
//   GET  /api/sadt/interfaces-equipamento                       as interfaces do estabelecimento, com o que está pendente
//   GET  /api/sadt/interfaces-equipamento/apoio                 modelos de comunicação, setores e protocolos (combos)
//   POST /api/sadt/interfaces-equipamento                       inclui ou altera (o equipamento novo vai junto)
//   GET  /api/sadt/interfaces-equipamento/:id/de-para           códigos de exames e de analitos no equipamento
//   POST /api/sadt/interfaces-equipamento/:id/de-para/exames    inclui, altera ou inativa o código de um exame
//   POST /api/sadt/interfaces-equipamento/:id/de-para/analitos  inclui, altera ou inativa o código de um analito
//   GET  /api/sadt/interfaces-equipamento/:id/mensagens         as últimas mensagens trafegadas (sem o conteúdo)
//   POST /api/sadt/interfaces-equipamento/:id/pedidos           envia exames pedidos ao equipamento (fila de saída)
//   POST /api/sadt/interfaces-equipamento/:id/resultados        recebe o resultado do equipamento (leituras ou ASTM)
//   POST /api/sadt/interfaces-equipamento/:id/mensagens/:mensagem/reprocessar   reprocessa a mensagem em erro
// Ler: `sadt.interface.ler`; cadastro e de-para: `sadt.catalogo.editar`; tráfego: `sadt.resultado.digitar` (o resultado
// recebido entra como digitado e espera a conferência e a liberação de quem tem o direito).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  esquemaDeParaAnalito,
  esquemaDeParaExame,
  esquemaInterfaceEquipamento,
  esquemaPedidoEquipamento,
  esquemaResultadoEquipamento,
  type ServicoInterfaceEquipamento,
} from './aplicacao/interface-equipamento-propria.js';

export const SERVICO_INTERFACE_EQUIPAMENTO = Symbol('SERVICO_INTERFACE_EQUIPAMENTO');

@Controller('sadt/interfaces-equipamento')
export class InterfaceEquipamentoController {
  constructor(
    @Inject(SERVICO_INTERFACE_EQUIPAMENTO) private readonly servico: ServicoInterfaceEquipamento | null,
  ) {}

  private get s(): ServicoInterfaceEquipamento {
    if (!this.servico)
      throw new ErroProblema('indisponivel', 503, 'A interface de equipamento precisa do banco do cliente.');
    return this.servico;
  }

  @Get()
  @Permissao('sadt.interface.ler')
  listar(@Req() req: RequisicaoAutorizada) {
    return this.s.listar(sessaoDe(req).porta);
  }

  @Get('apoio')
  @Permissao('sadt.interface.ler')
  apoio(@Req() req: RequisicaoAutorizada) {
    return this.s.apoio(sessaoDe(req).porta);
  }

  @Post()
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('a interface e o equipamento com a trilha_auditoria na mesma transação (Executor)')
  salvar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.salvar(sessaoDe(req).porta, corpo(esquemaInterfaceEquipamento, b));
  }

  @Get(':id/de-para')
  @Permissao('sadt.interface.ler')
  dePara(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    return this.s.dePara(sessaoDe(req).porta, idDaRota(id));
  }

  @Post(':id/de-para/exames')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('o de-para do exame com a trilha_auditoria na mesma transação (Executor)')
  salvarDeParaExame(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.salvarDeParaExame(sessaoDe(req).porta, idDaRota(id), corpo(esquemaDeParaExame, b));
  }

  @Post(':id/de-para/analitos')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('o de-para do analito com a trilha_auditoria na mesma transação (Executor)')
  salvarDeParaAnalito(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.salvarDeParaAnalito(sessaoDe(req).porta, idDaRota(id), corpo(esquemaDeParaAnalito, b));
  }

  @Get(':id/mensagens')
  @Permissao('sadt.interface.ler')
  mensagens(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    return this.s.mensagens(sessaoDe(req).porta, idDaRota(id));
  }

  @Post(':id/pedidos')
  @HttpCode(200)
  @Permissao('sadt.resultado.digitar')
  @AuditadoNoHandler('a mensagem da fila de saída com a trilha_auditoria na mesma transação (Executor)')
  enviarPedido(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.enviarPedido(sessaoDe(req).porta, idDaRota(id), corpo(esquemaPedidoEquipamento, b));
  }

  @Post(':id/resultados')
  @HttpCode(200)
  @Permissao('sadt.resultado.digitar')
  @AuditadoNoHandler('a mensagem recebida e o resultado com a trilha_auditoria em cada transação (Executor)')
  receberResultado(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.receberResultado(sessaoDe(req).porta, idDaRota(id), corpo(esquemaResultadoEquipamento, b));
  }

  @Post(':id/mensagens/:mensagem/reprocessar')
  @HttpCode(200)
  @Permissao('sadt.resultado.digitar')
  @AuditadoNoHandler('o resultado e o fecho da mensagem com a trilha_auditoria em cada transação (Executor)')
  reprocessar(
    @Param('id') id: string,
    @Param('mensagem') mensagem: string,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.s.reprocessar(sessaoDe(req).porta, idDaRota(id), idDaRota(mensagem));
  }
}
