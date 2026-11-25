// Regras de apresentação TISS por fonte pagadora (06-FAT linha 30): leitura e gravações. A aplicação no lote fica em
// faturamento.gerarLote (operacoes.ts → apresentacao-propria.ts).
//   GET  /api/faturamento/tiss/apresentacao?convenio                 convenio.contrato.ler (regras, itens e valores padrão)
//   GET  /api/faturamento/tiss/apresentacao/opcoes                   convenio.contrato.ler (combos da tela de cadastro)
//   POST /api/faturamento/tiss/apresentacao/regras                   convenio.contrato.editar (inclui ou altera a regra)
//   POST /api/faturamento/tiss/apresentacao/itens                    convenio.contrato.editar (o que vai em cada guia)
//   POST /api/faturamento/tiss/apresentacao/itens/:id/desativacao    convenio.contrato.editar (nunca apaga)
//   POST /api/faturamento/tiss/apresentacao/valores-padrao           convenio.contrato.editar (validado no domínio TISS)
//   POST /api/faturamento/tiss/apresentacao/valores-padrao/:id/encerramento   convenio.contrato.editar
// As gravações levam Idempotency-Key e passam pelo executor (trilha e autoria na mesma transação).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { ContextoNucleo, Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { recusa } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, ctxDe, inteiro, problemaDoPreco } from '../precos/base.js';
import {
  gravarApresentacao,
  lerApresentacao,
  lerOpcoesApresentacao,
  type NomeOperacaoApresentacao,
} from './apresentacao-propria.js';

export const SERVICO_APRESENTACAO_TISS = Symbol('SERVICO_APRESENTACAO_TISS');
const EXECUTOR = 'executor: trilha e autoria na mesma transação';

/** Leitura e gravação da regra de apresentação sobre o banco próprio. */
export class ServicoApresentacaoTiss {
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
  gravar(nome: NomeOperacaoApresentacao, ctx: Parameters<typeof gravarApresentacao>[2], e: unknown) {
    return gravarApresentacao(this.executor, nome, ctx, e);
  }
}

const objeto = (c: unknown): Record<string, unknown> =>
  c !== null && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {};

@Controller('faturamento/tiss/apresentacao')
export class ApresentacaoTissController {
  constructor(@Inject(SERVICO_APRESENTACAO_TISS) private readonly servico: ServicoApresentacaoTiss | null) {}

  private s(): ServicoApresentacaoTiss {
    if (!this.servico)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'A regra de apresentação TISS exige o banco próprio do cliente.',
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

  @Get()
  @Permissao('convenio.contrato.ler')
  ler(@Query('convenio') convenio: string | undefined, @Req() req: RequisicaoAutorizada) {
    const c = inteiro(convenio ?? '', 'convenio');
    return this.rodar(() =>
      this.s().ler(ctxDe(req, 'apresentacao-tiss'), (l, est) => lerApresentacao(l, est, c)),
    );
  }

  @Get('opcoes')
  @Permissao('convenio.contrato.ler')
  opcoes(@Req() req: RequisicaoAutorizada) {
    return this.rodar(() => this.s().ler(ctxDe(req, 'apresentacao-tiss'), (l) => lerOpcoesApresentacao(l)));
  }

  @Post('regras')
  @HttpCode(201)
  @Permissao('convenio.contrato.editar')
  @AuditadoNoHandler(EXECUTOR)
  gravarRegra(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() => this.s().gravar('regra', contextoOperacao(req, 'apresentacao-tiss'), corpo));
  }

  @Post('itens')
  @HttpCode(201)
  @Permissao('convenio.contrato.editar')
  @AuditadoNoHandler(EXECUTOR)
  incluirItem(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() => this.s().gravar('regra-item', contextoOperacao(req, 'apresentacao-tiss'), corpo));
  }

  @Post('itens/:id/desativacao')
  @HttpCode(200)
  @Permissao('convenio.contrato.editar')
  @AuditadoNoHandler(EXECUTOR)
  desativarItem(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().gravar('regra-item.desativar', contextoOperacao(req, 'apresentacao-tiss'), {
        ...objeto(corpo),
        id: inteiro(id, 'id'),
      }),
    );
  }

  @Post('valores-padrao')
  @HttpCode(201)
  @Permissao('convenio.contrato.editar')
  @AuditadoNoHandler(EXECUTOR)
  incluirPadrao(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().gravar('valor-padrao', contextoOperacao(req, 'apresentacao-tiss'), corpo),
    );
  }

  @Post('valores-padrao/:id/encerramento')
  @HttpCode(200)
  @Permissao('convenio.contrato.editar')
  @AuditadoNoHandler(EXECUTOR)
  encerrarPadrao(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().gravar('valor-padrao.encerrar', contextoOperacao(req, 'apresentacao-tiss'), {
        ...objeto(corpo),
        id: inteiro(id, 'id'),
      }),
    );
  }
}
