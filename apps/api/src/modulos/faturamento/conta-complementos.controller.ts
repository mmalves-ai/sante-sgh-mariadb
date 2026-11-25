// Complementos da conta e da guia (F3.7, 06-FAT linhas 10 e 12), só com o banco próprio do cliente.
//   GET  /api/faturamento/contas/:id/periodos                 faturamento.conta.ler (com a sugestão do próximo)
//   POST /api/faturamento/contas/:id/periodos                 faturamento.item.lancar
//   POST /api/faturamento/periodos-conta/:pid/retirada       faturamento.item.lancar (motivo; fica marcado, não some)
//   GET  /api/faturamento/contas/:id/faturamento-por-periodo  faturamento.conta.ler (itens, valor e guias por período)
//   POST /api/faturamento/periodos-conta/:pid/fechamento     faturamento.conta.fechar (fechamento parcial da faixa)
//   POST /api/faturamento/periodos-conta/:pid/reabertura     faturamento.conta.reabrir (motivo; do último ao primeiro)
//   GET  /api/faturamento/contas/:id/segurado                 faturamento.conta.ler (gravado ou sugerido da cobertura)
//   POST /api/faturamento/contas/:id/segurado                 faturamento.item.lancar
//   GET  /api/faturamento/fontes/:fonte/atributos-guia        faturamento.conta.ler
//   POST /api/faturamento/fontes/:fonte/atributos-guia        convenio.contrato.editar (campo e opções num pedido)
//   GET  /api/faturamento/guias/:guia/atributos               faturamento.guia.ler (campos, valores e o que falta)
//   POST /api/faturamento/guias/:guia/atributos               faturamento.item.conferir
//   GET  /api/faturamento/contas/:id/guias-atributos          faturamento.guia.ler (guias da conta e o que falta)
// As gravações levam Idempotency-Key e passam pelo executor (trilha e autoria na mesma transação).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { ContextoNucleo, Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { recusa } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, ctxDe, inteiro, problemaDoPreco } from '../precos/base.js';
import {
  atributosFontePropria,
  atributosGuiaPropria,
  gravarComplementos,
  guiasAtributosContaPropria,
  type NomeOperacaoComplementos,
  periodosContaPropria,
  seguradoContaPropria,
} from './conta-complementos-propria.js';
import {
  faturamentoPorPeriodoPropria,
  gravarPeriodos,
  type NomeOperacaoPeriodos,
} from './conta-periodos-propria.js';

export const SERVICO_COMPLEMENTOS_CONTA = Symbol('SERVICO_COMPLEMENTOS_CONTA');
const EXECUTOR = 'executor: trilha e autoria na mesma transação';

export class ServicoComplementosConta {
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
  gravar(nome: NomeOperacaoComplementos, ctx: Parameters<typeof gravarComplementos>[2], e: unknown) {
    return gravarComplementos(this.executor, nome, ctx, e);
  }
  gravarPeriodo(nome: NomeOperacaoPeriodos, ctx: Parameters<typeof gravarPeriodos>[2], e: unknown) {
    return gravarPeriodos(this.executor, nome, ctx, e);
  }
}

const objeto = (c: unknown): Record<string, unknown> =>
  c !== null && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {};

@Controller()
export class ComplementosContaController {
  constructor(
    @Inject(SERVICO_COMPLEMENTOS_CONTA) private readonly servico: ServicoComplementosConta | null,
  ) {}

  private s(): ServicoComplementosConta {
    if (!this.servico)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'Os complementos da conta exigem o banco próprio.',
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

  @Get('faturamento/contas/:id/periodos')
  @Permissao('faturamento.conta.ler')
  periodos(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const c = inteiro(id, 'id');
    return this.rodar(() =>
      this.s().ler(ctxDe(req, 'conta-periodos'), (l, est) => periodosContaPropria(l, est, c)),
    );
  }

  @Post('faturamento/contas/:id/periodos')
  @HttpCode(201)
  @Permissao('faturamento.item.lancar')
  @AuditadoNoHandler(EXECUTOR)
  incluirPeriodo(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().gravar('periodo.incluir', contextoOperacao(req, 'conta-periodos'), {
        ...objeto(corpo),
        contaId: inteiro(id, 'id'),
      }),
    );
  }

