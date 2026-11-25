// F7, 07-FIN linha 114: a NF-e de saída de mercadoria no banco do cliente (nota-mercadoria-propria.ts):
//   GET  /api/financeiro/fiscal/notas-mercadoria[?situacao=]        as notas do estabelecimento
//   GET  /api/financeiro/fiscal/notas-mercadoria/apoio              naturezas, devoluções sem nota, destinatários, motivos
//   GET  /api/financeiro/fiscal/notas-mercadoria/:id/historico      itens, referências e eventos da Sefaz
//   GET  /api/financeiro/fiscal/notas-mercadoria/:id/danfe          o DANFE simplificado (HTML escapado)
//   POST /api/financeiro/fiscal/notas-mercadoria                    emitir (da devolução, do conserto ou avulsa)
//   POST /api/financeiro/fiscal/notas-mercadoria/:id/transmitir     a nota assinada à Sefaz (sem resposta antes)
//   POST /api/financeiro/fiscal/notas-mercadoria/:id/cancelar       { motivo, justificativa }
//   POST /api/financeiro/fiscal/notas-mercadoria/:id/corrigir       { texto }: carta de correção
// A gravação vai pelo executor do núcleo (trilha, outbox e idempotência na mesma transação); sem núcleo: 503. O destino
// (simulador ou Sefaz) é decidido aqui, pelo ambiente; a tela não escolhe.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import type { ResultadoFinanceiro } from '@sgh/contratos';
import type { Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import type { ArmazemFinanceiro } from './armazem.js';
import {
  apoioNotaMercadoria,
  danfeNotaMercadoria,
  esquemaCancelarNotaMercadoria,
  esquemaCorrigirNotaMercadoria,
  esquemaEmitirNotaMercadoria,
  esquemaTransmitirNotaMercadoria,
  historicoNotaMercadoria,
  notasMercadoria,
  type OperacaoNotaMercadoria,
  operacoesNotaMercadoria,
  SITUACOES_NFE,
} from './nota-mercadoria-propria.js';
import { NUCLEO_PERIODO_FINANCEIRO } from './periodo.controller.js';
import { resultadoFin } from './servico.js';
import { ARMAZEM_FINANCEIRO } from './simbolos.js';

/** A Sefaz só em produção com o certificado A1 no cofre e a transmissão ligada (nfe-transmissao.ts): fora disso, o simulador. */
export function destinoNfe(ambiente: string): 'simulador' | 'sefaz' {
  return ambiente === 'producao' && process.env['NFE_SEFAZ_LIGADA'] === '1' ? 'sefaz' : 'simulador';
}

function idDaNota(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0)
    throw new ErroProblema('entrada-invalida', 400, 'Nota inválida', 'Informe a nota.');
  return n;
}
const objeto = (b: unknown): Record<string, unknown> =>
  b !== null && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};

@Controller('financeiro/fiscal/notas-mercadoria')
export class NotaMercadoriaController {
  private readonly executor: Executor | null;
  private readonly operacoes: ReturnType<typeof operacoesNotaMercadoria>;
  private readonly destino = destinoNfe((process.env['AMBIENTE'] ?? 'dev').trim() || 'dev');

  constructor(
    @Inject(ARMAZEM_FINANCEIRO) armazem: ArmazemFinanceiro,
    @Optional() @Inject(NUCLEO_PERIODO_FINANCEIRO) private readonly nucleo: NucleoProprio | null = null,
  ) {
    this.executor = nucleo ? nucleo.criarExecutor() : null;
    this.operacoes = operacoesNotaMercadoria(armazem);
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
    op: OperacaoNotaMercadoria,
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
  @Permissao('financeiro.notaMercadoria.ler')
  listar(@Query('situacao') situacao: string | undefined, @Req() req: RequisicaoAutorizada) {
    const filtro = situacao && (SITUACOES_NFE as readonly string[]).includes(situacao) ? situacao : null;
    return this.ler(req, (l, est) => notasMercadoria(l, est, filtro));
  }

  @Get('apoio')
  @Permissao('financeiro.notaMercadoria.ler')
  apoio(@Req() req: RequisicaoAutorizada) {
    return this.ler(req, async (l, est) => ({
      destino: this.destino,
      ...(await apoioNotaMercadoria(l, est)),
    }));
  }

  @Get(':id/historico')
  @Permissao('financeiro.notaMercadoria.ler')
  async historico(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const nota = idDaNota(id);
    const h = await this.ler(req, (l, est) => historicoNotaMercadoria(l, est, nota));
    if (!h) throw new ErroProblema('nao-encontrado', 404, 'Nota não encontrada');
    return h;
  }

  @Get(':id/danfe')
  @Permissao('financeiro.notaMercadoria.ler')
  async danfe(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const nota = idDaNota(id);
    const html = await this.ler(req, (l, est) => danfeNotaMercadoria(l, est, nota));
    if (html === null) throw new ErroProblema('nao-encontrado', 404, 'Nota não encontrada');
    return { html };
  }

  @Post()
  @HttpCode(200)
  @Permissao('financeiro.notaMercadoria.emitir')
  @AuditadoNoHandler('financeiro.emitir_nota_mercadoria pelo executor (trilha na mesma transação)')
  emitir(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.emitir_nota_mercadoria',
      corpo(esquemaEmitirNotaMercadoria, { ...objeto(b), destino: this.destino }),
      (r) =>
        r['situacao'] === 'autorizada'
          ? `NF-e ${String(r['numero'])} autorizada${r['destino'] === 'simulador' ? ' pelo simulador da Sefaz (sem valor fiscal)' : ''}.`
          : r['situacao'] === 'assinada'
            ? `NF-e ${String(r['numero'])} assinada, à espera da transmissão à Sefaz.`
            : `NF-e ${String(r['numero'])} rejeitada: ${String(r['retorno'])}`,
    );
  }

  @Post(':id/transmitir')
  @HttpCode(200)
  @Permissao('financeiro.notaMercadoria.emitir')
  @AuditadoNoHandler('financeiro.transmitir_nota_mercadoria pelo executor (trilha na mesma transação)')
  transmitir(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.transmitir_nota_mercadoria',
      corpo(esquemaTransmitirNotaMercadoria, { nota: idDaNota(id), destino: this.destino }),
      (r) =>
        r['situacao'] === 'autorizada'
          ? `NF-e ${String(r['numero'])} autorizada pela Sefaz.`
          : `NF-e ${String(r['numero'])} ${String(r['situacao'])}: ${String(r['retorno'])}`,
    );
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @Permissao('financeiro.notaMercadoria.emitir')
  @AuditadoNoHandler('financeiro.cancelar_nota_mercadoria pelo executor (trilha na mesma transação)')
  cancelar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.cancelar_nota_mercadoria',
      corpo(esquemaCancelarNotaMercadoria, { ...objeto(b), nota: idDaNota(id), destino: this.destino }),
      () => 'NF-e cancelada; ela continua no histórico e a devolução pode receber outra nota.',
    );
  }

  @Post(':id/corrigir')
  @HttpCode(200)
  @Permissao('financeiro.notaMercadoria.emitir')
  @AuditadoNoHandler('financeiro.corrigir_nota_mercadoria pelo executor (trilha na mesma transação)')
  corrigir(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.corrigir_nota_mercadoria',
      corpo(esquemaCorrigirNotaMercadoria, { ...objeto(b), nota: idDaNota(id), destino: this.destino }),
      (r) => `Carta de correção ${String(r['sequencia'])} registrada.`,
    );
  }
}
