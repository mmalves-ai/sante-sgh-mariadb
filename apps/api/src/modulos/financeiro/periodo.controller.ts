// F3.8, 07-FIN linha 85: rotas do período financeiro e do saldo diário por conta.
//   GET  /api/financeiro/periodos                 as competências do estabelecimento (situação, quem fechou e reabriu)
//   POST /api/financeiro/periodos/fechar          { competencia }                 (financeiro.movimento.criar)
//   POST /api/financeiro/periodos/pedir-reabertura { competencia, justificativa } (financeiro.movimento.criar)
//   POST /api/financeiro/periodos/reabrir         { competencia, decisao, observacao? } autorizar ou recusar o pedido
//                                                 (financeiro.parametro.editar; quem pediu não decide)
//   GET  /api/financeiro/periodos/eventos         o histórico de fechamentos, pedidos e decisões
//   GET  /api/financeiro/periodos/saldo-diario?conta=&de=&ate=   o saldo gravado por dia (conta do escopo)
// A gravação vai pelo apoio da tesouraria (liberação, permissão da operação, trilha e idempotência no executor); a
// leitura, direto no banco do cliente (sem núcleo: 503, falha fechada).
import { Body, Controller, Get, HttpCode, Inject, Optional, Post, Query, Req } from '@nestjs/common';
import type { ResultadoFinanceiro } from '@sgh/contratos';
import type { Leitor, NucleoProprio } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { corpo, inteiroOuNulo } from '../exames/public-api.js';
import { ApoiosFinanceiro } from './apoios.js';
import { contasDoEscopo } from './operacoes.js';
import {
  type EventoPeriodoResposta,
  esquemaFecharPeriodo,
  esquemaPedirReabertura,
  esquemaReabrirPeriodo,
  listarEventosPeriodo,
  listarPeriodos,
  type PeriodoFinanceiroResposta,
  type SaldoDiarioResposta,
  saldosDiarios,
} from './periodo-propria.js';
import { PORTA_FINANCEIRO, type PortaFinanceiro } from './porta.js';
import { resultadoFin } from './servico.js';

/** O núcleo do banco do cliente para as leituras do período (nulo na memória de dev/ci). */
export const NUCLEO_PERIODO_FINANCEIRO = Symbol('NUCLEO_PERIODO_FINANCEIRO');

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const data = (v: string | undefined, campo: string): string => {
  if (!v || !DATA.test(v))
    throw new ErroProblema('entrada-invalida', 400, 'Data inválida', `${campo}: AAAA-MM-DD.`);
  return v;
};

@Controller('financeiro/periodos')
export class PeriodoFinanceiroController {
  private readonly apoios: ApoiosFinanceiro;

  constructor(
    @Inject(PORTA_FINANCEIRO) porta: PortaFinanceiro,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(NUCLEO_PERIODO_FINANCEIRO) private readonly nucleo: NucleoProprio | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) fonteConfiguracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    const ambiente = (process.env['AMBIENTE'] ?? 'dev').trim() || 'dev';
    this.apoios = new ApoiosFinanceiro(porta, trilha, fonteConfiguracao, cache, ambiente);
  }

  private ler<T>(req: RequisicaoAutorizada, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const s = sessaoDe(req);
    const est = s.porta.estabelecimento;
    if (!this.nucleo) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    if (est === null)
      throw new ErroProblema('sem-estabelecimento', 409, 'Escolha o estabelecimento da sessão');
    return this.nucleo.lerSomente(
      { ...s.porta, correlacao: (s.porta.correlacao || 'financeiro').slice(0, 64) },
      (l) => fn(l, est),
    );
  }

  @Get()
  @Permissao('financeiro.movimento.ler')
  periodos(@Req() req: RequisicaoAutorizada): Promise<PeriodoFinanceiroResposta[]> {
    return this.ler(req, (l, est) => listarPeriodos(l, est));
  }

  @Get('eventos')
  @Permissao('financeiro.movimento.ler')
  eventos(@Req() req: RequisicaoAutorizada): Promise<EventoPeriodoResposta[]> {
    return this.ler(req, (l, est) => listarEventosPeriodo(l, est));
  }

  @Get('saldo-diario')
  @Permissao('financeiro.movimento.ler')
  saldoDiario(
    @Query('conta') conta: string | undefined,
    @Query('de') de: string | undefined,
    @Query('ate') ate: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<SaldoDiarioResposta[]> {
    const id = inteiroOuNulo(conta);
    if (!id) throw new ErroProblema('entrada-invalida', 400, 'Conta inválida', 'Escolha a conta bancária.');
    const inicio = data(de, 'de');
    const fim = data(ate, 'ate');
    return this.ler(req, async (l, est) => {
      // Só as contas do escopo do usuário (regra 15), como o saldo da tela de contas.
      if (!(await contasDoEscopo(l, est, sessaoDe(req).porta.usuario)).includes(id))
        throw new ErroProblema('nao-encontrado', 404, 'Conta não encontrada');
      return saldosDiarios(l, est, id, inicio, fim);
    });
  }

  @Post('fechar')
  @HttpCode(200)
  @Permissao('financeiro.movimento.criar')
  @AuditadoNoHandler('financeiro.fecharPeriodo pelo executor (trilha na mesma transação)')
  async fechar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    const op = 'financeiro.fecharPeriodo';
    const r = await this.apoios
      .daOperacao(op)
      .executar(
        sessaoDe(req),
        op,
        corpo(esquemaFecharPeriodo, b),
        'Competência fechada; saldos do dia gravados.',
      );
    return resultadoFin(r.mensagem, r.repetida, r.resultado);
  }

  @Post('pedir-reabertura')
  @HttpCode(200)
  @Permissao('financeiro.movimento.criar')
  @AuditadoNoHandler('financeiro.pedirReaberturaPeriodo pelo executor (trilha na mesma transação)')
  async pedirReabertura(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    const op = 'financeiro.pedirReaberturaPeriodo';
    const r = await this.apoios
      .daOperacao(op)
      .executar(
        sessaoDe(req),
        op,
        corpo(esquemaPedirReabertura, b),
        'Pedido de reabertura registrado; outro usuário autoriza.',
      );
    return resultadoFin(r.mensagem, r.repetida, r.resultado);
  }

  @Post('reabrir')
  @HttpCode(200)
  @Permissao('financeiro.parametro.editar')
  @AuditadoNoHandler('financeiro.reabrirPeriodo pelo executor (trilha na mesma transação)')
  async reabrir(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    const op = 'financeiro.reabrirPeriodo';
    const r = await this.apoios
      .daOperacao(op)
      .executar(sessaoDe(req), op, corpo(esquemaReabrirPeriodo, b), 'Decisão sobre a reabertura registrada.');
    return resultadoFin(r.mensagem, r.repetida, r.resultado);
  }
}
