// F7, 09-AREA linha 78 (C2-094): rotas da entrada de serviço tomado (nota de serviço contra o pedido, retenções e câmbio).
//   GET  /api/financeiro/fiscal/entradas-servico/apoio              fornecedores, pedidos de serviço com saldo, serviços,
//                                                                    centros de custo e moedas
//   GET  /api/financeiro/fiscal/entradas-servico?competencia=&situacao=   as entradas com o retido e o líquido
//   GET  /api/financeiro/fiscal/entradas-servico/retencoes?fornecedor=&valor=&emissao=&issRetido=&aliquotaIss=&baseIss=
//        &inssNaoRetido=&municipio=&participante=                     a prévia das retenções (as regras da gravação)
//   GET  /api/financeiro/fiscal/entradas-servico/:id                 itens, câmbio e retenções por tributo
//   POST /api/financeiro/fiscal/entradas-servico                     registrar (aberta, retenções calculadas)
//   POST /api/financeiro/fiscal/entradas-servico/:id/concluir        { versao, titulo } baixa no pedido e escrituração
//   POST /api/financeiro/fiscal/entradas-servico/:id/cancelar        { versao, justificativa } (nada é apagado)
// A gravação vai pelo executor do núcleo (trilha, outbox e idempotência na mesma transação); sem núcleo: 503.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import type { ResultadoFinanceiro } from '@sgh/contratos';
import type { Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  apoioEntradaServico,
  detalheEntradaServico,
  listarEntradasServico,
  OPERACOES_ENTRADA_SERVICO,
  previaRetencoesEntrada,
} from './entrada-servico-propria.js';
import { NUCLEO_PERIODO_FINANCEIRO } from './periodo.controller.js';
import { resultadoFin } from './servico.js';

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const PARTICIPANTES = [
  'pessoa_fisica',
  'pessoa_juridica',
  'cooperativa',
  'simples_nacional',
  'orgao_publico',
] as const;
const positivo = (v: unknown, campo: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ErroProblema('entrada-invalida', 400, `${campo} inválido`);
  return n;
};
const valor = (v: unknown): number | null => (v === undefined || v === '' || v === null ? null : Number(v));
const corpo = (b: unknown): Record<string, unknown> =>
  b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

@Controller('financeiro/fiscal/entradas-servico')
export class EntradaServicoController {
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
    return this.nucleo
      .lerSomente({ ...s.porta, correlacao: (s.porta.correlacao || 'financeiro').slice(0, 64) }, (l) =>
        fn(l, est),
      )
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
  }

  private async gravar(
    req: RequisicaoAutorizada,
    op: keyof typeof OPERACOES_ENTRADA_SERVICO,
    entrada: unknown,
    mensagem: (r: Record<string, unknown>) => string,
  ): Promise<ResultadoFinanceiro> {
    if (!this.executor) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    const s = sessaoDe(req);
    const r = await this.executor
      .executar(OPERACOES_ENTRADA_SERVICO[op] as never, s.porta.cliente, entrada, contextoOperacao(s, op))
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
    const res = r.resultado as Record<string, unknown>;
    return resultadoFin(mensagem(res), r.repetida, res);
  }

  @Get('apoio')
  @Permissao('financeiro.entradaServico.ler')
  apoio(@Req() req: RequisicaoAutorizada) {
    return this.ler(req, (l, est) => apoioEntradaServico(l, est));
  }

  @Get()
  @Permissao('financeiro.entradaServico.ler')
  listar(
    @Query('competencia') competencia: string | undefined,
    @Query('situacao') situacao: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.ler(req, (l, est) =>
      listarEntradasServico(l, est, { competencia: competencia ?? null, situacao: situacao || null }),
    );
  }

  @Get('retencoes')
  @Permissao('financeiro.entradaServico.ler')
  retencoes(@Query() q: Record<string, string | undefined>, @Req() req: RequisicaoAutorizada) {
    const valorBruto = Number(q['valor']);
    if (!Number.isFinite(valorBruto) || valorBruto < 0 || !DATA.test(q['emissao'] ?? ''))
      throw new ErroProblema('entrada-invalida', 400, 'Informe o valor e a emissão da nota');
    const participante = (PARTICIPANTES as readonly string[]).includes(q['participante'] ?? '')
      ? (q['participante'] as (typeof PARTICIPANTES)[number])
      : null;
    return this.ler(req, (l, est) =>
      previaRetencoesEntrada(l, est, {
        fornecedor: positivo(q['fornecedor'], 'Fornecedor'),
        valorBruto,
        dataEmissao: q['emissao']!,
        municipio: q['municipio'] ? positivo(q['municipio'], 'Município') : null,
        participante,
        issRetido: q['issRetido'] === 'true',
        aliquotaIss: valor(q['aliquotaIss']),
        baseIss: valor(q['baseIss']),
        inssNaoRetido: valor(q['inssNaoRetido']) ?? 0,
      }),
    );
  }

  @Get(':id')
  @Permissao('financeiro.entradaServico.ler')
  async detalhe(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const n = positivo(id, 'Entrada');
    const d = await this.ler(req, (l, est) => detalheEntradaServico(l, est, n));
    if (!d) throw new ErroProblema('nao-encontrado', 404, 'Entrada não encontrada');
    return d;
  }

  @Post()
  @HttpCode(200)
  @Permissao('financeiro.entradaServico.lancar')
  @AuditadoNoHandler('financeiro.entrada_servico_registrar pelo executor (trilha na mesma transação)')
  registrar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'registrar',
      b,
      (r) =>
        `Entrada ${String(r['numero'])} registrada: bruto ${reais(Number(r['valorBruto']))}, retido ${reais(
          Number(r['retido']),
        )}, líquido ${reais(Number(r['liquido']))}.`,
    );
  }

  @Post(':id/concluir')
  @HttpCode(200)
  @Permissao('financeiro.entradaServico.lancar')
  @AuditadoNoHandler('financeiro.entrada_servico_concluir pelo executor (trilha na mesma transação)')
  concluir(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFinanceiro> {
    const c = corpo(b);
    return this.gravar(
      req,
      'concluir',
      { entrada: positivo(id, 'Entrada'), versao: c['versao'], titulo: c['titulo'] ?? null },
      () => 'Entrada concluída: o pedido foi atendido e a nota foi para a escrituração.',
    );
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @Permissao('financeiro.entradaServico.lancar')
  @AuditadoNoHandler('financeiro.entrada_servico_cancelar pelo executor (trilha na mesma transação)')
  cancelar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFinanceiro> {
    const c = corpo(b);
    return this.gravar(
      req,
      'cancelar',
      { entrada: positivo(id, 'Entrada'), versao: c['versao'], justificativa: c['justificativa'] },
      () => 'Entrada cancelada; ela continua no histórico com a justificativa.',
    );
  }
}
