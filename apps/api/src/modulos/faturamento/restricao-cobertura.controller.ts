// Restrição de cobertura por fonte pagadora e compatibilidade entre procedimentos (F7, 09-AREA linha 76), só com o
// banco próprio do cliente.
//   GET  /api/faturamento/cobertura?fonte=                         faturamento.regra.ler (restrições, pares e opções)
//   GET  /api/faturamento/cobertura/itens?termo=                   faturamento.regra.ler (busca de item faturável)
//   POST /api/faturamento/cobertura/restricoes                     faturamento.regra.editar (incluir ou alterar)
//   POST /api/faturamento/cobertura/pares                          faturamento.regra.editar (incluir ou alterar)
//   POST /api/faturamento/cobertura/justificativas                 faturamento.regra.editar
//   GET  /api/faturamento/cobertura/atendimentos/:id/excecoes      faturamento.conta.ler (visão do atendimento)
//   POST /api/faturamento/cobertura/atendimentos/:id/excecoes      faturamento.auditoria.ajustar (liberar)
//   POST /api/faturamento/cobertura/excecoes/:xid/revogacao        faturamento.auditoria.ajustar
//   POST /api/faturamento/cobertura/conferencia                    pep.prescricao.criar (aviso na prescrição, só leitura)
//   POST /api/faturamento/cobertura/previa                         faturamento.item.lancar (prévia antes de lançar)
// As gravações levam Idempotency-Key e passam pelo executor (trilha e autoria na mesma transação).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { ContextoNucleo, Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { recusa } from '@sgh/nucleo';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, ctxDe, inteiro, problemaDoPreco } from '../precos/base.js';
import {
  avaliarCoberturaPropria,
  buscarItensCobertura,
  excecoesAtendimentoPropria,
  gravarCobertura,
  type NomeOperacaoCobertura,
  painelCoberturaPropria,
} from './restricao-cobertura-propria.js';

export const SERVICO_COBERTURA = Symbol('SERVICO_COBERTURA');
const EXECUTOR = 'executor: trilha e autoria na mesma transação';
const SO_LEITURA = 'consulta só leitura: não muda estado (leitura em transação somente leitura)';

export class ServicoCobertura {
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
  gravar(nome: NomeOperacaoCobertura, ctx: Parameters<typeof gravarCobertura>[2], e: unknown) {
    return gravarCobertura(this.executor, nome, ctx, e);
  }
}

const objeto = (c: unknown): Record<string, unknown> =>
  c !== null && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {};

const esquemaConferencia = z
  .object({
    atendimentoId: z.number().int().positive(),
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    hora: z.string().regex(/^\d{2}:\d{2}$/),
    setorId: z.number().int().positive().nullable().default(null),
    profissionalId: z.number().int().positive().nullable().default(null),
    itens: z
      .array(
        z
          .object({
            codigo: z.string().trim().min(1).max(20).optional(),
            itemId: z.number().int().positive().optional(),
            /** Item da prescrição (medicamento, solução, insulina): o servidor resolve o item faturável. */
            itemPrescritivelId: z.number().int().positive().optional(),
            /** Cuidado ou procedimento de enfermagem prescrito: resolvido pelo item prescritível ligado. */
            cuidadoId: z.number().int().positive().optional(),
            quantidade: z.number().positive().max(99_999).default(1),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

@Controller()
export class CoberturaController {
  constructor(@Inject(SERVICO_COBERTURA) private readonly servico: ServicoCobertura | null) {}

  private s(): ServicoCobertura {
    if (!this.servico)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'A restrição de cobertura exige o banco próprio.',
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
  private gravar(
    nome: NomeOperacaoCobertura,
    req: RequisicaoAutorizada,
    corpo: unknown,
    extra: Record<string, unknown>,
  ) {
    return this.rodar(() =>
      this.s().gravar(nome, contextoOperacao(req, 'cobertura'), { ...objeto(corpo), ...extra }),
    );
  }
  private conferir(corpo: unknown, req: RequisicaoAutorizada, contexto: 'lancamento' | 'prescricao') {
    const p = esquemaConferencia.safeParse(corpo);
    if (!p.success)
      throw new ErroProblema(
        'entrada-invalida',
        422,
        'Pedido inválido',
        'Informe o atendimento, a data e os itens.',
      );
    return this.rodar(() =>
      this.s().ler(ctxDe(req, 'cobertura'), (l, est) =>
        avaliarCoberturaPropria(l, est, { ...p.data, contexto }),
      ),
    );
  }

  @Get('faturamento/cobertura')
  @Permissao('faturamento.regra.ler')
  painel(@Query('fonte') fonte: string | undefined, @Req() req: RequisicaoAutorizada) {
    const f = fonte ? inteiro(fonte, 'fonte') : null;
    return this.rodar(() =>
      this.s().ler(ctxDe(req, 'cobertura'), (l, est) => painelCoberturaPropria(l, est, f)),
    );
  }

  @Get('faturamento/cobertura/itens')
  @Permissao('faturamento.regra.ler')
  itens(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().ler(ctxDe(req, 'cobertura'), (l) => buscarItensCobertura(l, termo ?? '')),
    );
  }

  @Post('faturamento/cobertura/restricoes')
  @HttpCode(200)
  @Permissao('faturamento.regra.editar')
  @AuditadoNoHandler(EXECUTOR)
  restricao(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('restricao.gravar', req, corpo, {});
  }

  @Post('faturamento/cobertura/pares')
  @HttpCode(200)
  @Permissao('faturamento.regra.editar')
  @AuditadoNoHandler(EXECUTOR)
  par(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('par.gravar', req, corpo, {});
  }

  @Post('faturamento/cobertura/justificativas')
  @HttpCode(201)
  @Permissao('faturamento.regra.editar')
  @AuditadoNoHandler(EXECUTOR)
  justificativa(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('justificativa.gravar', req, corpo, {});
  }

  @Get('faturamento/cobertura/atendimentos/:id/excecoes')
  @Permissao('faturamento.conta.ler')
  excecoes(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const a = inteiro(id, 'id');
    return this.rodar(() =>
      this.s().ler(ctxDe(req, 'cobertura'), (l, est) => excecoesAtendimentoPropria(l, est, a)),
    );
  }

  @Post('faturamento/cobertura/atendimentos/:id/excecoes')
  @HttpCode(201)
  @Permissao('faturamento.auditoria.ajustar')
  @AuditadoNoHandler(EXECUTOR)
  liberar(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('excecao.registrar', req, corpo, { atendimentoId: inteiro(id, 'id') });
  }

  @Post('faturamento/cobertura/excecoes/:xid/revogacao')
  @HttpCode(200)
  @Permissao('faturamento.auditoria.ajustar')
  @AuditadoNoHandler(EXECUTOR)
  revogar(@Param('xid') xid: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('excecao.revogar', req, corpo, { id: inteiro(xid, 'xid') });
  }

  /** O aviso na prescrição: só leitura, e o bloqueio vira alerta (o ato assistencial não é impedido). */
  @Post('faturamento/cobertura/conferencia')
  @HttpCode(200)
  @Permissao('pep.prescricao.criar')
  @AuditadoNoHandler(SO_LEITURA)
  conferencia(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.conferir(corpo, req, 'prescricao');
  }

  /** A prévia do lançamento na conta (o que bloquearia e o que avisaria), só leitura. */
  @Post('faturamento/cobertura/previa')
  @HttpCode(200)
  @Permissao('faturamento.item.lancar')
  @AuditadoNoHandler(SO_LEITURA)
  previa(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.conferir(corpo, req, 'lancamento');
  }
}
