// F7, 07-FIN linha 90: rotas da cobrança Pix sobre o título a receber.
//   GET  /api/financeiro/pix/chaves                         chaves Pix das contas do escopo
//   POST /api/financeiro/pix/chaves                         { acao: incluir | desativar, ... }
//   GET  /api/financeiro/pix/parcelas?busca=                parcelas em aberto que podem ganhar cobrança
//   GET  /api/financeiro/pix/cobrancas?situacao=&busca=     cobranças com os Pix recebidos, a baixa e a devolução
//   POST /api/financeiro/pix/cobrancas                      { parcela, chave, modalidade, valor?, vencimento?, ... }
//   POST /api/financeiro/pix/cobrancas/cancelar             { cobranca, motivo }
//   POST /api/financeiro/pix/retornos                       { notificacao } (corpo do webhook da API Pix)
//   POST /api/financeiro/pix/devolucoes                     { retorno, valor, motivo }
//   POST /api/financeiro/pix/cobrancas/pagar-simulado       { cobranca, valor? } (fora de produção: o simulador paga)
// A gravação vai pelo executor do @sgh/nucleo (trilha, outbox e idempotência na mesma transação; a permissão é a da
// rota); a leitura, direto no banco do cliente (sem núcleo: 503, falha fechada).
import { Body, Controller, Get, HttpCode, Inject, Optional, Post, Query, Req } from '@nestjs/common';
import type { ResultadoFinanceiro } from '@sgh/contratos';
import type { Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  chavesPix,
  cobrancasPix,
  esquemaCancelarCobrancaPix,
  esquemaChavePix,
  esquemaDevolverPix,
  esquemaEmitirCobrancaPix,
  esquemaRetornoPix,
  notificacaoSimulada,
  operacoesCobrancaPix,
  parcelasParaPix,
} from './cobranca-pix-propria.js';
import { contasDoEscopo } from './operacoes.js';
import { NUCLEO_PERIODO_FINANCEIRO } from './periodo.controller.js';
import { ProvedorPixDaCentral } from './pix-provedor.js';
import { resultadoFin } from './servico.js';

const SITUACOES = new Set([
  'ativa',
  'concluida',
  'removida_usuario',
  'removida_prestador',
  'expirada',
  'devolvida',
]);
const reais = (v: unknown) =>
  Number(v ?? 0)
    .toFixed(2)
    .replace('.', ',');
const esquemaPagarSimulado = z
  .object({ cobranca: z.number().int().positive(), valor: z.number().positive().optional() })
  .strict();

type Operacoes = ReturnType<typeof operacoesCobrancaPix>;

@Controller('financeiro/pix')
export class CobrancaPixController {
  private readonly executor: Executor | null;
  private readonly ambiente: string;
  private readonly operacoes: Operacoes;

  constructor(
    @Optional() @Inject(NUCLEO_PERIODO_FINANCEIRO) private readonly nucleo: NucleoProprio | null = null,
  ) {
    this.ambiente = (process.env['AMBIENTE'] ?? 'dev').trim() || 'dev';
    this.executor = nucleo ? nucleo.criarExecutor() : null;
    this.operacoes = operacoesCobrancaPix(new ProvedorPixDaCentral(this.ambiente));
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
    op: keyof Operacoes,
    entrada: unknown,
    mensagem: (r: Record<string, unknown>) => string,
  ): Promise<ResultadoFinanceiro> {
    if (!this.executor) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    const s = sessaoDe(req);
    const r = await this.executor
      .executar(this.operacoes[op] as never, s.porta.cliente, entrada, contextoOperacao(s, op))
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
    const res = r.resultado as Record<string, unknown>;
    return resultadoFin(mensagem(res), r.repetida, res);
  }

  private static mensagemRetorno(r: Record<string, unknown>): string {
    return (
      `${Number(r['recebidos'])} Pix recebido(s): ${Number(r['baixados'])} baixado(s) (R$ ${reais(r['totalBaixado'])}), ` +
      `${Number(r['paraDevolucao'])} com valor para devolução (R$ ${reais(r['totalExcedente'])}), ` +
      `${Number(r['repetidos'])} repetido(s), ${Number(r['naoLocalizados'])} sem cobrança.`
    );
  }

  @Get('chaves')
  @Permissao('financeiro.cobrancaBancaria.ler')
  chaves(@Req() req: RequisicaoAutorizada) {
    return this.ler(req, (l, est, contas) => chavesPix(l, est, contas));
  }

