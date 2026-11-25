// F8, 07-FIN linhas 70 e 79: rotas da nota de crédito e de débito e do portador com desconto e cessão de recebíveis.
//   GET  /api/financeiro/nota-cessao/apoios                       motivos, motivos de cancelamento, tributos, contas, pessoas
//   GET  /api/financeiro/nota-cessao/parcelas?lado=&busca=        parcelas em aberto a pagar ou a receber
//   GET  /api/financeiro/nota-cessao/notas                        notas do estabelecimento
//   POST /api/financeiro/nota-cessao/notas/pagar                  nota sobre parcela a pagar (fornecedor)
//   POST /api/financeiro/nota-cessao/notas/receber                nota sobre parcela a receber (cliente ou fonte pagadora)
//   POST /api/financeiro/nota-cessao/notas/aplicar                { nota }
//   POST /api/financeiro/nota-cessao/notas/cancelar               { nota, motivoCancelamento, observacao }
//   GET  /api/financeiro/nota-cessao/portadores?data=             portadores com a condição vigente e o limite usado
//   POST /api/financeiro/nota-cessao/portadores                   portador e condição por vigência
//   GET  /api/financeiro/nota-cessao/operacoes                    operações de desconto e cessão com os itens
//   POST /api/financeiro/nota-cessao/operacoes                    contratar
//   POST /api/financeiro/nota-cessao/operacoes/desfecho           { item, acao: liquidar | recomprar, data }
//   POST /api/financeiro/nota-cessao/operacoes/cancelar           { operacao, motivo }
// Permissões próprias (recurso novo, concedidas ao administrador do sistema e dadas pelo cargo): notaCreditoDebito.ler,
// .emitir (emitir e aplicar) e .cancelar; cessaoRecebivel.ler, .contratar e .desfecho (liquidar, recomprar, cancelar).
// O portador é cadastro do financeiro (financeiro.parametro.editar).
// A gravação vai pelo executor do núcleo (trilha, outbox e idempotência na mesma transação); sem núcleo: 503.
import { Body, Controller, Get, HttpCode, Inject, Optional, Post, Query, Req } from '@nestjs/common';
import type { ResultadoFinanceiro } from '@sgh/contratos';
import type { Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao, PermissaoOu } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  apoiosNotaCessao,
  notasDoEstabelecimento,
  OPERACOES_NOTA_CESSAO,
  operacoesCessao,
  parcelasEmAberto,
  portadoresDoEstabelecimento,
} from './nota-cessao-propria.js';
import { NUCLEO_PERIODO_FINANCEIRO } from './periodo.controller.js';
import { resultadoFin } from './servico.js';

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const objeto = (b: unknown): Record<string, unknown> =>
  b !== null && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};

@Controller('financeiro/nota-cessao')
export class NotaCessaoController {
  private readonly executor: Executor | null;

  constructor(
    @Optional() @Inject(NUCLEO_PERIODO_FINANCEIRO) private readonly nucleo: NucleoProprio | null = null,
  ) {
    this.executor = nucleo ? nucleo.criarExecutor() : null;
  }

  private ler<T>(req: RequisicaoAutorizada, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const s = sessaoDe(req);
    const est = s.porta.estabelecimento;
    if (!this.nucleo) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    if (est === null) throw new ErroProblema('entrada-invalida', 409, 'Escolha o estabelecimento da sessão');
    return this.nucleo.lerSomente(
      { ...s.porta, correlacao: (s.porta.correlacao || 'financeiro').slice(0, 64) },
      (l) => fn(l, est),
    );
  }

  private async gravar(
    req: RequisicaoAutorizada,
    op: keyof typeof OPERACOES_NOTA_CESSAO,
    entrada: unknown,
    mensagem: (r: Record<string, unknown>) => string,
  ): Promise<ResultadoFinanceiro> {
    if (!this.executor) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    const s = sessaoDe(req);
    const nome = OPERACOES_NOTA_CESSAO[op].nome;
    const r = await this.executor
      .executar(OPERACOES_NOTA_CESSAO[op] as never, s.porta.cliente, entrada, contextoOperacao(s, nome))
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
    const res = r.resultado as Record<string, unknown>;
    return resultadoFin(mensagem(res), r.repetida, res);
  }

  @Get('apoios')
  @Permissao('financeiro.notaCreditoDebito.ler')
  @PermissaoOu('financeiro.cessaoRecebivel.ler')
  apoios(@Req() req: RequisicaoAutorizada) {
    return this.ler(req, (l, est) => apoiosNotaCessao(l, est));
  }

