// Equipe realizada do ato cirúrgico (F3.4, 04-CC linha 95). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/cirurgia/atos/:id/equipe          a equipe do ato, membro a membro, com os tempos e os minutos
//   POST /api/cirurgia/atos/:id/equipe/conta    { itens: [{ procedimento, item }] } leva a equipe ao item da conta
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
import { PORTA_EQUIPE_REALIZADA, type PortaEquipeRealizadaPropria } from './equipe-realizada-propria.js';

export const PERMISSOES_EQUIPE_REALIZADA = {
  ler: 'cirurgia.registro.ler',
  levarConta: 'faturamento.item.lancar',
} as const;

@Controller('cirurgia/atos/:id/equipe')
export class EquipeRealizadaController {
  constructor(
    @Optional()
    @Inject(PORTA_EQUIPE_REALIZADA)
    private readonly porta: PortaEquipeRealizadaPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaEquipeRealizadaPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    return fn(this.porta, sessaoDe(req).porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao(PERMISSOES_EQUIPE_REALIZADA.ler)
  equipe(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.equipe(c, id));
  }

  @Post('conta')
  @HttpCode(200)
  @Permissao(PERMISSOES_EQUIPE_REALIZADA.levarConta)
  @AuditadoNoHandler('equipe do ato levada ao item da conta pelo executor (trilha na mesma transação)')
  levarParaConta(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.levarParaConta(c, id, corpo));
  }
}
