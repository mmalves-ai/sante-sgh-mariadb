// F8, 07-FIN linhas 68 e 69: rotas do encontro de contas e da previsão e provisão de pagamentos.
//   GET  /api/financeiro/compensacao/parceiros                 parceiros fornecedor e devedor com saldo dos dois lados
//   GET  /api/financeiro/compensacao/parcelas?fornecedor=      parcelas em aberto a pagar e a receber do parceiro
//   GET  /api/financeiro/compensacao/encontros                 encontros do estabelecimento
//   POST /api/financeiro/compensacao/encontros                 { fornecedor, data, parcelasPagar, parcelasReceber }
//   POST /api/financeiro/compensacao/encontros/efetivar        { encontro } (outra pessoa: aprova e efetiva)
//   POST /api/financeiro/compensacao/encontros/cancelar        { encontro, motivo }
//   GET  /api/financeiro/compensacao/previsoes?de=&ate=        previsto × realizado por ocorrência
//   POST /api/financeiro/compensacao/previsoes                 a previsão (gera as ocorrências)
//   GET  /api/financeiro/compensacao/previsoes/titulos?ocorrencia=  títulos que podem realizar a ocorrência
//   POST /api/financeiro/compensacao/previsoes/realizar        { ocorrencia, tituloPagar | tituloReceber }
//   GET  /api/financeiro/compensacao/provisoes                 provisões do passivo
//   GET  /api/financeiro/compensacao/provisoes/titulos?provisao=  títulos a pagar que podem liquidar a provisão
//   POST /api/financeiro/compensacao/provisoes                 a provisão
//   POST /api/financeiro/compensacao/provisoes/liquidar        { provisao, tituloPagar }
//   POST /api/financeiro/compensacao/provisoes/reverter        { provisao, valor, motivo, data }
//   GET  /api/financeiro/compensacao/apoios                    naturezas, contas do passivo, credores, fontes pagadoras,
//                                                               centros de custo, contas bancárias e profissionais
// A gravação vai pelo apoio do contas a pagar (permissão da operação, trilha e idempotência no executor); a leitura,
// direto no banco do cliente (sem núcleo: 503, falha fechada).
import { Body, Controller, Get, HttpCode, Inject, Optional, Post, Query, Req } from '@nestjs/common';
import type { ResultadoFinanceiro } from '@sgh/contratos';
import type { Leitor, NucleoProprio } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { corpo, inteiroOuNulo } from '../exames/public-api.js';
import { ApoiosFinanceiro } from './apoios.js';
import {
  apoiosPrevisao,
  encontrosDoEstabelecimento,
  esquemaCancelarEncontro,
  esquemaCancelarOcorrencia,
  esquemaEncerrarPrevisao,
  esquemaEstenderPrevisao,
  esquemaEstornarEncontro,
  esquemaCriarPrevisao,
  esquemaEfetivarEncontro,
  esquemaLiquidarProvisao,
  esquemaProporEncontro,
  esquemaProvisionar,
  esquemaRealizarPrevisao,
  esquemaReverterProvisao,
  parceirosComEncontro,
  parcelasDoParceiro,
  previstoRealizado,
  provisoesDoEstabelecimento,
  titulosParaLiquidar,
  titulosParaRealizar,
} from './compensacao-previsao-propria.js';
import { NUCLEO_PERIODO_FINANCEIRO } from './periodo.controller.js';
import { PORTA_FINANCEIRO, type PortaFinanceiro } from './porta.js';
import { resultadoFin } from './servico.js';

const DATA = /^\d{4}-\d{2}-\d{2}$/;

@Controller('financeiro/compensacao')
export class CompensacaoPrevisaoController {
  private readonly apoios: ApoiosFinanceiro;

