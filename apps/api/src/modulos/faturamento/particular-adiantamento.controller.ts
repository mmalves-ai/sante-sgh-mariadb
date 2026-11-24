// Adiantamento, caução e conta corrente do paciente (06-FAT linha 39) e modelo de orçamento padrão (06-FAT linha 40),
// só com o banco próprio do cliente.
//   GET  /api/faturamento/pacientes/:id/conta-corrente       faturamento.pagamento.ler (saldo, adiantamentos,
//                                                             aplicações, contas em aberto e extrato corrido)
//   POST /api/faturamento/adiantamentos                      faturamento.recibo.emitir (recebe no caixa aberto)
//   POST /api/faturamento/contas/:id/adiantamentos           faturamento.recibo.emitir (aplica o saldo na conta)
//   POST /api/faturamento/aplicacoes-adiantamento/:id/estorno faturamento.recibo.emitir (com motivo)
//   POST /api/faturamento/adiantamentos/:id/devolucoes       faturamento.recibo.emitir (devolve o saldo)
//   GET  /api/faturamento/modelos-orcamento                  faturamento.orcamento.ler
//   GET  /api/faturamento/modelos-orcamento/:id/previa       faturamento.orcamento.ler (montagem antes de gravar;
//                                                             ?precos=seq:valor só para a linha sem preço)
//   GET  /api/faturamento/modelos-orcamento/opcoes?termo=    faturamento.orcamento.ler (acomodações, funções, itens)
//   POST /api/faturamento/modelos-orcamento                  faturamento.regra.editar
//   POST /api/faturamento/modelos-orcamento/:id/inativacao   faturamento.regra.editar (com motivo)
//   POST /api/faturamento/modelos-orcamento/:id/orcamentos   faturamento.orcamento.criar (gera o orçamento)
// As gravações levam Idempotency-Key e passam pelo executor (trilha e autoria na mesma transação).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { ContextoNucleo, Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { recusa } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, ctxDe, inteiro, problemaDoPreco } from '../precos/base.js';
import {
  contaCorrentePaciente,
  gravarParticular,
  listarModelos,
  type NomeOperacaoParticular,
  opcoesDoModelo,
  previaComPrecos,
} from './particular-adiantamento-propria.js';

export const SERVICO_PARTICULAR_ADIANTAMENTO = Symbol('SERVICO_PARTICULAR_ADIANTAMENTO');
const EXECUTOR = 'executor: trilha e autoria na mesma transação';
const AMBIENTES_SIMULADOS: readonly string[] = ['dev', 'ci', 'teste', 'homologacao'];

export class ServicoParticularAdiantamento {
  private readonly executor: Executor;
  constructor(
    private readonly nucleo: NucleoProprio,
    /** O ambiente da configuração da API (ctx.configuracao.ambiente); ausente ou desconhecido vale produção. */
    ambiente: string | null | undefined,
  ) {
    this.executor = nucleo.criarExecutor({});
    this.simulado = AMBIENTES_SIMULADOS.includes((ambiente ?? '').trim());
  }
  /** Fora de produção, o conector de Pix e cartão é o simulado (nunca o real em dev, ci e homologação). */
  readonly simulado: boolean;
  ler<T>(ctx: ContextoNucleo, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = ctx.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(
      { cliente: ctx.cliente, estabelecimento: est, correlacao: ctx.correlacao },
      (l) => fn(l, est),
    );
  }
  gravar(
    nome: NomeOperacaoParticular,
    ctx: Parameters<typeof gravarParticular>[2],
    e: Record<string, unknown>,
  ) {
    const entrada = nome === 'adiantamento.receber' ? { ...e, simulado: this.simulado } : e;
    return gravarParticular(this.executor, nome, ctx, entrada);
  }
}

const objeto = (c: unknown): Record<string, unknown> =>
  c !== null && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {};

@Controller()
export class ParticularAdiantamentoController {
  constructor(
    @Inject(SERVICO_PARTICULAR_ADIANTAMENTO) private readonly servico: ServicoParticularAdiantamento | null,
  ) {}

