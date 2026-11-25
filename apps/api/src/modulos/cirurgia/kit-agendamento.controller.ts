// Kit padrão no agendamento cirúrgico (F3.6, 05-SUP linha 13). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/cirurgia/agendamentos/:id/kit-padrao                       o kit padrão de cada procedimento e a lista
//   POST /api/cirurgia/agendamentos/:id/kit-padrao                       { kits? } aplica os escolhidos (ou todos)
//   POST /api/cirurgia/agendamentos/:id/materiais/:material/retirar      { versao } tira da lista (nada apagado)
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
import { PORTA_KIT_AGENDAMENTO, type PortaKitAgendamentoPropria } from './kit-agendamento-propria.js';

export const PERMISSOES_KIT_AGENDAMENTO = {
  ler: 'cirurgia.agenda.ler',
  editar: 'cirurgia.agenda.agendar',
} as const;

@Controller('cirurgia/agendamentos/:id')
export class KitAgendamentoController {
  constructor(
    @Optional()
    @Inject(PORTA_KIT_AGENDAMENTO)
    private readonly porta: PortaKitAgendamentoPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaKitAgendamentoPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    return fn(this.porta, sessaoDe(req).porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('kit-padrao')
  @Permissao(PERMISSOES_KIT_AGENDAMENTO.ler)
  sugestao(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.sugestao(c, id));
  }

  @Post('kit-padrao')
  @HttpCode(200)
  @Permissao(PERMISSOES_KIT_AGENDAMENTO.editar)
  @AuditadoNoHandler('kit padrão no agendamento pelo executor (trilha na mesma transação)')
  aplicar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.aplicar(c, id, corpo));
  }

  @Post('materiais/:material/retirar')
  @HttpCode(200)
  @Permissao(PERMISSOES_KIT_AGENDAMENTO.editar)
  @AuditadoNoHandler('material do agendamento retirado pelo executor (trilha na mesma transação)')
  retirar(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Param('material', ParseIntPipe) material: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.retirar(c, id, material, corpo));
  }
}
