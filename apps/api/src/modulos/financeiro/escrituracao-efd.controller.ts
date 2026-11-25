// F3.8, 07-FIN linha 108: rotas da escrituração fiscal das entradas e da EFD-Contribuições.
//   GET  /api/financeiro/fiscal/escrituracao?periodo=AAAA-MM          entradas com as pendências, conferência das somas
//                                                                      e arquivos da competência
//   POST /api/financeiro/fiscal/escrituracao/entradas/:id/classificacao   { versao, itens } dados fiscais dos itens
//   POST /api/financeiro/fiscal/escrituracao/efd-contribuicoes        { periodo, regime } gera o arquivo conferido
//   GET  /api/financeiro/fiscal/escrituracao/efd-contribuicoes/:id/arquivo   o texto do arquivo
//   POST /api/financeiro/fiscal/escrituracao/efd-contribuicoes/:id/entrega   { recibo } registra o recibo da entrega
// A gravação vai pelo executor do núcleo (trilha, outbox e idempotência na mesma transação). Sem núcleo: a fonte
// sintética responde em memória (E2E e desenvolvimento sem banco); fora dela, 503. Nenhum envio externo: a
// transmissão é feita no programa da Receita, e aqui se registra o recibo.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import type { ResultadoFinanceiro } from '@sgh/contratos';
import type { Executor, NucleoProprio } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { fontesSinteticas } from '../../sessao/montar.js';
import { contextoOperacao, problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { EscrituracaoMemoria } from './escrituracao-efd-memoria.js';
import {
  esquemaClassificarEntrada,
  esquemaEntregaEfd,
  esquemaGerarEfd,
  OPERACOES_ESCRITURACAO,
  painelEscrituracao,
  type PainelEscrituracao,
  textoDoArquivoEfd,
} from './escrituracao-efd-propria.js';
import { NUCLEO_PERIODO_FINANCEIRO } from './periodo.controller.js';
import { resultadoFin } from './servico.js';

const PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/;
type Operacao = keyof typeof OPERACOES_ESCRITURACAO;

function inteiro(v: string, nome: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ErroProblema('entrada-invalida', 400, `${nome} inválido`);
  return n;
}
const objeto = (b: unknown): Record<string, unknown> =>
  b !== null && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};

@Controller('financeiro/fiscal/escrituracao')
export class EscrituracaoEfdController {
  private readonly executor: Executor | null;
  private readonly memoria: EscrituracaoMemoria | null;

  constructor(
    @Optional() @Inject(NUCLEO_PERIODO_FINANCEIRO) private readonly nucleo: NucleoProprio | null = null,
  ) {
    this.executor = nucleo ? nucleo.criarExecutor() : null;
    this.memoria = !nucleo && fontesSinteticas(process.env) ? new EscrituracaoMemoria() : null;
  }

  private estabelecimento(req: RequisicaoAutorizada): number {
    const est = sessaoDe(req).porta.estabelecimento;
    if (est === null) throw new ErroProblema('entrada-invalida', 409, 'Escolha o estabelecimento da sessão');
    return est;
  }

  private ler<T>(req: RequisicaoAutorizada, fn: Parameters<NucleoProprio['lerSomente']>[1]): Promise<T> {
    if (!this.nucleo) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    const s = sessaoDe(req);
    return this.nucleo.lerSomente(
      { ...s.porta, correlacao: (s.porta.correlacao || 'financeiro').slice(0, 64) },
      fn,
    ) as Promise<T>;
  }

  private async gravar(
    req: RequisicaoAutorizada,
    op: Operacao,
    entrada: unknown,
    naMemoria: (m: EscrituracaoMemoria) => Record<string, unknown>,
    mensagem: (r: Record<string, unknown>) => string,
  ): Promise<ResultadoFinanceiro> {
    if (this.executor) {
      const s = sessaoDe(req);
      const r = await this.executor
        .executar(OPERACOES_ESCRITURACAO[op] as never, s.porta.cliente, entrada, contextoOperacao(s, op))
        .catch((e: unknown) => {
          throw problemaDoCadastro(e);
        });
      const res = r.resultado as Record<string, unknown>;
      return resultadoFin(mensagem(res), r.repetida, res);
    }
    if (!this.memoria) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    try {
      const res = naMemoria(this.memoria);
      return resultadoFin(mensagem(res), false, res);
    } catch (e) {
      throw problemaDoCadastro(e);
    }
  }

