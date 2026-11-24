// Regras comerciais configuráveis da conta (F8, 06-FAT linhas 13, 19 e 23), só com o banco próprio.
//   GET  /api/faturamento/regras-comerciais                         faturamento.regra.ler (regras e opções dos combos)
//   GET  /api/faturamento/regras-comerciais/simulacao?atendimento=   faturamento.regra.ler (que regra de conta vale)
//   POST /api/faturamento/regras-comerciais/contas                  faturamento.regra.editar (criação e quebra de conta)
//   POST /api/faturamento/regras-comerciais/descontos-volume        faturamento.regra.editar (desconto por volume e faixas)
//   POST /api/faturamento/regras-comerciais/franquias               convenio.contrato.editar (franquia no acordo)
//   POST /api/faturamento/regras-comerciais/ambulancia              faturamento.regra.editar (remoção por km ou trajeto)
//   POST /api/faturamento/regras-comerciais/ligacao                 faturamento.regra.editar (ligação tarifada)
//   GET  /api/faturamento/contas/:id/comercial?vinculo=             faturamento.conta.ler (prévia, aplicados, ligações)
//   POST /api/faturamento/contas/:id/franquia-desconto              faturamento.item.lancar (aplica na conta)
//   POST /api/faturamento/contas/:id/remocoes                       faturamento.item.lancar (lança a remoção)
//   POST /api/faturamento/contas/:id/ligacoes/lancamento            faturamento.item.lancar (lança as pendentes)
//   POST /api/faturamento/ligacoes-tarifadas                        faturamento.item.lancar (registra a ligação)
// As gravações levam Idempotency-Key e passam pelo executor (trilha e autoria na mesma transação).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { ContextoNucleo, Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { recusa } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, ctxDe, inteiro, problemaDoPreco } from '../precos/base.js';
import {
  comercialDaContaPropria,
  gravarRegrasComerciais,
  type NomeOperacaoRegrasComerciais,
  regrasComerciaisPropria,
  simularRegraContaPropria,
} from './regras-comerciais-propria.js';

export const SERVICO_REGRAS_COMERCIAIS = Symbol('SERVICO_REGRAS_COMERCIAIS');
const EXECUTOR = 'executor: trilha e autoria na mesma transação';
const ORIGEM = 'regras-comerciais';

export class ServicoRegrasComerciais {
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
  gravar(nome: NomeOperacaoRegrasComerciais, ctx: Parameters<typeof gravarRegrasComerciais>[2], e: unknown) {
    return gravarRegrasComerciais(this.executor, nome, ctx, e);
  }
}

const objeto = (c: unknown): Record<string, unknown> =>
  c !== null && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {};

@Controller()
export class RegrasComerciaisController {
  constructor(@Inject(SERVICO_REGRAS_COMERCIAIS) private readonly servico: ServicoRegrasComerciais | null) {}

  private s(): ServicoRegrasComerciais {
    if (!this.servico)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'As regras comerciais da conta exigem o banco próprio.',
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
  private g(nome: NomeOperacaoRegrasComerciais, req: RequisicaoAutorizada, corpo: unknown) {
    return this.rodar(() => this.s().gravar(nome, contextoOperacao(req, ORIGEM), corpo));
  }

  @Get('faturamento/regras-comerciais')
  @Permissao('faturamento.regra.ler')
  listar(@Req() req: RequisicaoAutorizada) {
    return this.rodar(() => this.s().ler(ctxDe(req, ORIGEM), (l, est) => regrasComerciaisPropria(l, est)));
  }

  @Get('faturamento/regras-comerciais/simulacao')
  @Permissao('faturamento.regra.ler')
  simular(
    @Query('atendimento') atendimento: string,
    @Query('item') item: string | undefined,
    @Query('data') data: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const a = inteiro(atendimento, 'atendimento');
    const i = item ? inteiro(item, 'item') : null;
    const d = data && /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : null;
    return this.rodar(() =>
      this.s().ler(ctxDe(req, ORIGEM), (l, est) =>
        simularRegraContaPropria(l, est, a, { itemId: i, data: d }),
      ),
    );
  }

  @Post('faturamento/regras-comerciais/contas')
  @HttpCode(200)
  @Permissao('faturamento.regra.editar')
  @AuditadoNoHandler(EXECUTOR)
  salvarRegraConta(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.g('salvar-regra-conta', req, objeto(corpo));
  }

  @Post('faturamento/regras-comerciais/descontos-volume')
  @HttpCode(200)
  @Permissao('faturamento.regra.editar')
  @AuditadoNoHandler(EXECUTOR)
  salvarDesconto(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.g('salvar-desconto-volume', req, objeto(corpo));
  }

  @Post('faturamento/regras-comerciais/franquias')
  @HttpCode(200)
  @Permissao('convenio.contrato.editar')
  @AuditadoNoHandler(EXECUTOR)
  salvarFranquia(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.g('salvar-franquia', req, objeto(corpo));
  }

  @Post('faturamento/regras-comerciais/ambulancia')
  @HttpCode(200)
  @Permissao('faturamento.regra.editar')
  @AuditadoNoHandler(EXECUTOR)
  salvarAmbulancia(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.g('salvar-regra-ambulancia', req, objeto(corpo));
  }

  @Post('faturamento/regras-comerciais/ligacao')
  @HttpCode(200)
  @Permissao('faturamento.regra.editar')
  @AuditadoNoHandler(EXECUTOR)
  salvarLigacao(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.g('salvar-regra-ligacao', req, objeto(corpo));
  }

  @Get('faturamento/contas/:id/comercial')
  @Permissao('faturamento.conta.ler')
  daConta(
    @Param('id') id: string,
    @Query('vinculo') vinculo: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const c = inteiro(id, 'id');
    return this.rodar(() =>
      this.s().ler(ctxDe(req, ORIGEM), (l, est) => comercialDaContaPropria(l, est, c, vinculo ?? 'titular')),
    );
  }

  @Post('faturamento/contas/:id/franquia-desconto')
  @HttpCode(200)
  @Permissao('faturamento.item.lancar')
  @AuditadoNoHandler(EXECUTOR)
  aplicar(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.g('aplicar-comercial', req, { ...objeto(corpo), contaId: inteiro(id, 'id') });
  }

  @Post('faturamento/contas/:id/remocoes')
  @HttpCode(200)
  @Permissao('faturamento.item.lancar')
  @AuditadoNoHandler(EXECUTOR)
  remocao(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.g('lancar-remocao', req, { ...objeto(corpo), contaId: inteiro(id, 'id') });
  }

  @Post('faturamento/contas/:id/ligacoes/lancamento')
  @HttpCode(200)
  @Permissao('faturamento.item.lancar')
  @AuditadoNoHandler(EXECUTOR)
  ligacoes(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    return this.g('lancar-ligacoes', req, { contaId: inteiro(id, 'id') });
  }

  @Post('faturamento/ligacoes-tarifadas')
  @HttpCode(200)
  @Permissao('faturamento.item.lancar')
  @AuditadoNoHandler(EXECUTOR)
  registrarLigacao(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.g('registrar-ligacao', req, objeto(corpo));
  }
}
