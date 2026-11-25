// F3.8, 07-FIN linha 113: o ciclo da nota de serviço no banco do cliente (nota-servico-propria.ts):
//   GET  /api/financeiro/fiscal/notas-servico[?situacao=]            as notas do estabelecimento
//   GET  /api/financeiro/fiscal/notas-servico/apoio                  faturas sem nota, motivos do catálogo e prazos
//   GET  /api/financeiro/fiscal/notas-servico/:id/historico          eventos, deduções e tributos da nota
//   POST /api/financeiro/fiscal/notas-servico/lote                   { notas[] }: uma ou muitas faturas num envio
//   POST /api/financeiro/fiscal/notas-servico/:id/cancelar           { motivo, justificativa }
//   POST /api/financeiro/fiscal/notas-servico/:id/substituir         { motivo, justificativa, nova }
//   POST /api/financeiro/fiscal/notas-servico/prazo                  { prazoCancelamentoDias, prazoSubstituicaoDias }
// A gravação vai pelo executor do núcleo (trilha, outbox e idempotência na mesma transação); sem núcleo: 503.
// O destino (simulador ou prefeitura) é decidido aqui, pelo ambiente; a tela não escolhe.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import type { ResultadoFinanceiro } from '@sgh/contratos';
import { destinoNfse } from '@sgh/dominio-financeiro';
import type { Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  esquemaCancelarNotaServico,
  esquemaEmitirNotasServico,
  esquemaPrazoNotaServico,
  esquemaSubstituirNotaServico,
  faturasSemNotaServico,
  historicoNotaServico,
  motivosNotaServico,
  notasServico,
  type OperacaoNotaServico,
  operacoesNotaServico,
  parametrosNotaServico,
} from './nota-servico-propria.js';
import type { ArmazemFinanceiro } from './armazem.js';
import { NUCLEO_PERIODO_FINANCEIRO } from './periodo.controller.js';
import { resultadoFin } from './servico.js';
import { ARMAZEM_FINANCEIRO } from './simbolos.js';

const SITUACOES = [
  'rascunho',
  'rps_gerado',
  'enviada',
  'autorizada',
  'rejeitada',
  'cancelada',
  'substituida',
];

function idDaNota(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0)
    throw new ErroProblema('entrada-invalida', 400, 'Nota inválida', 'Informe a nota.');
  return n;
}
const objeto = (b: unknown): Record<string, unknown> =>
  b !== null && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};

@Controller('financeiro/fiscal/notas-servico')
export class NotaServicoController {
  private readonly executor: Executor | null;
  private readonly operacoes: ReturnType<typeof operacoesNotaServico>;
  /** A prefeitura só em produção e com o provedor municipal ligado (ainda não há): fora disso, o simulador. */
  private readonly destino = destinoNfse((process.env['AMBIENTE'] ?? 'dev').trim() || 'dev', false);

  constructor(
    @Inject(ARMAZEM_FINANCEIRO) armazem: ArmazemFinanceiro,
    @Optional() @Inject(NUCLEO_PERIODO_FINANCEIRO) private readonly nucleo: NucleoProprio | null = null,
  ) {
    this.executor = nucleo ? nucleo.criarExecutor() : null;
    // O XML de cada nota vai ao armazém de arquivos do financeiro (ADR 0004), registrado na transação da emissão.
    this.operacoes = operacoesNotaServico(armazem);
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
    op: OperacaoNotaServico,
    entrada: unknown,
    mensagem: (r: Record<string, unknown>) => string,
  ): Promise<ResultadoFinanceiro> {
    if (!this.executor) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    const s = sessaoDe(req);
    const r = await this.executor
      .executar(this.operacoes[op] as never, s.porta.cliente, entrada, contextoOperacao(s, op))
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
    const resultado = r.resultado as Record<string, unknown>;
    return resultadoFin(mensagem(resultado), r.repetida, resultado);
  }

  @Get()
  @Permissao('financeiro.nfse.ler')
  listar(@Query('situacao') situacao: string | undefined, @Req() req: RequisicaoAutorizada) {
    const filtro = situacao && SITUACOES.includes(situacao) ? situacao : null;
    return this.ler(req, (l, est) => notasServico(l, est, filtro));
  }

  @Get('apoio')
  @Permissao('financeiro.nfse.ler')
  apoio(@Req() req: RequisicaoAutorizada) {
    return this.ler(req, async (l, est) => ({
      destino: this.destino,
      parametros: await parametrosNotaServico(l, est),
      motivos: await motivosNotaServico(l),
      faturas: await faturasSemNotaServico(l, est),
    }));
  }

  @Get(':id/historico')
  @Permissao('financeiro.nfse.ler')
  async historico(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const nota = idDaNota(id);
    const h = await this.ler(req, (l, est) => historicoNotaServico(l, est, nota));
    if (!h) throw new ErroProblema('nao-encontrado', 404, 'Nota não encontrada');
    return h;
  }

  @Post('lote')
  @HttpCode(200)
  @Permissao('financeiro.nfse.emitir')
  @AuditadoNoHandler('financeiro.emitirNotasServico pelo executor (trilha na mesma transação)')
  emitir(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.emitirNotasServico',
      corpo(esquemaEmitirNotasServico, { notas: objeto(b)['notas'], destino: this.destino }),
      (r) =>
        r['destino'] === 'simulador'
          ? `Lote ${String(r['numeroLote'])}: ${String(r['quantidade'])} nota(s) autorizada(s) pelo simulador da prefeitura.`
          : `Lote ${String(r['numeroLote'])}: ${String(r['quantidade'])} nota(s) com o RPS gerado, à espera da prefeitura.`,
    );
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @Permissao('financeiro.nfse.emitir')
  @AuditadoNoHandler('financeiro.cancelarNotaServico pelo executor (trilha na mesma transação)')
  cancelar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.cancelarNotaServico',
      corpo(esquemaCancelarNotaServico, { ...objeto(b), nota: idDaNota(id) }),
      () => 'Nota cancelada; ela continua no histórico e a fatura pode receber outra nota.',
    );
  }

  @Post(':id/substituir')
  @HttpCode(200)
  @Permissao('financeiro.nfse.emitir')
  @AuditadoNoHandler('financeiro.substituirNotaServico pelo executor (trilha na mesma transação)')
  substituir(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.substituirNotaServico',
      corpo(esquemaSubstituirNotaServico, { ...objeto(b), nota: idDaNota(id), destino: this.destino }),
      (r) => `Nota substituída; a substituta saiu com o RPS ${String(r['rps'])}.`,
    );
  }

  @Post('prazo')
  @HttpCode(200)
  @Permissao('financeiro.nfse.emitir')
  @AuditadoNoHandler('financeiro.definirPrazoNotaServico pelo executor (trilha na mesma transação)')
  prazo(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.definirPrazoNotaServico',
      corpo(esquemaPrazoNotaServico, b),
      () => 'Prazos do município gravados.',
    );
  }
}
