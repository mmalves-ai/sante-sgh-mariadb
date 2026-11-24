// Cobrança por fonte pagadora (06-FAT linhas 6, 8 e 9): gravações e conferência. As listas saem pela porta de preços
// (GET /api/faturamento/credenciamento, /credenciamento/complementar, /de-para-exames e /api/precos/matmed/...).
//   GET  /api/faturamento/conferencia-cobranca?convenio&plano&item&profissional&prestador&equipes&tipoConta&atendimento&quantidade&data
//                                                             convenio.credenciamento.ler (código, quantidade e se pode cobrar)
//   GET  /api/faturamento/credenciamento/excecoes?convenio    convenio.credenciamento.ler
//   POST /api/faturamento/de-para                             convenio.contrato.editar (encerra o anterior na véspera)
//   POST /api/faturamento/de-para/:id/encerramento            convenio.contrato.editar
//   POST /api/faturamento/credenciamento-cobranca             convenio.credenciamento.editar
//   POST /api/faturamento/credenciamento-cobranca/:id/encerramento   convenio.credenciamento.editar
//   POST /api/faturamento/credenciamento/excecoes             convenio.credenciamento.editar (proibir exige motivo)
//   POST /api/faturamento/credenciamento/excecoes/:id/encerramento   convenio.credenciamento.editar
//   GET  /api/precos/matmed/referencia/:item/equivalencias    preco.tabela.ler
//   POST /api/precos/matmed/referencia/:item/equivalencias    convenio.contrato.editar (operadora e/ou TUSS)
// As gravações levam Idempotency-Key e passam pelo executor (trilha e autoria na mesma transação).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { ContextoNucleo, Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { recusa } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, ctxDe, inteiro, problemaDoPreco } from './base.js';
import {
  conferirCobrancaPropria,
  equivalenciasMatmedPropria,
  esquemaConferenciaCobranca,
  excecoesCredenciamentoPropria,
  gravarCobranca,
  type NomeOperacaoCobranca,
} from './cobranca-propria.js';

export const SERVICO_COBRANCA = Symbol('SERVICO_COBRANCA');
const EXECUTOR = 'executor: trilha e autoria na mesma transação';

/** Leitura e gravação da cobrança sobre o banco próprio. */
export class ServicoCobranca {
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
  gravar(nome: NomeOperacaoCobranca, ctx: Parameters<typeof gravarCobranca>[2], e: unknown) {
    return gravarCobranca(this.executor, nome, ctx, e);
  }
}

const num = (v: string | undefined) => (v === undefined || v === '' ? null : Number(v));
const objeto = (c: unknown): Record<string, unknown> =>
  c !== null && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {};

@Controller()
export class CobrancaController {
  constructor(@Inject(SERVICO_COBRANCA) private readonly servico: ServicoCobranca | null) {}

  private s(): ServicoCobranca {
    if (!this.servico)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'A cobrança por fonte pagadora exige o banco próprio do cliente.',
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

  @Get('faturamento/conferencia-cobranca')
  @Permissao('convenio.credenciamento.ler')
  conferencia(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const r = esquemaConferenciaCobranca.safeParse({
      fontePagadoraId: num(q['convenio']),
      planoId: num(q['plano']),
      itemId: num(q['item']),
      profissionalId: num(q['profissional']),
      prestadorId: num(q['prestador']),
      equipeIds: (q['equipes'] ?? '').split(',').filter(Boolean).map(Number),
      tipoContaId: num(q['tipoConta']),
      tipoAtendimento: q['atendimento'] || null,
      quantidade: num(q['quantidade']) ?? 1,
      data: q['data'],
    });
    if (!r.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Entrada inválida',
        r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    return this.rodar(() =>
      this.s().ler(ctxDe(req, 'conferencia-cobranca'), (l, est) => conferirCobrancaPropria(l, est, r.data)),
    );
  }

  @Get('faturamento/credenciamento/excecoes')
  @Permissao('convenio.credenciamento.ler')
  excecoes(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const conv = num(q['convenio']);
    return this.rodar(() =>
      this.s().ler(ctxDe(req, 'credenciamento-excecoes'), (l, est) =>
        excecoesCredenciamentoPropria(l, est, conv),
      ),
    );
  }

  @Post('faturamento/de-para')
  @HttpCode(201)
  @Permissao('convenio.contrato.editar')
  @AuditadoNoHandler(EXECUTOR)
  gravarDePara(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() => this.s().gravar('equivalencia-item', contextoOperacao(req, 'de-para'), corpo));
  }

  @Post('faturamento/de-para/:id/encerramento')
  @HttpCode(200)
  @Permissao('convenio.contrato.editar')
  @AuditadoNoHandler(EXECUTOR)
  encerrarDePara(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().gravar('equivalencia-item.encerrar', contextoOperacao(req, 'de-para'), {
        ...objeto(corpo),
        id: inteiro(id, 'id'),
      }),
    );
  }

  @Post('faturamento/credenciamento-cobranca')
  @HttpCode(201)
  @Permissao('convenio.credenciamento.editar')
  @AuditadoNoHandler(EXECUTOR)
  gravarCredenciamento(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().gravar('credenciamento', contextoOperacao(req, 'credenciamento-cobranca'), corpo),
    );
  }

  @Post('faturamento/credenciamento-cobranca/:id/encerramento')
  @HttpCode(200)
  @Permissao('convenio.credenciamento.editar')
  @AuditadoNoHandler(EXECUTOR)
  encerrarCredenciamento(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().gravar('credenciamento.encerrar', contextoOperacao(req, 'credenciamento-cobranca'), {
        ...objeto(corpo),
        id: inteiro(id, 'id'),
      }),
    );
  }

  @Post('faturamento/credenciamento/excecoes')
  @HttpCode(201)
  @Permissao('convenio.credenciamento.editar')
  @AuditadoNoHandler(EXECUTOR)
  gravarExcecao(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().gravar('excecao', contextoOperacao(req, 'credenciamento-excecoes'), corpo),
    );
  }

  @Post('faturamento/credenciamento/excecoes/:id/encerramento')
  @HttpCode(200)
  @Permissao('convenio.credenciamento.editar')
  @AuditadoNoHandler(EXECUTOR)
  encerrarExcecao(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().gravar('excecao.encerrar', contextoOperacao(req, 'credenciamento-excecoes'), {
        ...objeto(corpo),
        id: inteiro(id, 'id'),
      }),
    );
  }

  @Get('precos/matmed/referencia/:item/equivalencias')
  @Permissao('preco.tabela.ler')
  equivalenciasMatmed(@Param('item') item: string, @Req() req: RequisicaoAutorizada) {
    const i = inteiro(item, 'item');
    return this.rodar(() =>
      this.s().ler(ctxDe(req, 'matmed-equivalencias'), (l) => equivalenciasMatmedPropria(l, i)),
    );
  }

  @Post('precos/matmed/referencia/:item/equivalencias')
  @HttpCode(201)
  @Permissao('convenio.contrato.editar')
  @AuditadoNoHandler(EXECUTOR)
  gravarEquivalenciaMatmed(
    @Param('item') item: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.rodar(() =>
      this.s().gravar('equivalencia-matmed', contextoOperacao(req, 'matmed-equivalencias'), {
        ...objeto(corpo),
        itemReferenciaId: inteiro(item, 'item'),
      }),
    );
  }
}
