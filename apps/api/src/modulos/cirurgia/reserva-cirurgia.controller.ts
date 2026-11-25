// Reserva de equipamentos e hemocomponentes para a cirurgia (F8, 04-CC linha 103). Rotas (porta própria; sem banco do
// cliente, 503):
//   GET  /api/cirurgia/agendamentos/:id/reservas                                     reservas, período e opções
//   POST /api/cirurgia/agendamentos/:id/reservas/equipamentos                        { equipamento, inicio?, fim?, ... }
//   POST /api/cirurgia/agendamentos/:id/reservas/hemocomponentes                     { hemocomponente, quantidade, ... }
//   POST /api/cirurgia/agendamentos/:id/reservas/hemocomponentes/:reserva/requisicao { requisicaoItem, versao }
//   POST /api/cirurgia/agendamentos/:id/reservas/:tipo/:reserva/cancelar             { versao } (nada apagado)
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
  Req,
} from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_RESERVA_CIRURGIA, type PortaReservaCirurgiaPropria } from './reserva-cirurgia-propria.js';

export const PERMISSOES_RESERVA_CIRURGIA = {
  ler: 'cirurgia.agenda.ler',
  editar: 'cirurgia.agenda.agendar',
} as const;

const TIPOS = { equipamentos: 'equipamento', hemocomponentes: 'hemocomponente' } as const;

@Controller('cirurgia/agendamentos/:id/reservas')
export class ReservaCirurgiaController {
  constructor(
    @Optional()
    @Inject(PORTA_RESERVA_CIRURGIA)
    private readonly porta: PortaReservaCirurgiaPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaReservaCirurgiaPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    return fn(this.porta, sessaoDe(req).porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao(PERMISSOES_RESERVA_CIRURGIA.ler)
  reservas(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.reservas(c, id));
  }

  @Post('equipamentos')
  @HttpCode(200)
  @Permissao(PERMISSOES_RESERVA_CIRURGIA.editar)
  @AuditadoNoHandler('equipamento reservado para a cirurgia pelo executor (trilha na mesma transação)')
  reservarEquipamento(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.reservarEquipamento(c, id, corpo));
  }

  @Post('hemocomponentes')
  @HttpCode(200)
  @Permissao(PERMISSOES_RESERVA_CIRURGIA.editar)
  @AuditadoNoHandler('hemocomponente pedido para a cirurgia pelo executor (trilha na mesma transação)')
  pedirHemocomponente(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.pedirHemocomponente(c, id, corpo));
  }

  @Post('hemocomponentes/:reserva/requisicao')
  @HttpCode(200)
  @Permissao(PERMISSOES_RESERVA_CIRURGIA.editar)
  @AuditadoNoHandler(
    'reserva de hemocomponente ligada à requisição transfusional pelo executor (trilha na mesma transação)',
  )
  ligarRequisicao(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Param('reserva', ParseIntPipe) reserva: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.ligarRequisicao(c, id, reserva, corpo));
  }

  @Post(':tipo/:reserva/cancelar')
  @HttpCode(200)
  @Permissao(PERMISSOES_RESERVA_CIRURGIA.editar)
  @AuditadoNoHandler('reserva da cirurgia cancelada pelo executor (trilha na mesma transação; nada apagado)')
  cancelar(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Param('tipo') tipo: string,
    @Param('reserva', ParseIntPipe) reserva: number,
    @Body() corpo: unknown,
  ) {
    const t = TIPOS[tipo as keyof typeof TIPOS];
    if (!t) throw new ErroProblema('nao-encontrado', 404, 'Tipo de reserva inexistente');
    return this.com(req, (p, c) => p.cancelar(c, id, t, reserva, corpo));
  }
}
