// Microbiologia estruturada (F7, 05-SADT linha 12) no banco do cliente: a cultura do resultado do exame com isolados e
// antibiograma interpretado pelo ponto de corte vigente, o laudo da cultura e a ligação do isolado ao caso da CCIH
// (comissão de controle de infecção hospitalar). Sem o banco do cliente, 503.
//   GET  /api/sadt/microbiologia/cadastro                         materiais, microrganismos, antimicrobianos e painéis
//   GET  /api/sadt/microbiologia/culturas/:resultado              a cultura do resultado, com o texto do laudo
//   POST /api/sadt/microbiologia/culturas/:resultado              grava a cultura (parcial ou final)
//   POST /api/sadt/microbiologia/culturas/:resultado/retificar    retifica a cultura final (com motivo)
//   POST /api/sadt/microbiologia/isolados/:isolado/caso           liga o isolado ao caso de infecção do paciente
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import type { ServicoMicrobiologia } from './aplicacao/microbiologia-propria.js';

export const SERVICO_MICROBIOLOGIA = Symbol('SERVICO_MICROBIOLOGIA');

@Controller('sadt/microbiologia')
export class MicrobiologiaController {
  constructor(@Inject(SERVICO_MICROBIOLOGIA) private readonly servico: ServicoMicrobiologia | null) {}

  private get s(): ServicoMicrobiologia {
    if (!this.servico)
      throw new ErroProblema('indisponivel', 503, 'A microbiologia precisa do banco do cliente.');
    return this.servico;
  }

  @Get('cadastro')
  @Permissao('sadt.resultado.ler')
  cadastro(@Req() req: RequisicaoAutorizada) {
    return this.s.cadastro(sessaoDe(req).porta);
  }

  @Get('culturas/:resultado')
  @Permissao('sadt.resultado.ler')
  cultura(@Param('resultado') resultado: string, @Req() req: RequisicaoAutorizada) {
    return this.s.cultura(sessaoDe(req).porta, idDaRota(resultado));
  }

  @Post('culturas/:resultado')
  @HttpCode(200)
  @Permissao('sadt.resultado.digitar')
  @AuditadoNoHandler(
    'a cultura, os isolados e o antibiograma com a trilha_auditoria na mesma transação (Executor)',
  )
  registrar(@Param('resultado') resultado: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.registrar(sessaoDe(req).porta, idDaRota(resultado), b);
  }

  @Post('culturas/:resultado/retificar')
  @HttpCode(200)
  @Permissao('sadt.resultado.retificar')
  @AuditadoNoHandler(
    'a retificação da cultura com o motivo na trilha_auditoria, na mesma transação (Executor)',
  )
  retificar(@Param('resultado') resultado: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.registrar(sessaoDe(req).porta, idDaRota(resultado), b, { retificacao: true });
  }

  @Post('isolados/:isolado/caso')
  @HttpCode(200)
  @Permissao('qualidade.ccih.registrar')
  @AuditadoNoHandler('a ligação do isolado ao caso com a trilha_auditoria na mesma transação (Executor)')
  ligarAoCaso(@Param('isolado') isolado: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.ligarAoCaso(sessaoDe(req).porta, idDaRota(isolado), b);
  }
}
