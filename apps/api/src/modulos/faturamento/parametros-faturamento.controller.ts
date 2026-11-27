// Parâmetros, preferências e alçada do faturamento (F3.7, 06-FAT linha 38), só com o banco próprio.
//   GET  /api/faturamento/parametros                 faturamento.conta.ler (parâmetros vigentes, preferências da
//        própria conta e o catálogo tipado para a tela)
//   POST /api/faturamento/preferencias               faturamento.conta.ler (grava as preferências da própria conta;
//        nunca de outra pessoa)
//   GET  /api/faturamento/alcada?documento=&valor=&solicitante=   faturamento.conta.ler (prévia: o usuário da sessão
//        aprova o documento deste valor? quem pede não aprova)
//   GET  /api/faturamento/alcada/pedidos?situacao=     faturamento.conta.ler (pedidos de aprovação do estabelecimento)
//   POST /api/faturamento/alcada/pedidos               faturamento.conta.ler (pede a aprovação de um documento fat_*)
//   POST /api/faturamento/alcada/pedidos/:id/decisao   faturamento.conta.ler (aprova ou recusa; a alçada do decisor é
//        conferida pelo domínio na gravação e quem pede não aprova)
// Os parâmetros de rede e estabelecimento são mantidos na tela de parâmetros da administração. As gravações levam
// Idempotency-Key e passam pelo executor (trilha e autoria na mesma transação).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { ContextoNucleo, Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { recusa } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, ctxDe, inteiro, problemaDoPreco } from '../precos/base.js';
import {
  decidirAlcadaFaturamento,
  listarPedidosAlcada,
  pedirAlcadaFaturamento,
} from './alcada-pedido-propria.js';
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
  pedirAlcada(ctx: Parameters<typeof pedirAlcadaFaturamento>[1], e: unknown) {
    return pedirAlcadaFaturamento(this.executor, ctx, e);
  }
  decidirAlcada(ctx: Parameters<typeof decidirAlcadaFaturamento>[1], e: unknown) {
    return decidirAlcadaFaturamento(this.executor, ctx, e);
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

  @Get('faturamento/alcada/pedidos')
  @Permissao('faturamento.conta.ler')
  pedidos(@Query('situacao') situacao: string | undefined, @Req() req: RequisicaoAutorizada) {
    const c = ctxDe(req, ORIGEM);
    const sit =
      situacao && ['pendente', 'aprovado', 'recusado', 'usado'].includes(situacao) ? situacao : null;
    return this.rodar(() => this.s().ler(c, (l, est) => listarPedidosAlcada(l, est, sit)));
  }

  @Post('faturamento/alcada/pedidos')
  @HttpCode(200)
  @Permissao('faturamento.conta.ler')
  @AuditadoNoHandler(EXECUTOR)
  pedir(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() => this.s().pedirAlcada(contextoOperacao(req, ORIGEM), objeto(corpo)));
  }

  @Post('faturamento/alcada/pedidos/:id/decisao')
  @HttpCode(200)
  @Permissao('faturamento.conta.ler')
  @AuditadoNoHandler(EXECUTOR)
  decidir(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const pedido = inteiro(id, 'pedido');
    return this.rodar(() =>
      this.s().decidirAlcada(contextoOperacao(req, ORIGEM), { ...objeto(corpo), pedido }),
    );
  }
}
