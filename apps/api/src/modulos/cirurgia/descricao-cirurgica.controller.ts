// Descrição cirúrgica assinada e intercorrências do ato (04-CC linha 96; F3.4, fatia F3.4-4):
//   GET  /api/cirurgia/realizadas/:ato/descricao              o ato, a equipe, as descrições (achados e adendos), as
//                                                             intercorrências e os catálogos (leitura de prontuário)
//   POST /api/cirurgia/realizadas/:ato/descricao              cirurgia.salvarDescricao (salvar ou salvar e assinar)
//   POST /api/cirurgia/descricoes/:id/adendos                 cirurgia.adendoDescricao (só na assinada, pelo autor)
//   POST /api/cirurgia/realizadas/:ato/intercorrencias        cirurgia.registrarIntercorrencia
//   GET  /api/cirurgia/pacientes/:paciente/descricoes         as descrições do paciente (visão por paciente)
// Ligado para todos: o que controla é o nível de acesso do cargo (cirurgia.registro.ler e cirurgia.registro.criar);
// a autoria (só quem está na equipe do ato descreve; só o autor assina e inclui adendo) é regra do domínio.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, idDaRota, sessaoDe } from '../cadastro/comum.js';
import {
  type DescricaoDoPaciente,
  PORTA_DESCRICAO_CIRURGICA,
  type PortaDescricaoCirurgica,
  type TelaDescricaoCirurgica,
} from './descricao-cirurgica-porta.js';

interface Resultado {
  readonly ok: true;
  readonly resultado: Record<string, unknown>;
  readonly repetida: boolean;
  readonly mensagem: string;
}

@Controller('cirurgia')
export class DescricaoCirurgicaController {
  constructor(@Inject(PORTA_DESCRICAO_CIRURGICA) private readonly porta: PortaDescricaoCirurgica) {}

  private async gravar(
    req: RequisicaoAutorizada,
    op: string,
    entrada: unknown,
    mensagem: string,
  ): Promise<Resultado> {
    const s = sessaoDe(req);
    const r = await this.porta.executar(s.porta, op, entrada, contextoOperacao(s, op));
    return { ok: true, resultado: r.resultado as Record<string, unknown>, repetida: r.repetida, mensagem };
  }

  @Get('realizadas/:ato/descricao')
  @Permissao('cirurgia.registro.ler')
  @Auditar('cirurgia.agenda.lida')
  async tela(@Param('ato') ato: string, @Req() req: RequisicaoAutorizada): Promise<TelaDescricaoCirurgica> {
    const t = await this.porta.tela(sessaoDe(req).porta, idDaRota(ato));
    if (!t)
      throw new ErroProblema('nao-encontrado', 404, 'Cirurgia não encontrada', 'O ato cirúrgico não existe.');
    return t;
  }

  @Post('realizadas/:ato/descricao')
  @HttpCode(200)
  @Permissao('cirurgia.registro.criar')
  @AuditadoNoHandler('cirurgia.salvarDescricao pelo executor (trilha na mesma transação)')
  salvar(
    @Param('ato') ato: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<Resultado> {
    const e = { ...(b as object), ato: idDaRota(ato) };
    const assinar = (b as { assinar?: unknown } | null)?.assinar === true;
    return this.gravar(
      req,
      'cirurgia.salvarDescricao',
      e,
      assinar ? 'Descrição assinada.' : 'Rascunho salvo.',
    );
  }

  @Post('descricoes/:id/adendos')
  @HttpCode(201)
  @Permissao('cirurgia.registro.criar')
  @AuditadoNoHandler('cirurgia.adendoDescricao pelo executor (trilha na mesma transação)')
  adendo(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<Resultado> {
    return this.gravar(
      req,
      'cirurgia.adendoDescricao',
      { ...(b as object), descricao: idDaRota(id) },
      'Adendo registrado.',
    );
  }

  @Post('realizadas/:ato/intercorrencias')
  @HttpCode(201)
  @Permissao('cirurgia.registro.criar')
  @AuditadoNoHandler('cirurgia.registrarIntercorrencia pelo executor (trilha na mesma transação)')
  intercorrencia(
    @Param('ato') ato: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<Resultado> {
    return this.gravar(
      req,
      'cirurgia.registrarIntercorrencia',
      { ...(b as object), ato: idDaRota(ato) },
      'Intercorrência registrada.',
    );
  }

  @Get('pacientes/:paciente/descricoes')
  @Permissao('cirurgia.registro.ler')
  @Auditar('cirurgia.agenda.lida')
  doPaciente(
    @Param('paciente') paciente: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DescricaoDoPaciente[]> {
    return this.porta.doPaciente(sessaoDe(req).porta, idDaRota(paciente));
  }
}
