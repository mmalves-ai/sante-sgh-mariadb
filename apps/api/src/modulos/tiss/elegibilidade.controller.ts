// Consulta de elegibilidade do beneficiário (F3.9, 08-INTG L128 (31)). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/tiss/elegibilidade/pacientes/:paciente     coberturas com a última elegibilidade e as consultas (visão por paciente)
//   POST /api/tiss/elegibilidade                         { cobertura, atendimento? } registra a consulta (ou devolve a do dia)
//   POST /api/tiss/elegibilidade/:id/resposta            { situacao, motivoNegativa?, motivoGlosa?, codigoValidacao?, versao }
// Tudo ligado para todos; quem consulta e registra a resposta é decidido pelas permissões do cargo.
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
import { Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_ELEGIBILIDADE, type PortaElegibilidadePropria } from './elegibilidade-propria.js';

export const PERMISSOES_ELEGIBILIDADE = {
  ler: 'atendimento.atendimento.ler',
  gravar: 'atendimento.segurado.editar',
} as const;

@Controller('tiss/elegibilidade')
export class ElegibilidadeController {
  constructor(
    @Optional() @Inject(PORTA_ELEGIBILIDADE) private readonly porta: PortaElegibilidadePropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaElegibilidadePropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    return fn(this.porta, sessaoDe(req).porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('pacientes/:paciente')
  @Permissao(PERMISSOES_ELEGIBILIDADE.ler)
  doPaciente(@Req() req: RequisicaoAutorizada, @Param('paciente', ParseIntPipe) paciente: number) {
    return this.com(req, (p, c) => p.doPaciente(c, paciente));
  }

  @Post()
  @HttpCode(201)
  @Permissao(PERMISSOES_ELEGIBILIDADE.gravar)
  consultar(@Req() req: RequisicaoAutorizada, @Body() b: unknown) {
    return this.com(req, (p, c) => p.consultar(c, b));
  }

  @Post(':id/resposta')
  @HttpCode(200)
  @Permissao(PERMISSOES_ELEGIBILIDADE.gravar)
  responder(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() b: unknown) {
    return this.com(req, (p, c) => p.responder(c, id, b));
  }
}
