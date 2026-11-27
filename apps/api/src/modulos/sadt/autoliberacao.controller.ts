// Autoliberação do resultado e checagens de consistência (F8, 05-SADT linha 11). A avaliação roda na digitação
// (POST /api/sadt/exames-pedidos/:exame/resultado); aqui ficam a fila de conferência e o cadastro.
//   GET  /api/sadt/autoliberacao/fila                    retidos para a conferência do responsável técnico
//   GET  /api/sadt/autoliberacao                         regras com condições, limites de delta, interferentes
//   GET  /api/sadt/autoliberacao/principios?busca=       medicamento interferente pelo princípio ativo
//   GET  /api/sadt/autoliberacao/amostra?exame=          condições da amostra do exame, para a digitação apontar
//   POST /api/sadt/autoliberacao/regras                  inclui uma regra (condições conferidas pelo domínio)
//   POST /api/sadt/autoliberacao/limites-delta           inclui um limite de delta do estabelecimento
//   POST /api/sadt/autoliberacao/interferentes           inclui uma substância interferente
//   POST /api/sadt/autoliberacao/:tipo/:id/desativar     desativa (nunca apaga)
// A fila: `sadt.resultado.ler` (a liberação do retido é a rota de liberar, `sadt.resultado.liberar`). O cadastro:
// `sadt.catalogo.ler` e `sadt.catalogo.editar`.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { semBancoDoCliente } from './sem-banco-cliente.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  esquemaInterferente,
  esquemaLimiteDelta,
  esquemaRegraAutoliberacao,
  type ServicoAutoliberacao,
  TIPOS_CADASTRO_AUTOLIBERACAO,
  type TipoCadastroAutoliberacao,
} from './aplicacao/autoliberacao-propria.js';

export const SERVICO_AUTOLIBERACAO = Symbol('SERVICO_AUTOLIBERACAO');

@Controller('sadt/autoliberacao')
export class AutoliberacaoController {
  constructor(@Inject(SERVICO_AUTOLIBERACAO) private readonly servico: ServicoAutoliberacao | null) {}

  private get s(): ServicoAutoliberacao {
    if (!this.servico) throw semBancoDoCliente('A autoliberação do resultado precisa do banco do cliente.');
    return this.servico;
  }

  @Get('fila')
  @Permissao('sadt.resultado.ler')
  fila(@Req() req: RequisicaoAutorizada) {
    return this.s.fila(sessaoDe(req).porta);
  }

  @Get()
  @Permissao('sadt.catalogo.ler')
  listar(@Req() req: RequisicaoAutorizada) {
    return this.s.listar(sessaoDe(req).porta);
  }

  /** As condições da amostra que a bancada pode apontar na digitação do exame (catálogo do exame). */
  @Get('amostra')
  @Permissao('sadt.resultado.ler')
  amostra(@Query('exame') exame: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.s.interferentesDaAmostra(sessaoDe(req).porta, idDaRota(String(exame ?? '')));
  }

  @Get('principios')
  @Permissao('sadt.catalogo.ler')
  principios(@Query('busca') busca: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.s.principios(sessaoDe(req).porta, String(busca ?? '').slice(0, 100));
  }

  @Post('regras')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('a regra e as condições com a trilha_auditoria na mesma transação (Executor)')
  regra(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.incluirRegra(sessaoDe(req).porta, corpo(esquemaRegraAutoliberacao, b));
  }

  @Post('limites-delta')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('o limite de delta com a trilha_auditoria na mesma transação (Executor)')
  limiteDelta(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.incluirLimiteDelta(sessaoDe(req).porta, corpo(esquemaLimiteDelta, b));
  }

  @Post('interferentes')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('a substância interferente com a trilha_auditoria na mesma transação (Executor)')
  interferente(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.incluirInterferente(sessaoDe(req).porta, corpo(esquemaInterferente, b));
  }

  @Post(':tipo/:id/desativar')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('a desativação com a trilha_auditoria na mesma transação (Executor)')
  desativar(@Param('tipo') tipo: string, @Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    if (!(tipo in TIPOS_CADASTRO_AUTOLIBERACAO))
      throw new ErroProblema('nao-encontrado', 404, 'Registro não encontrado');
    return this.s.desativar(sessaoDe(req).porta, tipo as TipoCadastroAutoliberacao, idDaRota(id));
  }
}
