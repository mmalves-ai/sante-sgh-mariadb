// Simulação de cenários de receita sobre a produção real (F8, 01-ADM L120), só com o banco próprio do cliente.
//   GET  /api/faturamento/simulacao-receita                         faturamento.preco.simular (cenários, execuções e
//                                                                   as opções: convênios, planos e tabelas)
//   GET  /api/faturamento/simulacao-receita/execucoes/:id           faturamento.preco.simular (totais, por convênio,
//                                                                   por grupo, por tipo de atendimento, procedimentos
//                                                                   e inconsistências)
//   POST /api/faturamento/simulacao-receita/cenarios                faturamento.preco.simular (cria o cenário)
//   POST /api/faturamento/simulacao-receita/cenarios/:id/execucoes  faturamento.preco.simular (recalcula a produção;
//                                                                   nada muda nas contas)
// As gravações levam Idempotency-Key e passam pelo executor (trilha e autoria na mesma transação).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { ContextoNucleo, ContextoOperacao, Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { recusa } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, ctxDe, inteiro, problemaDoPreco } from '../precos/base.js';
import {
  detalheSimulacaoReceitaPropria,
  type NomeOperacaoSimulacaoReceita,
  OPERACOES_SIMULACAO_RECEITA,
  painelSimulacaoReceitaPropria,
} from './simulacao-receita-propria.js';

export const SERVICO_SIMULACAO_RECEITA = Symbol('SERVICO_SIMULACAO_RECEITA');
const EXECUTOR = 'executor: trilha e autoria na mesma transação';
const ORIGEM = 'simulacao-receita';

export class ServicoSimulacaoReceita {
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
  async gravar(
    nome: NomeOperacaoSimulacaoReceita,
    ctx: ContextoOperacao,
    e: unknown,
  ): Promise<Record<string, unknown>> {
    const op = OPERACOES_SIMULACAO_RECEITA[nome] as Parameters<Executor['executar']>[0];
    const r = await this.executor.executar(op, ctx.cliente, e, ctx);
    return r.resultado as Record<string, unknown>;
  }
}

const objeto = (c: unknown): Record<string, unknown> =>
  c !== null && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {};

@Controller()
export class SimulacaoReceitaController {
  constructor(@Inject(SERVICO_SIMULACAO_RECEITA) private readonly servico: ServicoSimulacaoReceita | null) {}

  private s(): ServicoSimulacaoReceita {
    if (!this.servico)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'A simulação de receita exige o banco próprio.',
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

  @Get('faturamento/simulacao-receita')
  @Permissao('faturamento.preco.simular')
  painel(@Req() req: RequisicaoAutorizada) {
    const ctx = ctxDe(req, ORIGEM);
    return this.rodar(() => this.s().ler(ctx, (l, est) => painelSimulacaoReceitaPropria(l, est)));
  }

  @Get('faturamento/simulacao-receita/execucoes/:id')
  @Permissao('faturamento.preco.simular')
  execucao(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const s = inteiro(id, 'id');
    const ctx = ctxDe(req, ORIGEM);
    return this.rodar(() => this.s().ler(ctx, (l, est) => detalheSimulacaoReceitaPropria(l, est, s)));
  }

  @Post('faturamento/simulacao-receita/cenarios')
  @HttpCode(201)
  @Permissao('faturamento.preco.simular')
  @AuditadoNoHandler(EXECUTOR)
  criar(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() => this.s().gravar('criar', contextoOperacao(req, ORIGEM), objeto(corpo)));
  }

  @Post('faturamento/simulacao-receita/cenarios/:id/execucoes')
  @HttpCode(201)
  @Permissao('faturamento.preco.simular')
  @AuditadoNoHandler(EXECUTOR)
  executar(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().gravar('executar', contextoOperacao(req, ORIGEM), {
        ...objeto(corpo),
        cenarioId: inteiro(id, 'id'),
      }),
    );
  }
}