  @Post('chaves')
  @HttpCode(200)
  @Permissao('financeiro.cobrancaBancaria.configurar')
  @AuditadoNoHandler('financeiro.manterChavePix pelo executor (trilha na mesma transação)')
  manterChave(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    const e = corpo(esquemaChavePix, b);
    return this.gravar(req, 'financeiro.manterChavePix', e, () =>
      e.acao === 'incluir' ? 'Chave Pix cadastrada.' : 'Chave Pix desativada (o histórico continua).',
    );
  }

  @Get('parcelas')
  @Permissao('financeiro.cobrancaBancaria.ler')
  parcelas(@Query('busca') busca: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.ler(req, (l, est) => parcelasParaPix(l, est, (busca ?? '').slice(0, 100)));
  }

  @Get('cobrancas')
  @Permissao('financeiro.cobrancaBancaria.ler')
  cobrancas(
    @Query('situacao') situacao: string | undefined,
    @Query('busca') busca: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const filtro = {
      situacao: situacao && SITUACOES.has(situacao) ? situacao : null,
      busca: (busca ?? '').slice(0, 100),
    };
    return this.ler(req, (l, est, contas) => cobrancasPix(l, est, contas, filtro));
  }

  @Post('cobrancas')
  @HttpCode(200)
  @Permissao('financeiro.cobrancaBancaria.emitir')
  @AuditadoNoHandler('financeiro.emitirCobrancaPix pelo executor (trilha na mesma transação)')
  emitir(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.emitirCobrancaPix',
      corpo(esquemaEmitirCobrancaPix, b),
      (r) =>
        `Cobrança Pix de R$ ${reais(r['valor'])} gerada.` +
        (r['simulado'] ? ' Ambiente de teste: o QR é simulado e não paga em banco nenhum.' : ''),
    );
  }

  @Post('cobrancas/cancelar')
  @HttpCode(200)
  @Permissao('financeiro.cobrancaBancaria.emitir')
  @AuditadoNoHandler('financeiro.cancelarCobrancaPix pelo executor (trilha na mesma transação)')
  cancelar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.cancelarCobrancaPix',
      corpo(esquemaCancelarCobrancaPix, b),
      () => 'Cobrança Pix cancelada. A parcela pode receber outra cobrança.',
    );
  }

  @Post('retornos')
  @HttpCode(200)
  @Permissao('financeiro.tituloReceber.baixar')
  @AuditadoNoHandler('financeiro.processarRetornoPix pelo executor (trilha na mesma transação)')
  retorno(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.processarRetornoPix',
      corpo(esquemaRetornoPix, b),
      CobrancaPixController.mensagemRetorno,
    );
  }

  @Post('devolucoes')
  @HttpCode(200)
  @Permissao('financeiro.tituloReceber.baixar')
  @AuditadoNoHandler('financeiro.devolverPix pelo executor (trilha na mesma transação)')
  devolver(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(req, 'financeiro.devolverPix', corpo(esquemaDevolverPix, b), (r) =>
      Number(r['reverteBaixa']) > 0
        ? `Devolução de R$ ${reais(r['valor'])} feita: R$ ${reais(r['reverteBaixa'])} voltaram ao saldo da parcela.`
        : `Devolução de R$ ${reais(r['valor'])} feita, do valor pago a mais (a baixa continua).`,
    );
  }

  @Post('cobrancas/pagar-simulado')
  @HttpCode(200)
  @Permissao('financeiro.tituloReceber.baixar')
  @AuditadoNoHandler('financeiro.processarRetornoPix pelo executor (trilha na mesma transação)')
  async pagarSimulado(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    // Em produção o Pix vem do prestador: o simulador não existe.
    if (this.ambiente === 'producao') throw new ErroProblema('nao-encontrado', 404, 'Não encontrado');
    const e = corpo(esquemaPagarSimulado, b);
    const notificacao = await this.ler(req, (l, est) =>
      notificacaoSimulada(l, est, e.cobranca, e.valor ?? null),
    );
    if (!notificacao) throw new ErroProblema('nao-encontrado', 404, 'Cobrança não encontrada');
    return this.gravar(
      req,
      'financeiro.processarRetornoPix',
      { notificacao },
      CobrancaPixController.mensagemRetorno,
    );
  }
}
