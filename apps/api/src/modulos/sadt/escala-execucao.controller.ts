// Escala de execução do diagnóstico (F3.5, 05-SADT linha 19): quem executa ou lauda em cada setor, em que dias e
// horários (inclusive o plantão que vira a noite) e quais exames atende, com o limite por turno e as vagas reservadas.
//   GET  /api/sadt/escalas-execucao[?setor=]          as escalas do estabelecimento (vigentes primeiro)
//   POST /api/sadt/escalas-execucao                   inclui (a regra confere tudo e o choque do mesmo executante)
//   POST /api/sadt/escalas-execucao/:id/encerrar      encerra a vigência (nunca apaga)
// Ler: `sadt.catalogo.ler`; gravar: `sadt.catalogo.editar` (o cargo dá o acesso; o administrador pode tudo).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  esquemaEncerrarEscala,
  esquemaEscalaExecucao,
  type ServicoEscalaExecucao,
} from './aplicacao/escala-execucao-propria.js';

export const SERVICO_ESCALA_EXECUCAO = Symbol('SERVICO_ESCALA_EXECUCAO');

@Controller('sadt/escalas-execucao')
export class EscalaExecucaoController {
  constructor(@Inject(SERVICO_ESCALA_EXECUCAO) private readonly servico: ServicoEscalaExecucao | null) {}

  private get s(): ServicoEscalaExecucao {
    if (!this.servico)
      throw new ErroProblema('indisponivel', 503, 'A escala de execução precisa do banco do cliente.');
    return this.servico;
  }

  @Get()
  @Permissao('sadt.catalogo.ler')
  listar(@Query('setor') setor: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.s.listar(sessaoDe(req).porta, setor ? idDaRota(setor) : null);
  }

  @Post()
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('a escala, os plantões e os exames com a trilha_auditoria na mesma transação (Executor)')
  incluir(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.incluir(sessaoDe(req).porta, corpo(esquemaEscalaExecucao, b));
  }

  @Post(':id/encerrar')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('o encerramento da vigência com a trilha_auditoria na mesma transação (Executor)')
  encerrar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.encerrar(sessaoDe(req).porta, idDaRota(id), corpo(esquemaEncerrarEscala, b));
  }
}
