// Parâmetros, preferências e alçada do faturamento (F3.7, 06-FAT linha 38), só com o banco próprio.
//   GET  /api/faturamento/parametros                 faturamento.conta.ler (parâmetros vigentes, preferências da
//        própria conta e o catálogo tipado para a tela)
//   POST /api/faturamento/preferencias               faturamento.conta.ler (grava as preferências da própria conta;
//        nunca de outra pessoa)
//   GET  /api/faturamento/alcada?documento=&valor=&solicitante=   faturamento.conta.ler (prévia: o usuário da sessão
//        aprova o documento deste valor? quem pede não aprova)
// Os parâmetros de rede e estabelecimento são mantidos na tela de parâmetros da administração. As gravações levam
// Idempotency-Key e passam pelo executor (trilha e autoria na mesma transação).
import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req } from '@nestjs/common';
import type { ContextoNucleo, Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { recusa } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, ctxDe, inteiro, problemaDoPreco } from '../precos/base.js';
import {
  conferirAlcadaFaturamentoNoBanco,
  gravarPreferenciasFaturista,
  lerParametrosFaturamento,
} from './parametros-faturamento-propria.js';

export const SERVICO_PARAMETROS_FATURAMENTO = Symbol('SERVICO_PARAMETROS_FATURAMENTO');
const EXECUTOR = 'executor: trilha e autoria na mesma transação';
const ORIGEM = 'parametros-faturamento';

export class ServicoParametrosFaturamento {
  private readonly executor: Executor;
  constructor(private readonly nucleo: NucleoProprio) {
    this.executor = nucleo.criarExecutor({});
  }
  ler<T>(ctx: ContextoNucleo, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = ctx.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(
      { cliente: ctx.cliente, estabelecimento: est, correlacao: ctx.correlacao },
      (l) => fn(l, est),
    );
  }
  gravarPreferencias(ctx: Parameters<typeof gravarPreferenciasFaturista>[1], e: unknown) {
    return gravarPreferenciasFaturista(this.executor, ctx, e);
  }
}

const objeto = (c: unknown): Record<string, unknown> =>
  c !== null && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {};

@Controller()
export class ParametrosFaturamentoController {
  constructor(
    @Inject(SERVICO_PARAMETROS_FATURAMENTO) private readonly servico: ServicoParametrosFaturamento | null,
  ) {}

  private s(): ServicoParametrosFaturamento {
    if (!this.servico)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'Os parâmetros do faturamento exigem o banco próprio.',
      );
    return this.servico;
  }
  private async rodar<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw problemaDoPreco(e);
    }
  }

  @Get('faturamento/parametros')
  @Permissao('faturamento.conta.ler')
  ler(@Req() req: RequisicaoAutorizada) {
    const c = ctxDe(req, ORIGEM);
    return this.rodar(() => this.s().ler(c, (l, est) => lerParametrosFaturamento(l, est, c.usuario)));
  }

  @Post('faturamento/preferencias')
  @HttpCode(200)
  @Permissao('faturamento.conta.ler')
  @AuditadoNoHandler(EXECUTOR)
  gravar(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() => this.s().gravarPreferencias(contextoOperacao(req, ORIGEM), objeto(corpo)));
  }

  @Get('faturamento/alcada')
  @Permissao('faturamento.conta.ler')
  alcada(
    @Query('documento') documento: string,
    @Query('valor') valor: string,
    @Query('solicitante') solicitante: string,
    @Req() req: RequisicaoAutorizada,
  ) {
    const v = Number(valor);
    if (!Number.isFinite(v) || v < 0)
      throw new ErroProblema('entrada-invalida', 400, 'Entrada inválida', 'Informe o valor do documento.');
    const sol = inteiro(solicitante, 'solicitante');
    const c = ctxDe(req, ORIGEM);
    return this.rodar(() =>
      this.s().ler(c, (l, est) =>
        conferirAlcadaFaturamentoNoBanco(l, est, String(documento ?? ''), v, sol, c.usuario),
      ),
    );
  }
}
