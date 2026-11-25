// Rotas do pedido de vaga do médico no prontuário (02-AGE linha 53). Ler: pep.pedidoVaga.ler (os pedidos do
// paciente, com os itens, e as opções da tela). Pedir: pep.pedidoVaga.criar (o profissional vinculado ao usuário vira
// o solicitante). Sem banco próprio, 503: a lista de espera é do banco do cliente.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from './agendas.controller.js';
import { contextoGravacao } from './apoio.js';
import { esquemaPedidoVaga, type PedidosVagaDoPaciente, type PedidosVagaPropria } from './pedido-vaga.js';

export const PEDIDOS_VAGA = Symbol('PEDIDOS_VAGA');

@Controller('agenda/pedidos-vaga')
export class PedidosVagaController {
  constructor(@Optional() @Inject(PEDIDOS_VAGA) private readonly pedidos: PedidosVagaPropria | null = null) {}

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
  doPaciente(
    @Param('paciente') paciente: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PedidosVagaDoPaciente> {
    const s = sessaoDe(req);
    return this.exigirBanco().doPaciente({ hospital: s.hospital, login: s.login }, idDaRota(paciente));
  }

  @Post()
  @HttpCode(200)
  @Permissao('pep.pedidoVaga.criar')
  @AuditadoNoHandler('agenda.pedido_vaga_incluir pelo executor (trilha na mesma transação)')
  async incluir(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaPedidoVaga, b);
    const g = contextoGravacao(s, 'agenda.pedidoVaga', true);
    const r = await this.exigirBanco().incluir(
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