  @Post('faturamento/periodos-conta/:pid/retirada')
  @HttpCode(200)
  @Permissao('faturamento.item.lancar')
  @AuditadoNoHandler(EXECUTOR)
  retirarPeriodo(@Param('pid') pid: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().gravar('periodo.retirar', contextoOperacao(req, 'conta-periodos'), {
        ...objeto(corpo),
        id: inteiro(pid, 'pid'),
      }),
    );
  }

  @Get('faturamento/contas/:id/faturamento-por-periodo')
  @Permissao('faturamento.conta.ler')
  faturamentoPorPeriodo(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const c = inteiro(id, 'id');
    return this.rodar(() =>
      this.s().ler(ctxDe(req, 'conta-periodos'), (l, est) => faturamentoPorPeriodoPropria(l, est, c)),
    );
  }

  @Post('faturamento/periodos-conta/:pid/fechamento')
  @HttpCode(200)
  @Permissao('faturamento.conta.fechar')
  @AuditadoNoHandler(EXECUTOR)
  fecharPeriodo(@Param('pid') pid: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().gravarPeriodo('periodo.fechar', contextoOperacao(req, 'conta-periodos'), {
        ...objeto(corpo),
        id: inteiro(pid, 'pid'),
      }),
    );
  }

  @Post('faturamento/periodos-conta/:pid/reabertura')
  @HttpCode(200)
  @Permissao('faturamento.conta.reabrir')
  @AuditadoNoHandler(EXECUTOR)
  reabrirPeriodo(@Param('pid') pid: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().gravarPeriodo('periodo.reabrir', contextoOperacao(req, 'conta-periodos'), {
        ...objeto(corpo),
        id: inteiro(pid, 'pid'),
      }),
    );
  }

  @Get('faturamento/contas/:id/segurado')
  @Permissao('faturamento.conta.ler')
  segurado(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const c = inteiro(id, 'id');
    return this.rodar(() =>
      this.s().ler(ctxDe(req, 'conta-segurado'), (l, est) => seguradoContaPropria(l, est, c)),
    );
  }

  @Post('faturamento/contas/:id/segurado')
  @HttpCode(200)
  @Permissao('faturamento.item.lancar')
  @AuditadoNoHandler(EXECUTOR)
  gravarSegurado(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().gravar('segurado', contextoOperacao(req, 'conta-segurado'), {
        ...objeto(corpo),
        contaId: inteiro(id, 'id'),
      }),
    );
  }

  @Get('faturamento/fontes/:fonte/atributos-guia')
  @Permissao('faturamento.conta.ler')
  atributos(@Param('fonte') fonte: string, @Req() req: RequisicaoAutorizada) {
    const f = inteiro(fonte, 'fonte');
    return this.rodar(() => this.s().ler(ctxDe(req, 'atributos-guia'), (l) => atributosFontePropria(l, f)));
  }

  @Post('faturamento/fontes/:fonte/atributos-guia')
  @HttpCode(200)
  @Permissao('convenio.contrato.editar')
  @AuditadoNoHandler(EXECUTOR)
  gravarAtributo(@Param('fonte') fonte: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().gravar('atributo', contextoOperacao(req, 'atributos-guia'), {
        ...objeto(corpo),
        fontePagadoraId: inteiro(fonte, 'fonte'),
      }),
    );
  }

  @Get('faturamento/guias/:guia/atributos')
  @Permissao('faturamento.guia.ler')
  atributosGuia(@Param('guia') guia: string, @Req() req: RequisicaoAutorizada) {
    const g = inteiro(guia, 'guia');
    return this.rodar(() =>
      this.s().ler(ctxDe(req, 'guia-atributos'), (l, est) => atributosGuiaPropria(l, est, g)),
    );
  }

  @Get('faturamento/contas/:id/guias-atributos')
  @Permissao('faturamento.guia.ler')
  guiasAtributos(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const c = inteiro(id, 'id');
    return this.rodar(() =>
      this.s().ler(ctxDe(req, 'conta-guias-atributos'), (l, est) => guiasAtributosContaPropria(l, est, c)),
    );
  }

  @Post('faturamento/guias/:guia/atributos')
  @HttpCode(200)
  @Permissao('faturamento.item.conferir')
  @AuditadoNoHandler(EXECUTOR)
  gravarAtributosGuia(@Param('guia') guia: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().gravar('guia.atributos', contextoOperacao(req, 'guia-atributos'), {
        ...objeto(corpo),
        guiaId: inteiro(guia, 'guia'),
      }),
    );
  }
}
