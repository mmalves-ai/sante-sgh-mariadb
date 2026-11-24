// Ajustes de valor na conta (F3.7, 06-FAT linhas 17, 18 e 20), só com o banco próprio do cliente.
//   GET  /api/faturamento/contas/:id/ajustes                    faturamento.conta.ler (ajustes, motivos, prévia do horário)
//   POST /api/faturamento/contas/:id/horario-especial           faturamento.item.lancar (aplica e refaz o total)
//   GET  /api/faturamento/horario-especial?tabela=              faturamento.conta.ler (faixas e expediente da tabela)
//   POST /api/faturamento/horario-especial                      convenio.contrato.editar (faixa)
//   POST /api/faturamento/tabelas/:tabela/expediente            convenio.contrato.editar
//   POST /api/faturamento/motivos-ajuste                        faturamento.regra.editar
//   POST /api/faturamento/contas/:id/ajustes                    faturamento.item.lancar (pedido de acréscimo ou desconto)
//   POST /api/faturamento/ajustes-conta/:aid/decisao            faturamento.auditoria.ajustar (aprovar ou recusar)
//   POST /api/faturamento/ajustes-conta/:aid/cancelamento       faturamento.item.lancar (só quem pediu)
//   GET  /api/faturamento/contas/:id/pacotes                    faturamento.conta.ler
//   POST /api/faturamento/contas/:id/pacotes                    faturamento.item.lancar (aplica ou reclassifica)
//   POST /api/faturamento/pacotes-conta/:cp/descaracterizacao   faturamento.auditoria.ajustar (motivo e justificativa)
//   GET  /api/faturamento/pacotes/:pacote/composicao            faturamento.pacote.ler
//   POST /api/faturamento/pacotes/:pacote/versoes               faturamento.pacote.editar
//   POST /api/faturamento/pacotes/:pacote/composicao            faturamento.pacote.editar
//   POST /api/faturamento/motivos-descaracterizacao             faturamento.pacote.editar
// As gravações levam Idempotency-Key e passam pelo executor (trilha e autoria na mesma transação).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { ContextoNucleo, Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { recusa } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, ctxDe, inteiro, problemaDoPreco } from '../precos/base.js';
import {
  ajustesContaPropria,
  gravarAjustes,
  horarioEspecialPropria,
  type NomeOperacaoAjustes,
  pacoteComposicaoPropria,
  pacotesContaPropria,
} from './conta-ajustes-propria.js';

export const SERVICO_AJUSTES_CONTA = Symbol('SERVICO_AJUSTES_CONTA');
const EXECUTOR = 'executor: trilha e autoria na mesma transação';

export class ServicoAjustesConta {
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
  gravar(nome: NomeOperacaoAjustes, ctx: Parameters<typeof gravarAjustes>[2], e: unknown) {
    return gravarAjustes(this.executor, nome, ctx, e);
  }
}

const objeto = (c: unknown): Record<string, unknown> =>
  c !== null && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {};

@Controller()
export class AjustesContaController {
  constructor(@Inject(SERVICO_AJUSTES_CONTA) private readonly servico: ServicoAjustesConta | null) {}

  private s(): ServicoAjustesConta {
    if (!this.servico)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'Os ajustes da conta exigem o banco próprio.',
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
    nome: NomeOperacaoAjustes,
    req: RequisicaoAutorizada,
    rotulo: string,
    corpo: unknown,
    extra: Record<string, unknown>,
  ) {
    return this.rodar(() =>
      this.s().gravar(nome, contextoOperacao(req, rotulo), { ...objeto(corpo), ...extra }),
    );
  }

  @Get('faturamento/contas/:id/ajustes')
  @Permissao('faturamento.conta.ler')
  ajustes(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const c = inteiro(id, 'id');
    return this.rodar(() =>
      this.s().ler(ctxDe(req, 'conta-ajustes'), (l, est) => ajustesContaPropria(l, est, c)),
    );
  }

  @Post('faturamento/contas/:id/horario-especial')
  @HttpCode(200)
  @Permissao('faturamento.item.lancar')
  @AuditadoNoHandler(EXECUTOR)
  aplicarHorario(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('horario.aplicar', req, 'conta-ajustes', corpo, { contaId: inteiro(id, 'id') });
  }

  @Get('faturamento/horario-especial')
  @Permissao('faturamento.conta.ler')
  horario(@Query('tabela') tabela: string | undefined, @Req() req: RequisicaoAutorizada) {
    const t = tabela ? inteiro(tabela, 'tabela') : null;
    return this.rodar(() =>
      this.s().ler(ctxDe(req, 'horario-especial'), (l, est) => horarioEspecialPropria(l, est, t)),
    );
  }

