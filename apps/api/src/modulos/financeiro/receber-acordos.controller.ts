// F3.8, 07-FIN linha 76: rotas da renegociação de títulos a receber e da baixa pelo demonstrativo de pagamento.
//   GET  /api/financeiro/receber/acordos                               acordos do estabelecimento (lista)
//   GET  /api/financeiro/receber/acordos/devedores?tipo=&busca=        devedores com saldo renegociável
//   GET  /api/financeiro/receber/acordos/titulos-abertos?tipo=&devedor= todos os títulos em aberto do devedor,
//                                                                      com o saldo real das parcelas
//   GET  /api/financeiro/receber/acordos/:id                           parcelas que entraram e parcelas novas
//   POST /api/financeiro/receber/acordos                               { titulos, juros, multa, desconto,
//                                                                        quantidadeParcelas, primeiroVencimento }
//   POST /api/financeiro/receber/acordos/:id/desfazer                  { motivo }
//   GET  /api/financeiro/receber/demonstrativos-importados             demonstrativos da operadora e se já baixados
//   GET  /api/financeiro/receber/demonstrativos-importados/:id/previa  o que cada título receberia (sem gravar)
//   POST /api/financeiro/receber/demonstrativos-importados/:id/baixa   { conta, dataRecebimento }
//   POST /api/financeiro/receber/demonstrativos-importados/:id/desfazer-baixa  { motivo }
//   POST /api/financeiro/receber/pagamentos-tiss/:id/baixa             { conta, dataRecebimento } (demonstrativo de
//        pagamento TISS: líquido, débitos e créditos no recebimento dos títulos das contas casadas)
// A gravação vai pelo executor do núcleo (trilha, outbox e idempotência na mesma transação); sem núcleo: 503.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import type { ResultadoFinanceiro } from '@sgh/contratos';
import type { Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  demonstrativosImportados,
  esquemaBaixarDemonstrativo,
  esquemaDesfazerBaixaDemonstrativo,
  OPERACOES_BAIXA_DEMONSTRATIVO,
  previaDaBaixa,
} from './baixa-demonstrativo-propria.js';
import {
  esquemaBaixarPagamentoTiss,
  OPERACOES_BAIXA_PAGAMENTO_TISS,
} from './baixa-pagamento-tiss-propria.js';
import { NUCLEO_PERIODO_FINANCEIRO } from './periodo.controller.js';
import {
  acordosDoEstabelecimento,
  detalheDoAcordo,
  devedoresComSaldoAberto,
  esquemaDesfazerRenegociacao,
  esquemaRenegociar,
  letraDevedor,
  OPERACOES_RENEGOCIACAO,
  titulosRenegociaveisDoDevedor,
} from './renegociacao-propria.js';
import { resultadoFin } from './servico.js';

