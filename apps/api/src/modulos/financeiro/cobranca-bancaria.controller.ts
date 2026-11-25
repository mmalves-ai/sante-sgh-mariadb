// F7, 07-FIN linha 78: rotas da cobrança bancária com boleto.
//   GET  /api/financeiro/cobranca-bancaria/carteiras                       carteiras das contas do escopo
//   POST /api/financeiro/cobranca-bancaria/carteiras                       { acao: incluir | desativar, ... }
//   GET  /api/financeiro/cobranca-bancaria/parcelas?busca=                 parcelas em aberto que podem ganhar boleto
//   GET  /api/financeiro/cobranca-bancaria/boletos?carteira=&situacao=&busca=
//   POST /api/financeiro/cobranca-bancaria/boletos                         { carteira, parcelas, pagadorDocumento?, pagadorNome? }
//   POST /api/financeiro/cobranca-bancaria/boletos/cancelar                { boleto, motivo }
//   GET  /api/financeiro/cobranca-bancaria/boletos/impressao?boleto=       dados do boleto para imprimir ou salvar em PDF
//   GET  /api/financeiro/cobranca-bancaria/remessas?carteira=
//   POST /api/financeiro/cobranca-bancaria/remessas                        { carteira, mensagem? }
//   GET  /api/financeiro/cobranca-bancaria/remessas/arquivo?remessa=       o arquivo CNAB 240 da remessa
//   GET  /api/financeiro/cobranca-bancaria/retornos?carteira=
//   POST /api/financeiro/cobranca-bancaria/retornos                        { carteira, nomeArquivo, conteudo }
//   GET  /api/financeiro/cobranca-bancaria/retorno-simulado?carteira=      o retorno do simulador (fora de produção)
// A gravação vai pelo executor do @sgh/nucleo (trilha, outbox e idempotência na mesma transação; a permissão é a da
// rota); a leitura, direto no banco do cliente (sem núcleo: 503, falha fechada).
import { Body, Controller, Get, HttpCode, Inject, Optional, Post, Query, Req } from '@nestjs/common';
import type { ResultadoFinanceiro } from '@sgh/contratos';
import type { Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { corpo, inteiroOuNulo } from '../exames/public-api.js';
import {
  arquivoDaRemessaCobranca,
  boletoParaImpressao,
  boletosCobranca,
  carteirasCobranca,
  esquemaCancelarBoleto,
  esquemaCarteira,
  esquemaEmitirBoletos,
  esquemaGerarRemessaCobranca,
  esquemaProcessarRetornoCobranca,
  OPERACOES_COBRANCA_BANCARIA,
  parcelasParaBoleto,
  remessasCobranca,
  retornoCobrancaSimulado,
  retornosCobranca,
} from './cobranca-bancaria-propria.js';
import { contasDoEscopo } from './operacoes.js';
import { NUCLEO_PERIODO_FINANCEIRO } from './periodo.controller.js';
import { resultadoFin } from './servico.js';

const SITUACOES = new Set([
  'emitido',
  'registrado',
  'rejeitado',
  'pago',
  'baixado',
  'cancelado',
  'protestado',
]);
const reais = (v: unknown) =>
  Number(v ?? 0)
    .toFixed(2)
    .replace('.', ',');

@Controller('financeiro/cobranca-bancaria')
export class CobrancaBancariaController {
  private readonly executor: Executor | null;
  private readonly ambiente: string;

  constructor(
    @Optional() @Inject(NUCLEO_PERIODO_FINANCEIRO) private readonly nucleo: NucleoProprio | null = null,
  ) {
    this.ambiente = (process.env['AMBIENTE'] ?? 'dev').trim() || 'dev';
    this.executor = nucleo ? nucleo.criarExecutor() : null;
  }

  private ler<T>(
    req: RequisicaoAutorizada,
    fn: (l: Leitor, est: number, contas: number[]) => Promise<T>,
  ): Promise<T> {
    const s = sessaoDe(req);
    const est = s.porta.estabelecimento;
    if (!this.nucleo) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    if (est === null) throw new ErroProblema('entrada-invalida', 409, 'Escolha o estabelecimento da sessão');
    return this.nucleo.lerSomente(
      { ...s.porta, correlacao: (s.porta.correlacao || 'financeiro').slice(0, 64) },
      async (l) => fn(l, est, await contasDoEscopo(l, est, s.porta.usuario ?? null, 'consultar')),
    );
  }

  private async gravar(
    req: RequisicaoAutorizada,
    op: keyof typeof OPERACOES_COBRANCA_BANCARIA,
    entrada: unknown,
    mensagem: (r: Record<string, unknown>) => string,
  ): Promise<ResultadoFinanceiro> {
    if (!this.executor) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    const s = sessaoDe(req);
    const r = await this.executor
      .executar(OPERACOES_COBRANCA_BANCARIA[op] as never, s.porta.cliente, entrada, contextoOperacao(s, op))
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
    const res = r.resultado as Record<string, unknown>;
    return resultadoFin(mensagem(res), r.repetida, res);
  }

  private exigir(v: string | undefined, nome: string): number {
    const n = inteiroOuNulo(v);
    if (!n)
      throw new ErroProblema('entrada-invalida', 400, `${nome} inválida`, `Escolha a ${nome.toLowerCase()}.`);
    return n;
  }

  /** A carteira tem de ser de uma conta do escopo de consulta de quem lê (regra 15). */
  private async exigirCarteiraDoEscopo(l: Leitor, est: number, contas: number[], carteira: number) {
    const c = await l.uma(
      'SELECT conta_bancaria_id FROM carteira_cobranca WHERE id = ? AND estabelecimento_id = ?',
      [carteira, est],
    );
    if (!c || !contas.includes(Number(c['conta_bancaria_id'])))
      throw new ErroProblema('nao-encontrado', 404, 'Carteira não encontrada');
  }

  @Get('carteiras')
  @Permissao('financeiro.cobrancaBancaria.ler')
  carteiras(@Req() req: RequisicaoAutorizada) {
    return this.ler(req, (l, est, contas) => carteirasCobranca(l, est, contas));
  }

  @Post('carteiras')
  @HttpCode(200)
  @Permissao('financeiro.cobrancaBancaria.configurar')
  @AuditadoNoHandler('financeiro.manterCarteiraCobranca pelo executor (trilha na mesma transação)')
  manterCarteira(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    const e = corpo(esquemaCarteira, b);
    return this.gravar(req, 'financeiro.manterCarteiraCobranca', e, () =>
      e.acao === 'incluir'
        ? 'Carteira de cobrança cadastrada.'
        : 'Carteira desativada (o histórico continua).',
    );
  }

  @Get('parcelas')
  @Permissao('financeiro.cobrancaBancaria.ler')
  parcelas(@Query('busca') busca: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.ler(req, (l, est) => parcelasParaBoleto(l, est, (busca ?? '').slice(0, 100)));
  }

  @Get('boletos')
  @Permissao('financeiro.cobrancaBancaria.ler')
  boletos(
    @Query('carteira') carteira: string | undefined,
    @Query('situacao') situacao: string | undefined,
    @Query('busca') busca: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const filtro = {
      carteira: inteiroOuNulo(carteira),
      situacao: situacao && SITUACOES.has(situacao) ? situacao : null,
      busca: (busca ?? '').slice(0, 100),
    };
    return this.ler(req, (l, est, contas) => boletosCobranca(l, est, contas, filtro));
  }

  @Post('boletos')
  @HttpCode(200)
  @Permissao('financeiro.cobrancaBancaria.emitir')
  @AuditadoNoHandler('financeiro.emitirBoletos pelo executor (trilha na mesma transação)')
  emitir(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.emitirBoletos',
      corpo(esquemaEmitirBoletos, b),
      (r) => `${Number(r['quantidade'])} boleto(s) emitido(s), total de R$ ${reais(r['total'])}.`,
    );
  }

  @Post('boletos/cancelar')
  @HttpCode(200)
  @Permissao('financeiro.cobrancaBancaria.emitir')
  @AuditadoNoHandler('financeiro.cancelarBoleto pelo executor (trilha na mesma transação)')
  cancelar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(req, 'financeiro.cancelarBoleto', corpo(esquemaCancelarBoleto, b), (r) =>
      r['baixaNoBanco']
        ? 'Boleto cancelado. A próxima remessa leva o pedido de baixa ao banco.'
        : 'Boleto cancelado. A parcela pode receber outro boleto.',
    );
  }

  @Get('boletos/impressao')
  @Permissao('financeiro.cobrancaBancaria.ler')
  async impressao(@Query('boleto') boleto: string | undefined, @Req() req: RequisicaoAutorizada) {
    const n = this.exigir(boleto, 'Boleto');
    const r = await this.ler(req, (l, est, contas) => boletoParaImpressao(l, est, contas, n));
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Boleto não encontrado');
    return r;
  }

  @Get('remessas')
  @Permissao('financeiro.cobrancaBancaria.ler')
  remessas(@Query('carteira') carteira: string | undefined, @Req() req: RequisicaoAutorizada) {
    const n = this.exigir(carteira, 'Carteira');
    return this.ler(req, async (l, est, contas) => {
      await this.exigirCarteiraDoEscopo(l, est, contas, n);
      return remessasCobranca(l, est, n);
    });
  }

  @Post('remessas')
  @HttpCode(200)
  @Permissao('financeiro.cobrancaBancaria.emitir')
  @AuditadoNoHandler('financeiro.gerarRemessaCobranca pelo executor (trilha na mesma transação)')
  gerarRemessa(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.gerarRemessaCobranca',
      corpo(esquemaGerarRemessaCobranca, b),
      (r) =>
        `Remessa ${Number(r['sequencia'])} gerada: ${Number(r['registros'])} registro(s) e ${Number(r['baixas'])} ` +
        `pedido(s) de baixa, total de R$ ${reais(r['total'])}.`,
    );
  }

  @Get('remessas/arquivo')
  @Permissao('financeiro.cobrancaBancaria.ler')
  async arquivoRemessa(@Query('remessa') remessa: string | undefined, @Req() req: RequisicaoAutorizada) {
    const n = this.exigir(remessa, 'Remessa');
    const r = await this.ler(req, async (l, est, contas) => {
      const c = await l.uma(
        'SELECT carteira_cobranca_id FROM remessa_cobranca WHERE id = ? AND estabelecimento_id = ?',
        [n, est],
      );
      if (!c) return null;
      await this.exigirCarteiraDoEscopo(l, est, contas, Number(c['carteira_cobranca_id']));
      return arquivoDaRemessaCobranca(l, est, n);
    });
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Remessa não encontrada');
    return r;
  }

  @Get('retornos')
  @Permissao('financeiro.cobrancaBancaria.ler')
  retornos(@Query('carteira') carteira: string | undefined, @Req() req: RequisicaoAutorizada) {
    const n = this.exigir(carteira, 'Carteira');
    return this.ler(req, async (l, est, contas) => {
      await this.exigirCarteiraDoEscopo(l, est, contas, n);
      return retornosCobranca(l, est, n);
    });
  }

  @Post('retornos')
  @HttpCode(200)
  @Permissao('financeiro.tituloReceber.baixar')
  @AuditadoNoHandler('financeiro.processarRetornoCobranca pelo executor (trilha na mesma transação)')
  processarRetorno(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.processarRetornoCobranca',
      corpo(esquemaProcessarRetornoCobranca, b),
      (r) =>
        `Retorno processado: ${Number(r['liquidados'])} liquidado(s) (R$ ${reais(r['totalLiquidado'])}), ` +
        `${Number(r['confirmados'])} registro(s) confirmado(s), ${Number(r['rejeitados'])} rejeitado(s), ` +
        `${Number(r['naoLocalizados'])} não localizado(s); tarifas de R$ ${reais(r['totalTarifas'])}.`,
    );
  }

  @Get('retorno-simulado')
  @Permissao('financeiro.cobrancaBancaria.ler')
  async simulado(@Query('carteira') carteira: string | undefined, @Req() req: RequisicaoAutorizada) {
    // Em produção o retorno vem do banco: o simulador não existe.
    if (this.ambiente === 'producao') throw new ErroProblema('nao-encontrado', 404, 'Não encontrado');
    const n = this.exigir(carteira, 'Carteira');
    const conteudo = await this.ler(req, async (l, est, contas) => {
      await this.exigirCarteiraDoEscopo(l, est, contas, n);
      return retornoCobrancaSimulado(l, est, n);
    });
    if (conteudo === null) throw new ErroProblema('nao-encontrado', 404, 'Carteira não encontrada');
    return { nomeArquivo: `retorno-cobranca-simulado-${n}-${Date.now()}.ret`, conteudo };
  }
}
