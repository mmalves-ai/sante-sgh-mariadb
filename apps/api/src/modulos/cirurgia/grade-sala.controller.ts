// Grade de funcionamento da sala cirúrgica (04-CC linha 92; F3.4, fatia F3.4-4):
//   GET  /api/cirurgia/salas/:sala/grade                 as faixas da sala (ativas e inativas)
//   POST /api/cirurgia/salas/:sala/grade                 cirurgia.gravarFaixaGrade (inclui ou altera uma faixa)
//   POST /api/cirurgia/grade-sala/:faixa/inativar        cirurgia.inativarFaixaGrade (a faixa nunca é apagada)
// Ligado para todos: o que controla é o nível de acesso do cargo (cirurgia.sala.ler e cirurgia.sala.editar, as mesmas
// dos usuários permitidos da sala). A agenda confere a grade ao agendar e remarcar (grade-sala-propria.ts).
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
import { contextoOperacao, sessaoDe } from '../cadastro/comum.js';
import { type GradeDaSala, PORTA_GRADE_SALA, type PortaGradeSalaPropria } from './grade-sala-propria.js';

@Controller('cirurgia')
export class GradeSalaController {
  constructor(
    @Optional()
    @Inject(PORTA_GRADE_SALA)
    private readonly porta: PortaGradeSalaPropria | null = null,
  ) {}

  private exigirPorta(): PortaGradeSalaPropria {
    if (!this.porta)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'A grade da sala exige o banco do cliente.',
      );
    return this.porta;
  }

  private async gravar(req: RequisicaoAutorizada, op: string, entrada: unknown) {
    const s = sessaoDe(req);
    const r = await this.exigirPorta().executar(s.porta, op, entrada, contextoOperacao(s, op));
    return { ok: true as const, resultado: r.resultado as Record<string, unknown>, repetida: r.repetida };
  }

  @Get('salas/:sala/grade')
  @Permissao('cirurgia.sala.ler')
  async grade(
    @Param('sala', ParseIntPipe) sala: number,
    @Req() req: RequisicaoAutorizada,
  ): Promise<GradeDaSala> {
    const g = await this.exigirPorta().grade(sessaoDe(req).porta, sala);
    if (!g)
      throw new ErroProblema('nao-encontrado', 404, 'Sala não encontrada', 'A sala cirúrgica não existe.');
    return g;
  }

  @Post('salas/:sala/grade')
  @HttpCode(200)
  @Permissao('cirurgia.sala.editar')
  @AuditadoNoHandler('cirurgia.gravarFaixaGrade pelo executor (trilha na mesma transação)')
  gravarFaixa(
    @Param('sala', ParseIntPipe) sala: number,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.gravar(req, 'cirurgia.gravarFaixaGrade', { ...((corpo ?? {}) as object), sala });
  }

  @Post('grade-sala/:faixa/inativar')
  @HttpCode(200)
  @Permissao('cirurgia.sala.editar')
  @AuditadoNoHandler('cirurgia.inativarFaixaGrade pelo executor (trilha na mesma transação)')
  inativarFaixa(
    @Param('faixa', ParseIntPipe) faixa: number,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.gravar(req, 'cirurgia.inativarFaixaGrade', { ...((corpo ?? {}) as object), faixa });
  }
}
