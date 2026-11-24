// F3.8, 07-FIN linha 111: rotas da EFD-REINF por evento (competência, beneficiário, processo, envio e retorno).
//   GET  /api/financeiro/reinf/painel?periodo=AAAA-MM    eventos da competência com valores, lote e retornos; processos
//   GET  /api/financeiro/reinf/eventos/:id/xml           XML do evento (retificador com o recibo do original; R-9000)
//   POST /api/financeiro/reinf/processos                 processo com suspensão (tributo e, se houver, beneficiário)
//   POST /api/financeiro/reinf/gerar                     { serie: R-2000 | R-4000, periodo }
//   POST /api/financeiro/reinf/transmitir                { periodo, eventos } ao simulador (sem envio externo)
//   POST /api/financeiro/reinf/retorno                   { evento, aceito, recibo, ocorrencias }
// A gravação vai pelo executor do núcleo (trilha, outbox e idempotência na mesma transação); sem núcleo: 503.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import type { ResultadoFinanceiro } from '@sgh/contratos';
import type { Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { NUCLEO_PERIODO_FINANCEIRO } from './periodo.controller.js';
import { OPERACOES_REINF, painelReinf, xmlDoEventoReinf } from './reinf-eventos-propria.js';
import { resultadoFin } from './servico.js';

const PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/;

@Controller('financeiro/reinf')
export class ReinfEventosController {
  private readonly executor: Executor | null;

  constructor(
    @Optional() @Inject(NUCLEO_PERIODO_FINANCEIRO) private readonly nucleo: NucleoProprio | null = null,
  ) {
    this.executor = nucleo ? nucleo.criarExecutor() : null;
  }

  private ler<T>(req: RequisicaoAutorizada, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const s = sessaoDe(req);
    const est = s.porta.estabelecimento;
    if (!this.nucleo) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    if (est === null) throw new ErroProblema('entrada-invalida', 409, 'Escolha o estabelecimento da sessão');
    return this.nucleo.lerSomente(
      { ...s.porta, correlacao: (s.porta.correlacao || 'financeiro').slice(0, 64) },
      (l) => fn(l, est),
    );
  }

  private async gravar(
    req: RequisicaoAutorizada,
    op: keyof typeof OPERACOES_REINF,
    entrada: unknown,
    mensagem: (r: Record<string, unknown>) => string,
  ): Promise<ResultadoFinanceiro> {
    if (!this.executor) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    const s = sessaoDe(req);
    const r = await this.executor
      .executar(OPERACOES_REINF[op] as never, s.porta.cliente, entrada, contextoOperacao(s, op))
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
    const res = r.resultado as Record<string, unknown>;
    return resultadoFin(mensagem(res), r.repetida, res);
  }

  @Get('painel')
  @Permissao('financeiro.reinf.ler')
  painel(@Query('periodo') periodo: string | undefined, @Req() req: RequisicaoAutorizada) {
    if (!periodo || !PERIODO.test(periodo))
      throw new ErroProblema('entrada-invalida', 400, 'Competência inválida', 'Use AAAA-MM.');
    return this.ler(req, (l, est) => painelReinf(l, est, periodo));
  }

  @Get('eventos/:id/xml')
  @Permissao('financeiro.reinf.ler')
  async xml(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) throw new ErroProblema('entrada-invalida', 400, 'Evento inválido');
    const x = await this.ler(req, (l, est) => xmlDoEventoReinf(l, est, n));
    if (x === null) throw new ErroProblema('nao-encontrado', 404, 'Evento não encontrado');
    return { xml: x };
  }

  @Post('processos')
  @HttpCode(200)
  @Permissao('financeiro.reinf.gerar')
  @AuditadoNoHandler('processo com suspensão gravado pelo executor, com a trilha na mesma transação')
  processo(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(req, 'financeiro.reinfManterProcesso', b, () => 'Processo com suspensão gravado.');
  }

  @Post('gerar')
  @HttpCode(200)
  @Permissao('financeiro.reinf.gerar')
  @AuditadoNoHandler('eventos da EFD-REINF gerados pelo executor, com a trilha na mesma transação')
  gerar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(req, 'financeiro.reinfGerarEventos', b, (r) => {
      const g = String(r['quantidadeGerados']);
      const x = String(r['quantidadeExclusoes']);
      return `${g} evento(s) gerado(s), ${x} exclusão(ões), ${String(r['iguais'])} igual(is) ao já enviado.`;
    });
  }

  @Post('transmitir')
  @HttpCode(200)
  @Permissao('financeiro.reinf.gerar')
  @AuditadoNoHandler('lote da EFD-REINF transmitido ao simulador, com a trilha na mesma transação')
  transmitir(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.reinfTransmitir',
      b,
      (r) => `Lote ${String(r['numero'])} transmitido ao simulador (protocolo ${String(r['protocolo'])}).`,
    );
  }

  @Post('retorno')
  @HttpCode(200)
  @Permissao('financeiro.reinf.gerar')
  @AuditadoNoHandler('retorno do evento da EFD-REINF registrado, com a trilha na mesma transação')
  retorno(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(req, 'financeiro.reinfRegistrarRetorno', b, (r) =>
      r['situacao'] === 'aceito'
        ? 'Evento aceito, recibo registrado.'
        : 'Evento rejeitado, ocorrências registradas.',
    );
  }
}