  private s(): ServicoParticularAdiantamento {
    if (!this.servico)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'O caixa do particular exige o banco próprio.',
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
  private g(nome: NomeOperacaoParticular, req: RequisicaoAutorizada, e: Record<string, unknown>) {
    return this.rodar(() => this.s().gravar(nome, contextoOperacao(req, 'particular-adiantamento'), e));
  }

  @Get('faturamento/pacientes/:id/conta-corrente')
  @Permissao('faturamento.pagamento.ler')
  contaCorrente(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const p = inteiro(id, 'id');
    return this.rodar(() =>
      this.s().ler(ctxDe(req, 'particular-adiantamento'), (l, est) => contaCorrentePaciente(l, est, p)),
    );
  }

  @Post('faturamento/adiantamentos')
  @HttpCode(201)
  @Permissao('faturamento.recibo.emitir')
  @AuditadoNoHandler(EXECUTOR)
  receber(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    // O conector eletrônico é decidido pelo ambiente no serviço, nunca pelo corpo da requisição.
    return this.g('adiantamento.receber', req, objeto(corpo));
  }

  @Post('faturamento/contas/:id/adiantamentos')
  @HttpCode(201)
  @Permissao('faturamento.recibo.emitir')
  @AuditadoNoHandler(EXECUTOR)
  aplicar(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.g('adiantamento.aplicar', req, { ...objeto(corpo), contaId: inteiro(id, 'id') });
  }

  @Post('faturamento/aplicacoes-adiantamento/:id/estorno')
  @HttpCode(200)
  @Permissao('faturamento.recibo.emitir')
  @AuditadoNoHandler(EXECUTOR)
  estornar(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.g('adiantamento.estornar', req, { ...objeto(corpo), aplicacaoId: inteiro(id, 'id') });
  }

  @Post('faturamento/adiantamentos/:id/devolucoes')
  @HttpCode(201)
  @Permissao('faturamento.recibo.emitir')
  @AuditadoNoHandler(EXECUTOR)
  devolver(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.g('adiantamento.devolver', req, { ...objeto(corpo), adiantamentoId: inteiro(id, 'id') });
  }

  @Get('faturamento/modelos-orcamento')
  @Permissao('faturamento.orcamento.ler')
  modelos(@Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().ler(ctxDe(req, 'particular-adiantamento'), (l, est) => listarModelos(l, est)),
    );
  }

  @Get('faturamento/modelos-orcamento/opcoes')
  @Permissao('faturamento.orcamento.ler')
  opcoes(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().ler(ctxDe(req, 'particular-adiantamento'), (l) =>
        opcoesDoModelo(l, (termo ?? '').slice(0, 60)),
      ),
    );
  }

  @Get('faturamento/modelos-orcamento/:id/previa')
  @Permissao('faturamento.orcamento.ler')
  previa(
    @Param('id') id: string,
    @Query('precos') precos: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const m = inteiro(id, 'id');
    // precos=4:40,5:12.5 (sequência da linha sem preço → unitário digitado na hora), o mesmo que a gravação aceita.
    const informados: Record<string, number> = {};
    for (const par of (precos ?? '').split(',').filter(Boolean)) {
      const [k, v] = par.split(':');
      const valor = Number(v);
      if (!k || !/^\d+$/.test(k) || !Number.isFinite(valor) || valor < 0)
        throw new ErroProblema(
          'entrada-invalida',
          400,
          'Entrada inválida',
          'Preço da linha inválido na prévia.',
        );
      informados[k] = valor;
    }
    return this.rodar(() =>
      this.s().ler(ctxDe(req, 'particular-adiantamento'), async (l, est) => {
        const p = await previaComPrecos(l, est, m, informados);
        return { fonte: p.fonte, ...p.montado };
      }),
    );
  }

  @Post('faturamento/modelos-orcamento')
  @HttpCode(201)
  @Permissao('faturamento.regra.editar')
  @AuditadoNoHandler(EXECUTOR)
  cadastrarModelo(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.g('modelo.cadastrar', req, objeto(corpo));
  }

  @Post('faturamento/modelos-orcamento/:id/inativacao')
  @HttpCode(200)
  @Permissao('faturamento.regra.editar')
  @AuditadoNoHandler(EXECUTOR)
  inativarModelo(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.g('modelo.inativar', req, { ...objeto(corpo), modeloId: inteiro(id, 'id') });
  }

  @Post('faturamento/modelos-orcamento/:id/orcamentos')
  @HttpCode(201)
  @Permissao('faturamento.orcamento.criar')
  @AuditadoNoHandler(EXECUTOR)
  gerarOrcamento(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.g('modelo.gerarOrcamento', req, { ...objeto(corpo), modeloId: inteiro(id, 'id') });
  }
}
