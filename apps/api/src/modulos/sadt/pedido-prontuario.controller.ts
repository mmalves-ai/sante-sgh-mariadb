// A restrição clínica do pedido de exames feito na prescrição do prontuário, vista na hora (05-SADT linha 5):
//   POST /api/sadt/pedidos/avaliar-prontuario   os exames escolhidos no atendimento: bloqueio, alerta e se a exceção
//                                               pede justificativa (nada gravado)
// A mesma regra roda de novo na gravação do pedido do prontuário (pep.solicitarExame), na mesma transação.
import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { pode } from '@sgh/dominio-acesso';
import { Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  type AvaliacaoPedidoProntuario,
  esquemaAvaliarPedidoProntuario,
  type ServicoPedidoSadt,
} from './aplicacao/pedido-propria.js';
import { SERVICO_PEDIDO_SADT } from './pedido.controller.js';
import { semBancoDoCliente } from './sem-banco-cliente.js';

@Controller('sadt')
export class PedidoProntuarioSadtController {
  constructor(@Inject(SERVICO_PEDIDO_SADT) private readonly servico: ServicoPedidoSadt | null) {}

  @Post('pedidos/avaliar-prontuario')
  @HttpCode(200)
  @Permissao('pep.pedidoExame.criar')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  avaliar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<AvaliacaoPedidoProntuario> {
    if (!this.servico) throw semBancoDoCliente('A restrição do exame precisa do banco do cliente.');
    return this.servico.avaliarPedidoDoProntuario(
      sessaoDe(req).porta,
      corpo(esquemaAvaliarPedidoProntuario, b),
      !!req.sgh && pode(req.sgh.ability, 'sadt.requisicao.autorizarExcecao'),
    );
  }
}
