// A restrição clínica do pedido de exames feito na prescrição do prontuário, vista na hora (05-SADT linha 5):
//   POST /api/sadt/pedidos/avaliar-prontuario/:paciente   os exames escolhidos no atendimento do paciente: bloqueio,
//                                                         alerta e se a exceção pede justificativa (nada gravado)
// A mesma regra roda de novo na gravação do pedido do prontuário (pep.solicitarExame), na mesma transação.
// O paciente vai na rota: o filtro comum do paciente com acesso restrito (cadastro/acesso-restrito.interceptor.ts) o lê
// e recusa com 403 `paciente-restrito` quem não está liberado. Como as rotas do prontuário, a rota confere também o
// vínculo assistencial (AcessoPacientePep, 403 `sem-vinculo` com a tentativa na trilha), e o atendimento do corpo tem
// de ser do paciente da rota (`atendimento-de-outro-paciente`).
import { Body, Controller, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { pode, VinculoSintetico, type VinculoAssistencialPort } from '@sgh/dominio-acesso';
import { Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ALERTA_AUDITOR, type AlertaAuditor } from '../acesso/alerta.js';
import {
  REGISTRO_EMERGENCIA,
  type RegistroEmergencia,
  VINCULO_ASSISTENCIAL,
} from '../acesso/emergencia.controller.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { FONTE_CONFIGURACAO, type FonteConfiguracao } from '../config/public-api.js';
import { corpo } from '../exames/public-api.js';
import { AcessoPacientePep } from '../pep/acesso-paciente.js';
import { ESTADO_PRONTUARIO } from '../pep/prontuario.controller.js';
import { EstadoProntuario } from '../pep/sessao-prontuario.js';
import {
  type AvaliacaoPedidoProntuario,
  esquemaAvaliarPedidoProntuario,
  type ServicoPedidoSadt,
} from './aplicacao/pedido-propria.js';
import { SERVICO_PEDIDO_SADT } from './pedido.controller.js';
import { semBancoDoCliente } from './sem-banco-cliente.js';

const CRIAR = 'pep.pedidoExame.criar';

@Controller('sadt')
export class PedidoProntuarioSadtController {
  private readonly acesso: AcessoPacientePep;

  constructor(
    @Inject(SERVICO_PEDIDO_SADT) private readonly servico: ServicoPedidoSadt | null,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(ESTADO_PRONTUARIO) estado: EstadoProntuario | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(ALERTA_AUDITOR) alerta: AlertaAuditor | null = null,
    @Optional() @Inject(VINCULO_ASSISTENCIAL) vinculo: VinculoAssistencialPort = new VinculoSintetico(),
    @Optional() @Inject(REGISTRO_EMERGENCIA) emergencia: RegistroEmergencia | null = null,
  ) {
    this.acesso = new AcessoPacientePep({
      estado: estado ?? new EstadoProntuario(),
      trilha,
      alerta,
      configuracao,
      vinculo,
      emergencia,
    });
  }

  @Post('pedidos/avaliar-prontuario/:paciente')
  @HttpCode(200)
  @Permissao(CRIAR)
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  async avaliar(
    @Param('paciente') p: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<AvaliacaoPedidoProntuario> {
    const paciente = idDaRota(p);
    const s = sessaoDe(req);
    await this.acesso.exigirVinculo(s, paciente, CRIAR, 'pep.prescricao');
    if (!this.servico) throw semBancoDoCliente('A restrição do exame precisa do banco do cliente.');
    return this.servico.avaliarPedidoDoProntuario(
      s.porta,
      paciente,
      corpo(esquemaAvaliarPedidoProntuario, b),
      !!req.sgh && pode(req.sgh.ability, 'sadt.requisicao.autorizarExcecao'),
    );
  }
}
