// Receita contábil do faturamento (F3.7, 06-FAT linha 37): eventos, pendências e divergências da apuração.
//   GET  /api/faturamento/receita-contabil?conta=&situacao=   faturamento.conta.ler (eventos, ocorrências e regras ativas)
//   POST /api/faturamento/receita-contabil/apurar             faturamento.conta.fechar (refaz a apuração da conta pelos
//                                                             fatos de hoje, sem duplicar; o contabilizado não muda)
// A gravação leva Idempotency-Key e passa pelo executor (trilha e autoria na mesma transação).
import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req } from '@nestjs/common';
import type { ContextoNucleo, ContextoOperacao, Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { recusa } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, ctxDe, problemaDoPreco } from '../precos/base.js';
import {
  apurarReceitaContabil,
  type FiltroReceitaContabil,
  painelReceitaContabilPropria,
} from './receita-contabil-propria.js';

export const SERVICO_RECEITA_CONTABIL = Symbol('SERVICO_RECEITA_CONTABIL');
const EXECUTOR = 'executor: trilha e autoria na mesma transação';
const ORIGEM = 'receita-contabil';

export class ServicoReceitaContabil {
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
  painel(ctx: ContextoNucleo, f: FiltroReceitaContabil) {
    return this.ler(ctx, (l, est) => painelReceitaContabilPropria(l, est, f));
  }
  async apurar(ctx: ContextoOperacao, e: unknown): Promise<Record<string, unknown>> {
    const op = apurarReceitaContabil as unknown as Parameters<Executor['executar']>[0];
    const r = await this.executor.executar(op, ctx.cliente, e, ctx);
    return r.resultado as Record<string, unknown>;
  }
}

const inteiroOuNulo = (v: unknown): number | null => {
  const x = Number(v);
  return v === undefined || v === '' || !Number.isInteger(x) || x <= 0 ? null : x;
};

@Controller()
export class ReceitaContabilController {
  constructor(@Inject(SERVICO_RECEITA_CONTABIL) private readonly servico: ServicoReceitaContabil | null) {}

  private s(): ServicoReceitaContabil {
    if (!this.servico)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'A receita contábil exige o banco próprio.',
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

  @Get('faturamento/receita-contabil')
  @Permissao('faturamento.conta.ler')
  painel(
    @Query('conta') conta: string,
    @Query('situacao') situacao: string,
    @Req() req: RequisicaoAutorizada,
  ) {
    const ctx = ctxDe(req, ORIGEM);
    return this.rodar(() =>
      this.s().painel(ctx, { conta: inteiroOuNulo(conta), situacao: situacao ? String(situacao) : null }),
    );
  }

  @Post('faturamento/receita-contabil/apurar')
  @HttpCode(200)
  @Permissao('faturamento.conta.fechar')
  @AuditadoNoHandler(EXECUTOR)
  apurar(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const c = corpo !== null && typeof corpo === 'object' ? (corpo as Record<string, unknown>) : {};
    return this.rodar(() => this.s().apurar(contextoOperacao(req, ORIGEM), { conta: Number(c['conta']) }));
  }
}
