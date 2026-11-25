// Transferência da conta inteira, por lote e estorno (F3.7, 06-FAT linha 14), só com o banco próprio do cliente.
//   GET  /api/faturamento/contas/:id/transferencia-painel   faturamento.conta.ler (fontes e planos, outras contas do
//        ?contaDestinoId=&fontePagadoraId=&planoId=&desde=  paciente, sugestão pela troca de convênio da internação,
//                                                           transferências e a prévia da cobertura no destino)
//   POST /api/faturamento/contas/:id/transferencia-conta    faturamento.auditoria.ajustar (a conta inteira, para uma
//                                                           conta do paciente ou para uma conta nova na nova fonte)
//   POST /api/faturamento/transferencias/lote               faturamento.auditoria.ajustar (várias contas de uma vez)
//   POST /api/faturamento/transferencias/:id/estorno        faturamento.auditoria.ajustar (desfaz, sem apagar)
// As gravações levam Idempotency-Key e passam pelo executor (trilha e autoria na mesma transação).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { ContextoNucleo, Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { recusa } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, ctxDe, inteiro, problemaDoPreco } from '../precos/base.js';
import {
  type NomeOperacaoTransferencia,
  OPERACOES_TRANSFERENCIA,
  painelTransferenciaPropria,
} from './conta-transferencia-propria.js';

export const SERVICO_TRANSFERENCIA_CONTA = Symbol('SERVICO_TRANSFERENCIA_CONTA');
const EXECUTOR = 'executor: trilha e autoria na mesma transação';

export class ServicoTransferenciaConta {
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
    nome: NomeOperacaoTransferencia,
    ctx: ReturnType<typeof contextoOperacao>,
    e: unknown,
  ): Promise<Record<string, unknown>> {
    const op = OPERACOES_TRANSFERENCIA[nome] as Parameters<Executor['executar']>[0];
    const r = await this.executor.executar(op, ctx.cliente, e, ctx);
    return r.resultado as Record<string, unknown>;
  }
}

const objeto = (c: unknown): Record<string, unknown> =>
  c !== null && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {};
const opcional = (v: string | undefined, campo: string) => (v ? inteiro(v, campo) : null);

@Controller()
export class TransferenciaContaController {
  constructor(
    @Inject(SERVICO_TRANSFERENCIA_CONTA) private readonly servico: ServicoTransferenciaConta | null,
  ) {}

  private s(): ServicoTransferenciaConta {
    if (!this.servico)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'A transferência da conta exige o banco próprio.',
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

  @Get('faturamento/contas/:id/transferencia-painel')
  @Permissao('faturamento.conta.ler')
  painel(
    @Param('id') id: string,
    @Query('contaDestinoId') contaDestinoId: string | undefined,
    @Query('fontePagadoraId') fontePagadoraId: string | undefined,
    @Query('planoId') planoId: string | undefined,
    @Query('desde') desde: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const c = inteiro(id, 'id');
    const ctx = ctxDe(req, 'conta-transferencia');
    const acesso = { usuario: ctx.usuario, total: req.sgh?.sessao.usuario.ator === 'plataforma' };
    const previa = {
      contaDestinoId: opcional(contaDestinoId, 'contaDestinoId'),
      fontePagadoraId: opcional(fontePagadoraId, 'fontePagadoraId'),
      planoId: opcional(planoId, 'planoId'),
      desde: desde && /^\d{4}-\d{2}-\d{2}$/.test(desde) ? desde : null,
    };
    return this.rodar(() =>
      this.s().ler(ctx, (l, est) => painelTransferenciaPropria(l, est, c, acesso, previa)),
    );
  }

  @Post('faturamento/contas/:id/transferencia-conta')
  @HttpCode(201)
  @Permissao('faturamento.auditoria.ajustar')
  @AuditadoNoHandler(EXECUTOR)
  transferirConta(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().gravar('conta', contextoOperacao(req, 'conta-transferencia'), {
        ...objeto(corpo),
        contaOrigemId: inteiro(id, 'id'),
      }),
    );
  }

  @Post('faturamento/transferencias/lote')
  @HttpCode(201)
  @Permissao('faturamento.auditoria.ajustar')
  @AuditadoNoHandler(EXECUTOR)
  transferirLote(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().gravar('lote', contextoOperacao(req, 'conta-transferencia'), objeto(corpo)),
    );
  }

  @Post('faturamento/transferencias/:id/estorno')
  @HttpCode(200)
  @Permissao('faturamento.auditoria.ajustar')
  @AuditadoNoHandler(EXECUTOR)
  estornar(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().gravar('estorno', contextoOperacao(req, 'conta-transferencia'), {
        ...objeto(corpo),
        transferenciaId: inteiro(id, 'id'),
      }),
    );
  }
}
