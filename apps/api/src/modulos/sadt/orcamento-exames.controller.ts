// Orçamento de exames particulares e conversão em atendimento (F3.5, 05-SADT linha 26), no banco do cliente:
//   POST /api/sadt/orcamentos-exames/previa              o preço da tabela, o total e a recusa na hora (nada gravado)
//   POST /api/sadt/orcamentos-exames                     grava o orçamento emitido com os itens de exame
//   GET  /api/sadt/orcamentos-exames/apoio               todos os exames do diagnóstico e só as fontes particulares
//   GET  /api/sadt/orcamentos-exames/:id/atendimentos    os atendimentos do paciente (?paciente= quando o orçamento não tem)
//   POST /api/sadt/orcamentos-exames/:id/avaliar         o paciente à vista e os avisos das restrições (nada gravado)
//   POST /api/sadt/orcamentos-exames/:id/converter       abre o pedido, lança os valores aprovados na conta e marca o
//                                                        orçamento realizado (exceção nova só com
//                                                        sadt.requisicao.autorizarExcecao)
// A lista segue em GET /api/sadt/orcamentos. Tudo ligado para todos: o que cada cargo faz vem só da permissão da rota.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { pode } from '@sgh/dominio-acesso';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { semBancoDoCliente } from './sem-banco-cliente.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  esquemaConversaoOrcamento,
  esquemaOrcamentoExames,
  type ServicoOrcamentoSadt,
} from './aplicacao/orcamento-propria.js';

export const SERVICO_ORCAMENTO_SADT = Symbol('SERVICO_ORCAMENTO_SADT');

/** Quem converte pode autorizar a exceção à restrição do exame (a mesma permissão do pedido). */
const autorizaExcecao = (req: RequisicaoAutorizada) =>
  !!req.sgh && pode(req.sgh.ability, 'sadt.requisicao.autorizarExcecao');

@Controller('sadt/orcamentos-exames')
export class OrcamentoExamesController {
  constructor(@Inject(SERVICO_ORCAMENTO_SADT) private readonly servico: ServicoOrcamentoSadt | null) {}

  private get s(): ServicoOrcamentoSadt {
    if (!this.servico) throw semBancoDoCliente('O orçamento de exames precisa do banco do cliente.');
    return this.servico;
  }

  @Post('previa')
  @HttpCode(200)
  @Permissao('sadt.orcamento.ler')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  previa(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.previa(sessaoDe(req).porta, corpo(esquemaOrcamentoExames, b));
  }

  @Post()
  @Permissao('sadt.orcamento.criar')
  @AuditadoNoHandler('o orçamento e os itens com a trilha_auditoria na mesma transação')
  criar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.criar(sessaoDe(req).porta, corpo(esquemaOrcamentoExames, b));
  }

  @Get('apoio')
  @Permissao('sadt.orcamento.ler')
  apoio(@Req() req: RequisicaoAutorizada) {
    return this.s.apoio(sessaoDe(req).porta);
  }

  @Get(':id/atendimentos')
  @Permissao('sadt.orcamento.ler')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  async atendimentos(
    @Param('id') id: string,
    @Query('paciente') paciente: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const p = paciente ? idDaRota(paciente) : null;
    return { itens: await this.s.atendimentos(sessaoDe(req).porta, idDaRota(id), p) };
  }

  @Post(':id/avaliar')
  @HttpCode(200)
  @Permissao('sadt.orcamento.converter')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  avaliar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.avaliarConversao(
      sessaoDe(req).porta,
      idDaRota(id),
      corpo(esquemaConversaoOrcamento, b),
      autorizaExcecao(req),
    );
  }

  @Post(':id/converter')
  @HttpCode(200)
  @Permissao('sadt.orcamento.converter')
  @AuditadoNoHandler('o pedido, os itens e o orçamento realizado com a trilha_auditoria na mesma transação')
  converter(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.converter(
      sessaoDe(req).porta,
      idDaRota(id),
      corpo(esquemaConversaoOrcamento, b),
      autorizaExcecao(req),
    );
  }
}