  @Post('faturamento/horario-especial')
  @HttpCode(200)
  @Permissao('convenio.contrato.editar')
  @AuditadoNoHandler(EXECUTOR)
  gravarFaixa(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('horario.faixa', req, 'horario-especial', corpo, {});
  }

  @Post('faturamento/tabelas/:tabela/expediente')
  @HttpCode(200)
  @Permissao('convenio.contrato.editar')
  @AuditadoNoHandler(EXECUTOR)
  expediente(@Param('tabela') tabela: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('horario.expediente', req, 'horario-especial', corpo, {
      tabelaPrecoId: inteiro(tabela, 'tabela'),
    });
  }

  @Post('faturamento/motivos-ajuste')
  @HttpCode(201)
  @Permissao('faturamento.regra.editar')
  @AuditadoNoHandler(EXECUTOR)
  motivoAjuste(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('ajuste.motivo', req, 'conta-ajustes', corpo, {});
  }

  @Post('faturamento/contas/:id/ajustes')
  @HttpCode(201)
  @Permissao('faturamento.item.lancar')
  @AuditadoNoHandler(EXECUTOR)
  pedirAjuste(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('ajuste.pedir', req, 'conta-ajustes', corpo, { contaId: inteiro(id, 'id') });
  }

  @Post('faturamento/ajustes-conta/:aid/decisao')
  @HttpCode(200)
  @Permissao('faturamento.auditoria.ajustar')
  @AuditadoNoHandler(EXECUTOR)
  decidir(@Param('aid') aid: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const c = objeto(corpo);
    if (c['decisao'] !== 'aprovar' && c['decisao'] !== 'recusar')
      throw new ErroProblema('entrada-invalida', 422, 'Decisão inválida', 'Use aprovar ou recusar.');
    return this.gravar('ajuste.decidir', req, 'conta-ajustes', c, { id: inteiro(aid, 'aid') });
  }

  @Post('faturamento/ajustes-conta/:aid/cancelamento')
  @HttpCode(200)
  @Permissao('faturamento.item.lancar')
  @AuditadoNoHandler(EXECUTOR)
  cancelar(@Param('aid') aid: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('ajuste.decidir', req, 'conta-ajustes', corpo, {
      id: inteiro(aid, 'aid'),
      decisao: 'cancelar',
    });
  }

  @Get('faturamento/contas/:id/pacotes')
  @Permissao('faturamento.conta.ler')
  pacotes(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const c = inteiro(id, 'id');
    return this.rodar(() =>
      this.s().ler(ctxDe(req, 'conta-pacotes'), (l, est) => pacotesContaPropria(l, est, c)),
    );
  }

  @Post('faturamento/contas/:id/pacotes')
  @HttpCode(200)
  @Permissao('faturamento.item.lancar')
  @AuditadoNoHandler(EXECUTOR)
  aplicarPacote(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('pacote.aplicar', req, 'conta-pacotes', corpo, { contaId: inteiro(id, 'id') });
  }

  @Post('faturamento/pacotes-conta/:cp/descaracterizacao')
  @HttpCode(200)
  @Permissao('faturamento.auditoria.ajustar')
  @AuditadoNoHandler(EXECUTOR)
  descaracterizar(@Param('cp') cp: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('pacote.descaracterizar', req, 'conta-pacotes', corpo, { id: inteiro(cp, 'cp') });
  }

  @Get('faturamento/pacotes/:pacote/composicao')
  @Permissao('faturamento.pacote.ler')
  composicao(@Param('pacote') pacote: string, @Req() req: RequisicaoAutorizada) {
    const p = inteiro(pacote, 'pacote');
    return this.rodar(() =>
      this.s().ler(ctxDe(req, 'pacote-composicao'), (l) => pacoteComposicaoPropria(l, p)),
    );
  }

  @Post('faturamento/pacotes/:pacote/versoes')
  @HttpCode(201)
  @Permissao('faturamento.pacote.editar')
  @AuditadoNoHandler(EXECUTOR)
  versionar(@Param('pacote') pacote: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('pacote.versao', req, 'pacote-composicao', corpo, {
      pacoteId: inteiro(pacote, 'pacote'),
    });
  }

  @Post('faturamento/pacotes/:pacote/composicao')
  @HttpCode(200)
  @Permissao('faturamento.pacote.editar')
  @AuditadoNoHandler(EXECUTOR)
  gravarComposicao(
    @Param('pacote') pacote: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.gravar('pacote.composicao', req, 'pacote-composicao', corpo, {
      pacoteId: inteiro(pacote, 'pacote'),
    });
  }

  @Post('faturamento/motivos-descaracterizacao')
  @HttpCode(201)
  @Permissao('faturamento.pacote.editar')
  @AuditadoNoHandler(EXECUTOR)
  motivoDescaracterizacao(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('pacote.motivo', req, 'pacote-composicao', corpo, {});
  }
}