  constructor(
    @Inject(PORTA_FINANCEIRO) porta: PortaFinanceiro,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(NUCLEO_PERIODO_FINANCEIRO) private readonly nucleo: NucleoProprio | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) fonteConfiguracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    const ambiente = (process.env['AMBIENTE'] ?? 'dev').trim() || 'dev';
    this.apoios = new ApoiosFinanceiro(porta, trilha, fonteConfiguracao, cache, ambiente);
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
    op: string,
    entrada: unknown,
    mensagem: string,
  ): Promise<ResultadoFinanceiro> {
    const r = await this.apoios.daOperacao(op).executar(sessaoDe(req), op, entrada, mensagem);
    return resultadoFin(r.mensagem, r.repetida, r.resultado);
  }

  // ── Encontro de contas ──

  @Get('parceiros')
  @Permissao('financeiro.tituloPagar.ler')
  parceiros(@Req() req: RequisicaoAutorizada) {
    return this.ler(req, (l, est) => parceirosComEncontro(l, est));
  }

  @Get('parcelas')
  @Permissao('financeiro.tituloPagar.ler')
  parcelas(@Query('fornecedor') fornecedor: string | undefined, @Req() req: RequisicaoAutorizada) {
    const n = inteiroOuNulo(fornecedor);
    if (!n) throw new ErroProblema('entrada-invalida', 400, 'Parceiro inválido', 'Escolha o parceiro.');
    return this.ler(req, (l, est) => parcelasDoParceiro(l, est, n));
  }

  @Get('encontros')
  @Permissao('financeiro.tituloPagar.ler')
  encontros(@Req() req: RequisicaoAutorizada) {
    return this.ler(req, (l, est) => encontrosDoEstabelecimento(l, est));
  }

  @Post('encontros')
  @HttpCode(200)
  @Permissao('financeiro.tituloPagar.baixar')
  @AuditadoNoHandler('financeiro.proporEncontroContas pelo executor (trilha na mesma transação)')
  propor(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.proporEncontroContas',
      corpo(esquemaProporEncontro, b),
      'Encontro de contas proposto; aguarda a aprovação de outra pessoa.',
    );
  }

  @Post('encontros/efetivar')
  @HttpCode(200)
  @Permissao('financeiro.tituloPagar.aprovar')
  @AuditadoNoHandler('financeiro.efetivarEncontroContas pelo executor (trilha na mesma transação)')
  efetivar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.efetivarEncontroContas',
      corpo(esquemaEfetivarEncontro, b),
      'Encontro de contas aprovado e efetivado; as parcelas dos dois lados foram baixadas.',
    );
  }

  @Post('encontros/cancelar')
  @HttpCode(200)
  @Permissao('financeiro.tituloPagar.baixar')
  @AuditadoNoHandler('financeiro.cancelarEncontroContas pelo executor (trilha na mesma transação)')
  cancelar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.cancelarEncontroContas',
      corpo(esquemaCancelarEncontro, b),
      'Encontro de contas cancelado; a proposta fica no histórico.',
    );
  }

  @Post('encontros/estornar')
  @HttpCode(200)
  @Permissao('financeiro.tituloPagar.aprovar')
  @AuditadoNoHandler('financeiro.estornarEncontroContas pelo executor (trilha na mesma transação)')
  estornar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.estornarEncontroContas',
      corpo(esquemaEstornarEncontro, b),
      'Encontro de contas estornado; as baixas dos dois lados voltaram e ficam no histórico.',
    );
  }

  @Post('previsoes/estender')
  @HttpCode(200)
  @Permissao('financeiro.tituloPagar.criar')
  @AuditadoNoHandler('financeiro.estenderPrevisaoFinanceira pelo executor (trilha na mesma transação)')
  estender(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.estenderPrevisaoFinanceira',
      corpo(esquemaEstenderPrevisao, b),
      'Previsão estendida por mais 12 meses.',
    );
  }

  @Post('previsoes/ocorrencias/cancelar')
  @HttpCode(200)
  @Permissao('financeiro.tituloPagar.criar')
  @AuditadoNoHandler('financeiro.cancelarOcorrenciaPrevisao pelo executor (trilha na mesma transação)')
  cancelarOcorrencia(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.cancelarOcorrenciaPrevisao',
      corpo(esquemaCancelarOcorrencia, b),
      'Ocorrência prevista cancelada; a linha fica no histórico.',
    );
  }

  @Post('previsoes/encerrar')
  @HttpCode(200)
  @Permissao('financeiro.tituloPagar.criar')
  @AuditadoNoHandler('financeiro.encerrarPrevisaoFinanceira pelo executor (trilha na mesma transação)')
  encerrar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.encerrarPrevisaoFinanceira',
      corpo(esquemaEncerrarPrevisao, b),
      'Previsão encerrada; as ocorrências abertas depois da data foram canceladas.',
    );
  }

  // ── Previsão e provisão ──

  @Get('previsoes')
  @Permissao('financeiro.fluxoCaixa.ler')
  previsoes(
    @Query('de') de: string | undefined,
    @Query('ate') ate: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    if (!de || !ate || !DATA.test(de) || !DATA.test(ate) || ate < de)
      throw new ErroProblema('entrada-invalida', 400, 'Período inválido', 'Escolha o início e o fim.');
    return this.ler(req, (l, est) => previstoRealizado(l, est, de, ate));
  }

  @Get('previsoes/titulos')
  @Permissao('financeiro.fluxoCaixa.ler')
  titulosParaRealizar(@Query('ocorrencia') ocorrencia: string | undefined, @Req() req: RequisicaoAutorizada) {
    const n = inteiroOuNulo(ocorrencia);
    if (!n) throw new ErroProblema('entrada-invalida', 400, 'Ocorrência inválida', 'Escolha a ocorrência.');
    return this.ler(req, (l, est) => titulosParaRealizar(l, est, n));
  }

  @Post('previsoes')
  @HttpCode(200)
  @Permissao('financeiro.tituloPagar.criar')
  @AuditadoNoHandler('financeiro.criarPrevisaoFinanceira pelo executor (trilha na mesma transação)')
  criarPrevisao(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.criarPrevisaoFinanceira',
      corpo(esquemaCriarPrevisao, b),
      'Previsão gravada com as ocorrências.',
    );
  }

  @Post('previsoes/realizar')
  @HttpCode(200)
  @Permissao('financeiro.tituloPagar.criar')
  @AuditadoNoHandler('financeiro.realizarPrevisaoFinanceira pelo executor (trilha na mesma transação)')
  realizar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.realizarPrevisaoFinanceira',
      corpo(esquemaRealizarPrevisao, b),
      'Ocorrência realizada pelo título; a diferença ficou registrada.',
    );
  }

  @Get('provisoes')
  @Permissao('financeiro.fluxoCaixa.ler')
  provisoes(@Req() req: RequisicaoAutorizada) {
    return this.ler(req, (l, est) => provisoesDoEstabelecimento(l, est));
  }

  @Get('provisoes/titulos')
  @Permissao('financeiro.fluxoCaixa.ler')
  titulosParaLiquidar(@Query('provisao') provisao: string | undefined, @Req() req: RequisicaoAutorizada) {
    const n = inteiroOuNulo(provisao);
    if (!n) throw new ErroProblema('entrada-invalida', 400, 'Provisão inválida', 'Escolha a provisão.');
    return this.ler(req, (l, est) => titulosParaLiquidar(l, est, n));
  }

  @Post('provisoes')
  @HttpCode(200)
  @Permissao('financeiro.tituloPagar.criar')
  @AuditadoNoHandler('financeiro.provisionarPassivo pelo executor (trilha na mesma transação)')
  provisionar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.provisionarPassivo',
      corpo(esquemaProvisionar, b),
      'Provisão gravada.',
    );
  }

  @Post('provisoes/liquidar')
  @HttpCode(200)
  @Permissao('financeiro.tituloPagar.criar')
  @AuditadoNoHandler('financeiro.liquidarProvisaoPassivo pelo executor (trilha na mesma transação)')
  liquidar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.liquidarProvisaoPassivo',
      corpo(esquemaLiquidarProvisao, b),
      'Provisão liquidada pelo título.',
    );
  }

  @Post('provisoes/reverter')
  @HttpCode(200)
  @Permissao('financeiro.tituloPagar.aprovar')
  @AuditadoNoHandler('financeiro.reverterProvisaoPassivo pelo executor (trilha na mesma transação)')
  reverter(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.reverterProvisaoPassivo',
      corpo(esquemaReverterProvisao, b),
      'Reversão gravada; o ajuste fica no histórico da provisão.',
    );
  }

  @Get('apoios')
  @Permissao('financeiro.fluxoCaixa.ler')
  apoiosTela(@Req() req: RequisicaoAutorizada) {
    return this.ler(req, (l, est) => apoiosPrevisao(l, est));
  }
}
