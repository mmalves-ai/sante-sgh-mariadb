// A nota fiscal de serviço que documenta a fatura ou a conta (F3.7, 06-FAT linha 36), só com o banco próprio.
//   GET  /api/faturamento/faturas/:id/notas-fiscais        faturamento.conta.ler (valores, ligadas e candidatas)
//   GET  /api/faturamento/contas/:id/notas-fiscais         faturamento.conta.ler
//   POST /api/faturamento/notas-fiscais/vinculos           financeiro.nfse.emitir (liga ou ajusta o valor)
//   POST /api/faturamento/notas-fiscais/vinculos/:vid/desligamento  financeiro.nfse.emitir (motivo obrigatório; fica marcado e no histórico, não some)
// As gravações levam Idempotency-Key e passam pelo executor (trilha e autoria na mesma transação).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { ContextoNucleo, Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { recusa } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, ctxDe, inteiro, problemaDoPreco } from '../precos/base.js';
import {
  documentacaoFiscalPropria,
  gravarNotaVinculo,
  type NomeOperacaoNotaVinculo,
} from './nota-vinculo-propria.js';

export const SERVICO_NOTA_VINCULO = Symbol('SERVICO_NOTA_VINCULO');
const EXECUTOR = 'executor: trilha e autoria na mesma transação';

export class ServicoNotaVinculo {
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
  gravar(nome: NomeOperacaoNotaVinculo, ctx: Parameters<typeof gravarNotaVinculo>[2], e: unknown) {
    return gravarNotaVinculo(this.executor, nome, ctx, e);
  }
}

const objeto = (c: unknown): Record<string, unknown> =>
  c !== null && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {};

@Controller()
export class NotaVinculoController {
  constructor(@Inject(SERVICO_NOTA_VINCULO) private readonly servico: ServicoNotaVinculo | null) {}

  private s(): ServicoNotaVinculo {
    if (!this.servico)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'A nota fiscal da fatura exige o banco próprio.',
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

  @Get('faturamento/faturas/:id/notas-fiscais')
  @Permissao('faturamento.conta.ler')
  daFatura(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const f = inteiro(id, 'id');
    return this.rodar(() =>
      this.s().ler(ctxDe(req, 'nota-fatura'), (l, est) => documentacaoFiscalPropria(l, est, 'fatura', f)),
    );
  }

  @Get('faturamento/contas/:id/notas-fiscais')
  @Permissao('faturamento.conta.ler')
  daConta(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const c = inteiro(id, 'id');
    return this.rodar(() =>
      this.s().ler(ctxDe(req, 'nota-fatura'), (l, est) => documentacaoFiscalPropria(l, est, 'conta', c)),
    );
  }

  @Post('faturamento/notas-fiscais/vinculos')
  @HttpCode(200)
  @Permissao('financeiro.nfse.emitir')
  @AuditadoNoHandler(EXECUTOR)
  vincular(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() => this.s().gravar('vincular', contextoOperacao(req, 'nota-fatura'), objeto(corpo)));
  }

  @Post('faturamento/notas-fiscais/vinculos/:vid/desligamento')
  @HttpCode(200)
  @Permissao('financeiro.nfse.emitir')
  @AuditadoNoHandler(EXECUTOR)
  desvincular(@Param('vid') vid: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().gravar('desvincular', contextoOperacao(req, 'nota-fatura'), {
        ...objeto(corpo),
        id: inteiro(vid, 'vid'),
      }),
    );
  }
}
