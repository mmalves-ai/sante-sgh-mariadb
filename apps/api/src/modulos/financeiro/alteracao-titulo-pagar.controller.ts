// F3.8, 07-FIN linha 63: rota da alteração do título a pagar não pago.
//   POST /api/financeiro/pagar/alteracao/titulos/:id   { versao, credor?, documento?, serie?, emissao?, valorDocumento?,
//                                                        centroCusto?, referente?, observacao?, parcelas?, retencoes?,
//                                                        justificativa? }
// A permissão é a de lançar o título (financeiro.tituloPagar.criar, a mesma de incluir e excluir). A gravação vai pelo
// executor do núcleo (trilha com o antes e o depois, outbox e idempotência na mesma transação); sem núcleo: 503.
import { Body, Controller, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import type { ResultadoFinanceiro } from '@sgh/contratos';
import type { Executor, NucleoProprio } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { OPERACOES_ALTERACAO_TITULO_PAGAR } from './alteracao-titulo-pagar-propria.js';
import { NUCLEO_PERIODO_FINANCEIRO } from './periodo.controller.js';
import { resultadoFin } from './servico.js';

const objeto = (b: unknown): Record<string, unknown> =>
  b !== null && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};

@Controller('financeiro/pagar/alteracao')
export class AlteracaoTituloPagarController {
  private readonly executor: Executor | null;

  constructor(@Optional() @Inject(NUCLEO_PERIODO_FINANCEIRO) nucleo: NucleoProprio | null = null) {
    this.executor = nucleo ? nucleo.criarExecutor() : null;
  }

  @Post('titulos/:id')
  @HttpCode(200)
  @Permissao('financeiro.tituloPagar.criar')
  @AuditadoNoHandler(
    'alteração do título a pagar pelo executor, com o antes e o depois na trilha da mesma transação',
  )
  async alterar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFinanceiro> {
    if (!this.executor) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    const titulo = Number(id);
    if (!Number.isInteger(titulo) || titulo <= 0)
      throw new ErroProblema('entrada-invalida', 400, 'Título inválido');
    const s = sessaoDe(req);
    const op = OPERACOES_ALTERACAO_TITULO_PAGAR.alterarTituloPagar;
    const r = await this.executor
      .executar(op as never, s.porta.cliente, { ...objeto(b), titulo }, contextoOperacao(s, op.nome))
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
    const res = r.resultado as Record<string, unknown>;
    const canceladas = Number(res['aprovacoesCanceladas'] ?? 0);
    const msg = res['reabreAlcada']
      ? canceladas > 0
        ? `Título alterado; ${canceladas} pedido(s) de aprovação cancelado(s): o título volta à alçada.`
        : 'Título alterado; a aprovação recomeça pela alçada.'
      : 'Título alterado; as aprovações continuam valendo.';
    return resultadoFin(msg, r.repetida, {
      titulo: res['titulo'],
      campos: res['campos'],
      reabreAlcada: res['reabreAlcada'],
    });
  }
}