const OPERACOES = {
  ...OPERACOES_RENEGOCIACAO,
  ...OPERACOES_BAIXA_DEMONSTRATIVO,
  ...OPERACOES_BAIXA_PAGAMENTO_TISS,
} as const;
const reais = (v: unknown) =>
  `R$ ${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function idDaRota(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0)
    throw new ErroProblema('entrada-invalida', 400, 'Identificador inválido');
  return n;
}

@Controller('financeiro/receber')
export class ReceberAcordosController {
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
    return this.nucleo
      .lerSomente({ ...s.porta, correlacao: (s.porta.correlacao || 'financeiro').slice(0, 64) }, (l) =>
        fn(l, est),
      )
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
  }

  private async gravar(
    req: RequisicaoAutorizada,
    op: keyof typeof OPERACOES,
    entrada: unknown,
    mensagem: (r: Record<string, unknown>) => string,
  ): Promise<ResultadoFinanceiro> {
    if (!this.executor) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    const s = sessaoDe(req);
    const r = await this.executor
      .executar(OPERACOES[op] as never, s.porta.cliente, entrada, contextoOperacao(s, op))
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
    const res = r.resultado as Record<string, unknown>;
    return resultadoFin(mensagem(res), r.repetida, res);
  }

  // ── Renegociação ──

  @Get('acordos')
  @Permissao('financeiro.tituloReceber.ler')
  acordos(@Req() req: RequisicaoAutorizada) {
    return this.ler(req, (l, est) => acordosDoEstabelecimento(l, est));
  }

  // As duas leituras da escolha por devedor vêm antes de `acordos/:id` (a ordem das rotas decide).
  @Get('acordos/devedores')
  @Permissao('financeiro.tituloReceber.ler')
  devedores(
    @Query('tipo') tipo: string | undefined,
    @Query('busca') busca: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const letra = letraDevedor(tipo);
    if (!letra) throw new ErroProblema('entrada-invalida', 400, 'Tipo de devedor inválido');
    return this.ler(req, (l, est) => devedoresComSaldoAberto(l, est, letra, String(busca ?? '')));
  }

  @Get('acordos/titulos-abertos')
  @Permissao('financeiro.tituloReceber.ler')
  titulosAbertos(
    @Query('tipo') tipo: string | undefined,
    @Query('devedor') devedor: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const letra = letraDevedor(tipo);
    if (!letra) throw new ErroProblema('entrada-invalida', 400, 'Tipo de devedor inválido');
    const n = idDaRota(String(devedor ?? ''));
    return this.ler(req, (l, est) => titulosRenegociaveisDoDevedor(l, est, letra, n));
  }

  @Get('acordos/:id')
  @Permissao('financeiro.tituloReceber.ler')
  async acordo(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(id);
    const d = await this.ler(req, (l, est) => detalheDoAcordo(l, est, n));
    if (!d) throw new ErroProblema('nao-encontrado', 404, 'Acordo não encontrado');
    return d;
  }

  @Post('acordos')
  @HttpCode(200)
  @Permissao('financeiro.tituloReceber.criar')
  @AuditadoNoHandler('financeiro.renegociar_titulos_receber pelo executor (trilha na mesma transação)')
  renegociar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.renegociarTitulosReceber',
      corpo(esquemaRenegociar, b),
      (r) =>
        `Acordo ${String(r['numero'])} gravado: ${reais(r['valorRenegociado'])} em ${String(r['parcelas'])} parcela(s), no título ${String(r['numeroTitulo'])}. Os títulos originais ficam no histórico como renegociados.`,
    );
  }

  @Post('acordos/:id/desfazer')
  @HttpCode(200)
  @Permissao('financeiro.tituloReceber.criar')
  @AuditadoNoHandler('financeiro.desfazer_renegociacao_receber pelo executor (trilha na mesma transação)')
  desfazer(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.desfazerRenegociacaoReceber',
      corpo(esquemaDesfazerRenegociacao, { ...((b ?? {}) as object), renegociacao: idDaRota(id) }),
      (r) =>
        `Acordo ${String(r['numero'])} desfeito: os títulos originais voltaram a ficar em aberto e o título do acordo ficou cancelado, no histórico.`,
    );
  }

  // ── Baixa pelo demonstrativo de pagamento ──

  @Get('demonstrativos-importados')
  @Permissao('financeiro.tituloReceber.ler')
  demonstrativos(@Req() req: RequisicaoAutorizada) {
    return this.ler(req, (l, est) => demonstrativosImportados(l, est));
  }

  @Get('demonstrativos-importados/:id/previa')
  @Permissao('financeiro.tituloReceber.ler')
  previa(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(id);
    return this.ler(req, (l, est) => previaDaBaixa(l, est, n));
  }

  @Post('demonstrativos-importados/:id/baixa')
  @HttpCode(200)
  @Permissao('financeiro.tituloReceber.baixar')
  @AuditadoNoHandler('financeiro.baixar_demonstrativo_pagamento pelo executor (trilha na mesma transação)')
  baixar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.baixarDemonstrativoPagamento',
      corpo(esquemaBaixarDemonstrativo, { ...((b ?? {}) as object), demonstrativo: idDaRota(id) }),
      (r) =>
        `Demonstrativo ${String(r['numero'])} baixado: ${reais(r['recebido'])} em ${String(r['titulos'])} título(s), ${String(r['itens'])} item(ns); ${reais(r['glosa'])} de glosa fica em aberto nos títulos.`,
    );
  }

  @Post('pagamentos-tiss/:id/baixa')
  @HttpCode(200)
  @Permissao('financeiro.tituloReceber.baixar')
  @AuditadoNoHandler('financeiro.baixar_pagamento_tiss pelo executor (trilha na mesma transação)')
  baixarPagamentoTiss(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.baixarPagamentoTiss',
      corpo(esquemaBaixarPagamentoTiss, { ...((b ?? {}) as object), demonstrativo: idDaRota(id) }),
      (r) =>
        `Pagamento ${String(r['numero'])} baixado: ${reais(r['liquido'])} líquido na conta, ${reais(r['recebido'])} em ${String(r['titulos'])} título(s), ${reais(r['retencao'])} de débitos e ${reais(r['acrescimo'])} de créditos.`,
    );
  }

  @Post('demonstrativos-importados/:id/desfazer-baixa')
  @HttpCode(200)
  @Permissao('financeiro.tituloReceber.baixar')
  @AuditadoNoHandler('financeiro.desfazer_baixa_demonstrativo pelo executor (trilha na mesma transação)')
  desfazerBaixa(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.desfazerBaixaDemonstrativo',
      corpo(esquemaDesfazerBaixaDemonstrativo, { ...((b ?? {}) as object), demonstrativo: idDaRota(id) }),
      (r) =>
        `Baixa do demonstrativo ${String(r['numero'])} desfeita: ${String(r['recebimentos'])} recebimento(s) estornado(s), ${reais(r['estornado'])} devolvido(s) ao saldo de ${String(r['titulos'])} título(s) e debitado(s) da conta. O demonstrativo pode ser baixado de novo.`,
    );
  }
}
