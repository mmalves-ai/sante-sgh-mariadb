// Cadastro do antibiograma (F7, 05-SADT linha 12) no banco do cliente: os painéis de antimicrobianos e os pontos de
// corte por norma e versão que a cultura usa. Sem o banco do cliente, 503.
//   GET  /api/sadt/microbiologia/pontos-corte?microrganismo=      os pontos de corte, com a marca de uso
//   POST /api/sadt/microbiologia/paineis                          cria o painel com os itens na ordem do laudo
//   POST /api/sadt/microbiologia/paineis/:painel                  altera o painel (versão lida)
//   POST /api/sadt/microbiologia/pontos-corte                     cria o ponto (encerra na véspera o que ainda vale)
//   POST /api/sadt/microbiologia/pontos-corte/:ponto              corrige o ponto ainda não usado (versão lida)
//   POST /api/sadt/microbiologia/pontos-corte/:ponto/encerrar     encerra a vigência do ponto
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { semBancoDoCliente } from './sem-banco-cliente.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import type { ServicoCadastroMicrobiologia } from './aplicacao/microbiologia-cadastro-propria.js';

export const SERVICO_CADASTRO_MICROBIOLOGIA = Symbol('SERVICO_CADASTRO_MICROBIOLOGIA');

@Controller('sadt/microbiologia')
export class MicrobiologiaCadastroController {
  constructor(
    @Inject(SERVICO_CADASTRO_MICROBIOLOGIA) private readonly servico: ServicoCadastroMicrobiologia | null,
  ) {}

  private get s(): ServicoCadastroMicrobiologia {
    if (!this.servico) throw semBancoDoCliente('O cadastro do antibiograma precisa do banco do cliente.');
    return this.servico;
  }

  @Get('pontos-corte')
  @Permissao('sadt.catalogo.ler')
  pontos(@Query('microrganismo') microrganismo: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.s.pontos(sessaoDe(req).porta, {
      microrganismo: microrganismo ? idDaRota(microrganismo) : null,
    });
  }

  @Post('paineis')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('o painel e os itens com a trilha_auditoria na mesma transação (Executor)')
  criarPainel(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.gravarPainel(sessaoDe(req).porta, null, b);
  }

  @Post('paineis/:painel')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('o painel e os itens com a trilha_auditoria na mesma transação (Executor)')
  alterarPainel(@Param('painel') painel: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.gravarPainel(sessaoDe(req).porta, idDaRota(painel), b);
  }

  @Post('pontos-corte')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler(
    'o ponto de corte e o encerramento da versão anterior com a trilha_auditoria na mesma transação (Executor)',
  )
  criarPonto(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.criarPonto(sessaoDe(req).porta, b);
  }

  @Post('pontos-corte/:ponto')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('a correção do ponto de corte com a trilha_auditoria na mesma transação (Executor)')
  alterarPonto(@Param('ponto') ponto: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.alterarPonto(sessaoDe(req).porta, idDaRota(ponto), b);
  }

  @Post('pontos-corte/:ponto/encerrar')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('o encerramento do ponto de corte com a trilha_auditoria na mesma transação (Executor)')
  encerrarPonto(@Param('ponto') ponto: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.encerrarPonto(sessaoDe(req).porta, idDaRota(ponto), b);
  }
}
