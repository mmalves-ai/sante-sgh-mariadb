// Orçamento de exames particulares e conversão em atendimento (F3.5, 05-SADT linha 26), no banco do cliente:
//   POST /api/sadt/orcamentos-exames/previa              o preço da tabela, o total e a recusa na hora (nada gravado)
//   POST /api/sadt/orcamentos-exames                     grava o orçamento emitido com os itens de exame
//   GET  /api/sadt/orcamentos-exames/:id/atendimentos    os atendimentos do paciente do orçamento, para a conversão
//   POST /api/sadt/orcamentos-exames/:id/converter       abre o pedido no atendimento e marca o orçamento realizado
// A lista segue em GET /api/sadt/orcamentos. Tudo ligado para todos: o que cada cargo faz vem só da permissão da rota.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  esquemaConversaoOrcamento,
  esquemaOrcamentoExames,
  type ServicoOrcamentoSadt,
} from './aplicacao/orcamento-propria.js';

export const SERVICO_ORCAMENTO_SADT = Symbol('SERVICO_ORCAMENTO_SADT');

@Controller('sadt/orcamentos-exames')
export class OrcamentoExamesController {
  constructor(@Inject(SERVICO_ORCAMENTO_SADT) private readonly servico: ServicoOrcamentoSadt | null) {}

  private get s(): ServicoOrcamentoSadt {
    if (!this.servico)
      throw new ErroProblema('indisponivel', 503, 'O orçamento de exames precisa do banco do cliente.');
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

  @Get(':id/atendimentos')
  @Permissao('sadt.orcamento.ler')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  async atendimentos(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    return { itens: await this.s.atendimentos(sessaoDe(req).porta, idDaRota(id)) };
  }

  @Post(':id/converter')
  @HttpCode(200)
  @Permissao('sadt.orcamento.converter')
  @AuditadoNoHandler('o pedido, os itens e o orçamento realizado com a trilha_auditoria na mesma transação')
  converter(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.converter(sessaoDe(req).porta, idDaRota(id), corpo(esquemaConversaoOrcamento, b));
  }
}
