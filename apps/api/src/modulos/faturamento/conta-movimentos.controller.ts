// Movimentos da conta (F3.7, 06-FAT linhas 14, 15 e 16), só com o banco próprio do cliente.
//   GET  /api/faturamento/contas/:id/movimentos          faturamento.conta.ler (itens com equipe, funções, kits,
//                                                         contas de destino do paciente e transferências)
//                                                         (conta de outro estabelecimento só a quem pode ler lá)
//   GET  /api/faturamento/profissionais-equipe?termo=     faturamento.item.lancar (busca por nome ou inscrição)
//   POST /api/faturamento/itens/:item/equipe             faturamento.item.lancar (a equipe inteira do item)
//   POST /api/faturamento/contas/:id/itens-com-equipe    faturamento.item.lancar (item manual e a equipe, juntos)
//   POST /api/faturamento/contas/:id/kits                faturamento.item.lancar (lança um kit de cobrança)
//   POST /api/faturamento/kits                           faturamento.regra.editar (cadastro do kit com os componentes)
//   GET  /api/faturamento/itens-cobranca?termo=          faturamento.regra.editar (itens para o cadastro do kit)
//   POST /api/faturamento/contas/:id/transferencias      faturamento.auditoria.ajustar (itens para outra conta)
// As gravações levam Idempotency-Key e passam pelo executor (trilha e autoria na mesma transação).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { ContextoNucleo, Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { recusa } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, ctxDe, inteiro, problemaDoPreco } from '../precos/base.js';
import {
  buscarItensCobrancaPropria,
  buscarProfissionaisPropria,
  gravarMovimentos,
  movimentosContaPropria,
  type NomeOperacaoMovimentos,
} from './conta-movimentos-propria.js';

export const SERVICO_MOVIMENTOS_CONTA = Symbol('SERVICO_MOVIMENTOS_CONTA');
const EXECUTOR = 'executor: trilha e autoria na mesma transação';

export class ServicoMovimentosConta {
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
  gravar(nome: NomeOperacaoMovimentos, ctx: Parameters<typeof gravarMovimentos>[2], e: unknown) {
    return gravarMovimentos(this.executor, nome, ctx, e);
  }
}

const objeto = (c: unknown): Record<string, unknown> =>
  c !== null && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {};

@Controller()
export class MovimentosContaController {
  constructor(@Inject(SERVICO_MOVIMENTOS_CONTA) private readonly servico: ServicoMovimentosConta | null) {}

  private s(): ServicoMovimentosConta {
    if (!this.servico)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'Os movimentos da conta exigem o banco próprio.',
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

  @Get('faturamento/contas/:id/movimentos')
  @Permissao('faturamento.conta.ler')
  movimentos(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const c = inteiro(id, 'id');
    const ctx = ctxDe(req, 'conta-movimentos');
    const acesso = { usuario: ctx.usuario, total: req.sgh?.sessao.usuario.ator === 'plataforma' };
    return this.rodar(() => this.s().ler(ctx, (l, est) => movimentosContaPropria(l, est, c, acesso)));
  }

  @Get('faturamento/profissionais-equipe')
  @Permissao('faturamento.item.lancar')
  profissionaisEquipe(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().ler(ctxDe(req, 'conta-movimentos'), (l) => buscarProfissionaisPropria(l, String(termo ?? ''))),
    );
  }

  @Get('faturamento/itens-cobranca')
  @Permissao('faturamento.regra.editar')
  itensCobranca(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().ler(ctxDe(req, 'conta-movimentos'), (l) => buscarItensCobrancaPropria(l, String(termo ?? ''))),
    );
  }

  @Post('faturamento/itens/:item/equipe')
  @HttpCode(200)
  @Permissao('faturamento.item.lancar')
  @AuditadoNoHandler(EXECUTOR)
  equipe(@Param('item') item: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().gravar('equipe', contextoOperacao(req, 'conta-movimentos'), {
        ...objeto(corpo),
        itemId: inteiro(item, 'item'),
      }),
    );
  }

  @Post('faturamento/contas/:id/itens-com-equipe')
  @HttpCode(201)
  @Permissao('faturamento.item.lancar')
  @AuditadoNoHandler(EXECUTOR)
  lancarComEquipe(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().gravar('lancar.equipe', contextoOperacao(req, 'conta-movimentos'), {
        ...objeto(corpo),
        conta: inteiro(id, 'id'),
      }),
    );
  }

  @Post('faturamento/contas/:id/kits')
  @HttpCode(201)
  @Permissao('faturamento.item.lancar')
  @AuditadoNoHandler(EXECUTOR)
  lancarKit(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().gravar('kit.lancar', contextoOperacao(req, 'conta-movimentos'), {
        ...objeto(corpo),
        contaId: inteiro(id, 'id'),
      }),
    );
  }

  @Post('faturamento/kits')
  @HttpCode(201)
  @Permissao('faturamento.regra.editar')
  @AuditadoNoHandler(EXECUTOR)
  cadastrarKit(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().gravar('kit.cadastrar', contextoOperacao(req, 'conta-movimentos'), objeto(corpo)),
    );
  }

  @Post('faturamento/contas/:id/transferencias')
  @HttpCode(201)
  @Permissao('faturamento.auditoria.ajustar')
  @AuditadoNoHandler(EXECUTOR)
  transferir(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().gravar('transferir', contextoOperacao(req, 'conta-movimentos'), {
        ...objeto(corpo),
        contaOrigemId: inteiro(id, 'id'),
      }),
    );
  }
}