  @Get('parcelas')
  @Permissao('financeiro.notaCreditoDebito.ler')
  @PermissaoOu('financeiro.cessaoRecebivel.ler')
  parcelas(
    @Query('lado') lado: string | undefined,
    @Query('busca') busca: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    if (lado !== 'pagar' && lado !== 'receber')
      throw new ErroProblema('entrada-invalida', 400, 'Lado inválido');
    const b = busca?.trim().slice(0, 60) || null;
    return this.ler(req, (l, est) => parcelasEmAberto(l, est, lado, b));
  }

  @Get('notas')
  @Permissao('financeiro.notaCreditoDebito.ler')
  notas(@Req() req: RequisicaoAutorizada) {
    return this.ler(req, (l, est) => notasDoEstabelecimento(l, est));
  }

  private emitir(req: RequisicaoAutorizada, lado: 'pagar' | 'receber', b: unknown) {
    return this.gravar(req, 'emitirNota', { ...objeto(b), lado }, (r) =>
      r['situacao'] === 'aplicada'
        ? `Nota ${String(r['numero'])} emitida e aplicada: ${r['efeito'] === 'abate' ? 'abateu' : 'acresceu'} ${Number(r['valorAjuste']).toFixed(2)} na parcela.`
        : `Nota ${String(r['numero'])} emitida; aplique-a quando confirmar.`,
    );
  }

  @Post('notas/pagar')
  @HttpCode(200)
  @Permissao('financeiro.notaCreditoDebito.emitir')
  @AuditadoNoHandler(
    'nota de crédito ou débito do fornecedor gravada pelo executor, com a trilha na mesma transação',
  )
  notaPagar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.emitir(req, 'pagar', b);
  }

  @Post('notas/receber')
  @HttpCode(200)
  @Permissao('financeiro.notaCreditoDebito.emitir')
  @AuditadoNoHandler(
    'nota de crédito ou débito do cliente gravada pelo executor, com a trilha na mesma transação',
  )
  notaReceber(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.emitir(req, 'receber', b);
  }

  @Post('notas/aplicar')
  @HttpCode(200)
  @Permissao('financeiro.notaCreditoDebito.emitir')
  @AuditadoNoHandler('aplicação da nota ao título pelo executor, com a trilha na mesma transação')
  aplicar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(req, 'aplicarNota', b, () => 'Nota aplicada ao título.');
  }

  @Post('notas/cancelar')
  @HttpCode(200)
  @Permissao('financeiro.notaCreditoDebito.cancelar')
  @AuditadoNoHandler('cancelamento da nota com motivo pelo executor, com a trilha na mesma transação')
  cancelar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(req, 'cancelarNota', b, (r) =>
      r['desfeito'] ? 'Nota cancelada; o ajuste no título foi desfeito.' : 'Nota cancelada.',
    );
  }

  @Get('portadores')
  @Permissao('financeiro.cessaoRecebivel.ler')
  portadores(@Query('data') data: string | undefined, @Req() req: RequisicaoAutorizada) {
    const d = data && DATA.test(data) ? data : new Date().toISOString().slice(0, 10);
    return this.ler(req, (l, est) => portadoresDoEstabelecimento(l, est, d));
  }

  @Post('portadores')
  @HttpCode(200)
  @Permissao('financeiro.parametro.editar')
  @AuditadoNoHandler('portador e condição gravados pelo executor, com a trilha na mesma transação')
  portador(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(req, 'manterPortador', b, () => 'Portador gravado.');
  }

  @Get('operacoes')
  @Permissao('financeiro.cessaoRecebivel.ler')
  operacoes(@Req() req: RequisicaoAutorizada) {
    return this.ler(req, (l, est) => operacoesCessao(l, est));
  }

  @Post('operacoes')
  @HttpCode(200)
  @Permissao('financeiro.cessaoRecebivel.contratar')
  @AuditadoNoHandler('operação de desconto ou cessão gravada pelo executor, com a trilha na mesma transação')
  contratar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'contratarCessao',
      b,
      (r) => `Operação ${String(r['numero'])} contratada: líquido ${Number(r['valorLiquido']).toFixed(2)}.`,
    );
  }

  @Post('operacoes/desfecho')
  @HttpCode(200)
  @Permissao('financeiro.cessaoRecebivel.desfecho')
  @AuditadoNoHandler('desfecho do recebível cedido pelo executor, com a trilha na mesma transação')
  desfecho(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(req, 'desfechoCessao', b, (r) =>
      r['situacao'] === 'recomprada'
        ? 'Recebível recomprado: a parcela voltou à carteira.'
        : 'Recebível liquidado pelo sacado.',
    );
  }

  @Post('operacoes/cancelar')
  @HttpCode(200)
  @Permissao('financeiro.cessaoRecebivel.desfecho')
  @AuditadoNoHandler('cancelamento da operação com motivo pelo executor, com a trilha na mesma transação')
  cancelarOperacao(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'cancelarCessao',
      b,
      (r) => `Operação cancelada; ${String(r['devolvidas'])} parcela(s) devolvida(s).`,
    );
  }
}