  @Get()
  @Permissao('financeiro.escrituracao.ler')
  painel(
    @Query('periodo') periodo: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PainelEscrituracao> | PainelEscrituracao {
    if (!periodo || !PERIODO.test(periodo))
      throw new ErroProblema('entrada-invalida', 400, 'Competência inválida', 'Use AAAA-MM.');
    if (!this.nucleo && this.memoria) return this.memoria.painel(periodo);
    const est = this.estabelecimento(req);
    return this.ler(req, (l) => painelEscrituracao(l, est, periodo));
  }

  @Post('entradas/:id/classificacao')
  @HttpCode(200)
  @Permissao('financeiro.escrituracao.classificar')
  @AuditadoNoHandler('classificação fiscal da entrada gravada pelo executor, com a trilha na mesma transação')
  classificar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFinanceiro> {
    const entrada = { ...objeto(b), entrada: inteiro(id, 'Entrada') };
    return this.gravar(
      req,
      'financeiro.escrituracaoClassificarEntrada',
      entrada,
      (m) => m.classificar(this.validar(esquemaClassificarEntrada, entrada)),
      (r) =>
        Number(r['pendencias']) > 0
          ? `Classificação gravada; a entrada ainda tem ${String(r['pendencias'])} pendência(s).`
          : 'Classificação fiscal gravada.',
    );
  }

  @Post('efd-contribuicoes')
  @HttpCode(200)
  @Permissao('financeiro.efdContribuicoes.gerar')
  @AuditadoNoHandler('arquivo da EFD-Contribuições gerado pelo executor, com a trilha na mesma transação')
  gerar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.efdContribuicoesGerar',
      b,
      (m) => m.gerar(this.validar(esquemaGerarEfd, b)),
      (r) =>
        r['igual'] === true
          ? 'A escrituração não mudou: o arquivo já gerado continua valendo.'
          : `Arquivo ${String(r['finalidade'])} gerado com ${String(r['documentos'])} documento(s) e ${String(r['linhas'])} linha(s).`,
    );
  }

  @Post('efd-contribuicoes/:id/entrega')
  @HttpCode(200)
  @Permissao('financeiro.efdContribuicoes.gerar')
  @AuditadoNoHandler(
    'recibo da entrega da EFD-Contribuições registrado pelo executor, com a trilha na mesma transação',
  )
  entrega(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFinanceiro> {
    const entrada = { ...objeto(b), arquivo: inteiro(id, 'Arquivo') };
    return this.gravar(
      req,
      'financeiro.efdContribuicoesRegistrarEntrega',
      entrada,
      (m) => m.entregar(this.validar(esquemaEntregaEfd, entrada)),
      () => 'Entrega registrada com o recibo.',
    );
  }

  @Get('efd-contribuicoes/:id/arquivo')
  @Permissao('financeiro.escrituracao.ler')
  async arquivo(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const n = inteiro(id, 'Arquivo');
    const t =
      !this.nucleo && this.memoria
        ? this.memoria.textoDoArquivo(n)
        : await this.ler<Awaited<ReturnType<typeof textoDoArquivoEfd>>>(req, (l) =>
            textoDoArquivoEfd(l, this.estabelecimento(req), n),
          );
    if (t === null) throw new ErroProblema('nao-encontrado', 404, 'Arquivo não encontrado');
    if (t === 'desatualizado')
      throw new ErroProblema(
        'arquivo-desatualizado',
        409,
        'A escrituração mudou depois deste arquivo',
        'Gere o arquivo de novo para baixar o texto atual.',
      );
    return t;
  }

  private validar<T>(esquema: { safeParse(v: unknown): { success: boolean; data?: T } }, v: unknown): T {
    const r = esquema.safeParse(v);
    if (!r.success) throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos');
    return r.data as T;
  }
}
