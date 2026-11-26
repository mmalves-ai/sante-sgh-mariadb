// Exceções da regra de lançamento automático (F3.7, 06-FAT linha 16; C1-090), só com o banco próprio.
//   GET  /api/faturamento/regras-lancamento/excecoes                   faturamento.regra.ler (regras, exceções, combos)
//   POST /api/faturamento/regras-lancamento/excecoes                   faturamento.regra.editar (inclui a exceção)
//   POST /api/faturamento/regras-lancamento/excecoes/:id/encerramento  faturamento.regra.editar (vale até ontem)
//   POST /api/faturamento/regras-lancamento/excecoes/:id/cancelamento  faturamento.regra.editar (antes de valer)
// A exceção de todos os estabelecimentos (incluir, encerrar, cancelar) pede também faturamento.regra.editarGlobal:
// a sessão decide (podeTodosEstabelecimentos vai depois do corpo) e a recusa volta 403.
// As gravações levam Idempotency-Key e passam pelo executor (trilha e autoria na mesma transação). Nada se apaga.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { ContextoNucleo, Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { ErroOperacao, recusa } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, ctxDe, inteiro, podeNa, problemaDoPreco } from '../precos/base.js';
import {
  excecoesRegraLancamentoPropria,
  gravarExcecaoRegra,
  type NomeOperacaoExcecaoRegra,
} from './regra-excecao-propria.js';

export const SERVICO_EXCECAO_REGRA = Symbol('SERVICO_EXCECAO_REGRA');
const EXECUTOR = 'executor: trilha e autoria na mesma transação';
const ORIGEM = 'regra-lancamento-excecao';

export class ServicoExcecaoRegra {
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
  gravar(nome: NomeOperacaoExcecaoRegra, ctx: Parameters<typeof gravarExcecaoRegra>[2], e: unknown) {
    return gravarExcecaoRegra(this.executor, nome, ctx, e);
  }
}

export const EDITAR_GLOBAL = 'faturamento.regra.editarGlobal';
const objeto = (c: unknown): Record<string, unknown> =>
  c !== null && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {};

@Controller()
export class ExcecaoRegraController {
  constructor(@Inject(SERVICO_EXCECAO_REGRA) private readonly servico: ServicoExcecaoRegra | null) {}

  private s(): ServicoExcecaoRegra {
    if (!this.servico)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'As exceções da regra de lançamento exigem o banco próprio.',
      );
    return this.servico;
  }
  private async rodar<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ErroOperacao && e.problema.codigo === 'sem-permissao-global')
        throw new ErroProblema('sem-permissao', 403, 'Sem permissão', e.problema.detail ?? '');
      throw problemaDoPreco(e);
    }
  }

  @Get('faturamento/regras-lancamento/excecoes')
  @Permissao('faturamento.regra.ler')
  listar(@Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().ler(ctxDe(req, ORIGEM), (l, est) => excecoesRegraLancamentoPropria(l, est)),
    );
  }

  @Post('faturamento/regras-lancamento/excecoes')
  @HttpCode(200)
  @Permissao('faturamento.regra.editar')
  @AuditadoNoHandler(EXECUTOR)
  incluir(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().gravar('incluir-excecao', contextoOperacao(req, ORIGEM), {
        ...objeto(corpo),
        podeTodosEstabelecimentos: podeNa(req, EDITAR_GLOBAL),
      }),
    );
  }

  @Post('faturamento/regras-lancamento/excecoes/:id/encerramento')
  @HttpCode(200)
  @Permissao('faturamento.regra.editar')
  @AuditadoNoHandler(EXECUTOR)
  encerrar(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const x = inteiro(id, 'id');
    return this.rodar(() =>
      this.s().gravar('encerrar-excecao', contextoOperacao(req, ORIGEM), {
        ...objeto(corpo),
        id: x,
        podeTodosEstabelecimentos: podeNa(req, EDITAR_GLOBAL),
      }),
    );
  }

  @Post('faturamento/regras-lancamento/excecoes/:id/cancelamento')
  @HttpCode(200)
  @Permissao('faturamento.regra.editar')
  @AuditadoNoHandler(EXECUTOR)
  cancelar(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const x = inteiro(id, 'id');
    return this.rodar(() =>
      this.s().gravar('cancelar-excecao', contextoOperacao(req, ORIGEM), {
        ...objeto(corpo),
        id: x,
        podeTodosEstabelecimentos: podeNa(req, EDITAR_GLOBAL),
      }),
    );
  }
}
