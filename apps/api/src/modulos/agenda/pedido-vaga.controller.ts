// Rotas do pedido de vaga do médico no prontuário (02-AGE linha 53). Ler: pep.pedidoVaga.ler (os pedidos do
// paciente, com os itens, e as opções da tela). Pedir: pep.pedidoVaga.criar (o profissional vinculado ao usuário vira
// o solicitante). Sem banco próprio, 503: a lista de espera é do banco do cliente.
// Como as vizinhas do prontuário: as duas rotas conferem o vínculo assistencial com o paciente (AcessoPacientePep, 403
// `sem-vinculo` com a tentativa na trilha), e a leitura vai à trilha de acesso ao prontuário (a observação do pedido
// guarda a indicação clínica).
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import { VinculoSintetico, type VinculoAssistencialPort } from '@sgh/dominio-acesso';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { ALERTA_AUDITOR, type AlertaAuditor } from '../acesso/alerta.js';
import {
  REGISTRO_EMERGENCIA,
  type RegistroEmergencia,
  VINCULO_ASSISTENCIAL,
} from '../acesso/emergencia.controller.js';
import { idDaRota, sessaoDe, type SessaoCadastro } from '../cadastro/comum.js';
import { FONTE_CONFIGURACAO, type FonteConfiguracao } from '../config/public-api.js';
import { AcessoPacientePep, chaveSessaoPep } from '../pep/acesso-paciente.js';
import { ESTADO_PRONTUARIO } from '../pep/prontuario.controller.js';
import { EstadoProntuario } from '../pep/sessao-prontuario.js';
import { corpo } from './agendas.controller.js';
import { contextoGravacao } from './apoio.js';
import { esquemaPedidoVaga, type PedidosVagaDoPaciente, type PedidosVagaPropria } from './pedido-vaga.js';

export const PEDIDOS_VAGA = Symbol('PEDIDOS_VAGA');
const LER = 'pep.pedidoVaga.ler';
const CRIAR = 'pep.pedidoVaga.criar';

@Controller('agenda/pedidos-vaga')
export class PedidosVagaController {
  private readonly acesso: AcessoPacientePep;
  private readonly estado: EstadoProntuario;

  constructor(
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(PEDIDOS_VAGA) private readonly pedidos: PedidosVagaPropria | null = null,
    @Optional() @Inject(ESTADO_PRONTUARIO) estado: EstadoProntuario | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(ALERTA_AUDITOR) alerta: AlertaAuditor | null = null,
    @Optional() @Inject(VINCULO_ASSISTENCIAL) vinculo: VinculoAssistencialPort = new VinculoSintetico(),
    @Optional() @Inject(REGISTRO_EMERGENCIA) emergencia: RegistroEmergencia | null = null,
  ) {
    this.estado = estado ?? new EstadoProntuario();
    this.acesso = new AcessoPacientePep({
      estado: this.estado,
      trilha,
      alerta,
      configuracao,
      vinculo,
      emergencia,
    });
  }

  /** Vínculo assistencial com o paciente e, na leitura, a leitura na trilha (primeira do paciente na sessão). */
  private async paciente(s: SessaoCadastro, paciente: number, permissao: string, leitura: boolean) {
    await this.acesso.exigirVinculo(s, paciente, permissao, 'pep.prontuario');
    if (leitura) {
      const chave = chaveSessaoPep(s);
      const motivo = this.estado.motivo(chave, paciente) ?? 'assistencia';
      if (!this.estado.motivo(chave, paciente)) this.estado.registrarMotivo(chave, paciente, motivo);
      await this.acesso.registrarLeitura(s, paciente, 'lista', motivo, 'pep.prontuario');
    }
  }

  private exigirBanco(): PedidosVagaPropria {
    if (!this.pedidos)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'Os pedidos de vaga ficam no banco do estabelecimento, que não está configurado.',
      );
    return this.pedidos;
  }

  @Get('paciente/:paciente')
  @Permissao('pep.pedidoVaga.ler')
  async doPaciente(
    @Param('paciente') paciente: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PedidosVagaDoPaciente> {
    const s = sessaoDe(req);
    const banco = this.exigirBanco();
    const p = idDaRota(paciente);
    await this.paciente(s, p, LER, true);
    return banco.doPaciente({ hospital: s.hospital, login: s.login }, p);
  }

  @Post()
  @HttpCode(200)
  @Permissao('pep.pedidoVaga.criar')
  @AuditadoNoHandler('agenda.pedido_vaga_incluir pelo executor (trilha na mesma transação)')
  async incluir(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const banco = this.exigirBanco();
    const e = corpo(esquemaPedidoVaga, b);
    await this.paciente(s, e.paciente, CRIAR, false);
    const g = contextoGravacao(s, 'agenda.pedidoVaga', true);
    const r = await banco.incluir(
      {
        hospital: s.hospital,
        login: s.login,
        correlacao: g.correlacao,
        chaveIdempotencia: g.chaveIdempotencia,
        ...(g.enderecoIp ? { enderecoIp: g.enderecoIp } : {}),
      },
      e,
    );
    return { ok: true, ...r, mensagem: 'Pedido de vaga na lista de espera.' };
  }
}
