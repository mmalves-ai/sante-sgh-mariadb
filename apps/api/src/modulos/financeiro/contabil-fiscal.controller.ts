// F3.8, 07-FIN linhas 100 e 109: rotas do de-para contábil e das retenções na fonte.
//   GET  /api/financeiro/contabil-fiscal/de-para                    eventos, regras de conta, naturezas, centros, credores
//   GET  /api/financeiro/contabil-fiscal/sem-de-para?periodo=&regua= o que falta mapear antes de exportar o lote
//   POST /api/financeiro/contabil-fiscal/de-para                    { tipo: conta | centro | credor, ... }
//   GET  /api/financeiro/contabil-fiscal/retencao/regras            regras com vigência (vigentes e encerradas)
//   POST /api/financeiro/contabil-fiscal/retencao/regras            { acao: incluir | encerrar, ... }
//   GET  /api/financeiro/contabil-fiscal/retencao/sugestao?valor=&data=&participante=&momento=&municipio=
//   GET  /api/financeiro/contabil-fiscal/retencao/em-aberto?competencia=AAAA-MM
//   POST /api/financeiro/contabil-fiscal/retencao/recolhimento      { competencia, tributo, credor, natureza, codigoReceita }
// A gravação vai pelo executor do núcleo (trilha, outbox e idempotência na mesma transação); sem núcleo: 503.
import { Body, Controller, Get, HttpCode, Inject, Optional, Post, Query, Req } from '@nestjs/common';
import type { ResultadoFinanceiro } from '@sgh/contratos';
import { eventosSemDePara, PARTICIPANTES_RETENCAO } from '@sgh/dominio-financeiro';
import type { Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  deParaDoEstabelecimento,
  esquemaDeParaContabil,
  esquemaRecolhimento,
  esquemaRegraRetencao,
  fatosContabeis,
  OPERACOES_CONTABIL_FISCAL,
  regrasDePara,
  regrasRetencao,
  retidoEmAberto,
  sugestaoRetencao,
} from './contabil-fiscal-propria.js';
import { NUCLEO_PERIODO_FINANCEIRO } from './periodo.controller.js';
import { resultadoFin } from './servico.js';

const PERIODO = /^\d{4}-\d{2}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const competencia = (v: string | undefined): string => {
  if (!v || !PERIODO.test(v))
    throw new ErroProblema('entrada-invalida', 400, 'Competência inválida', 'Use AAAA-MM.');
  return v;
};
const fimDoMes = (p: string) => {
  const [a, m] = [Number(p.slice(0, 4)), Number(p.slice(5, 7))];
  return `${p}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

@Controller('financeiro/contabil-fiscal')
export class ContabilFiscalController {
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
    op: keyof typeof OPERACOES_CONTABIL_FISCAL,
    entrada: unknown,
    mensagem: string,
  ): Promise<ResultadoFinanceiro> {
    if (!this.executor) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    const s = sessaoDe(req);
    const r = await this.executor
      .executar(OPERACOES_CONTABIL_FISCAL[op] as never, s.porta.cliente, entrada, contextoOperacao(s, op))
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
    return resultadoFin(mensagem, r.repetida, r.resultado as Record<string, unknown>);
  }

  @Get('de-para')
  @Permissao('financeiro.exportacaoContabil.ler')
  dePara(@Req() req: RequisicaoAutorizada) {
    return this.ler(req, (l, est) => deParaDoEstabelecimento(l, est));
  }

  @Get('sem-de-para')
  @Permissao('financeiro.exportacaoContabil.ler')
  semDePara(
    @Query('periodo') periodo: string | undefined,
    @Query('regua') regua: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const p = competencia(periodo);
    const r = regua === 'caixa' ? 'caixa' : 'competencia';
    return this.ler(req, async (l, est) =>
      eventosSemDePara(await fatosContabeis(l, est, `${p}-01`, fimDoMes(p), r), await regrasDePara(l, est)),
    );
  }

  @Post('de-para')
  @HttpCode(200)
  @Permissao('financeiro.parametro.editar')
  @AuditadoNoHandler('financeiro.manterDeParaContabil pelo executor (trilha na mesma transação)')
  manterDePara(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.manterDeParaContabil',
      corpo(esquemaDeParaContabil, b),
      'De-para contábil gravado.',
    );
  }

  @Get('retencao/regras')
  @Permissao('financeiro.parametro.ler')
  regras(@Req() req: RequisicaoAutorizada) {
    return this.ler(req, (l, est) => regrasRetencao(l, est));
  }

  @Post('retencao/regras')
  @HttpCode(200)
  @Permissao('financeiro.parametro.editar')
  @AuditadoNoHandler('financeiro.manterRegraRetencao pelo executor (trilha na mesma transação)')
  manterRegra(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.manterRegraRetencao',
      corpo(esquemaRegraRetencao, b),
      'Regra de retenção gravada.',
    );
  }

  @Get('retencao/sugestao')
  @Permissao('financeiro.tituloPagar.criar')
  sugestao(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const valor = Number(q['valor']);
    const data = q['data'] ?? '';
    const participante = (q['participante'] ?? 'pessoa_juridica') as (typeof PARTICIPANTES_RETENCAO)[number];
    if (
      !(valor > 0) ||
      !DATA.test(data) ||
      participante === 'todos' ||
      !PARTICIPANTES_RETENCAO.includes(participante)
    )
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados da sugestão inválidos',
        'Informe valor, data e participante.',
      );
    const momento = q['momento'] === 'emissao' || q['momento'] === 'recebimento' ? q['momento'] : 'pagamento';
    const municipio = Number(q['municipio']) || null;
    return this.ler(req, (l, est) =>
      sugestaoRetencao(l, est, { valorBruto: valor, data, participante, momento, municipio }),
    );
  }

  @Get('retencao/em-aberto')
  @Permissao('financeiro.reinf.ler')
  emAberto(@Query('competencia') c: string | undefined, @Req() req: RequisicaoAutorizada) {
    const p = competencia(c);
    return this.ler(req, (l, est) => retidoEmAberto(l, est, p));
  }

  @Post('retencao/recolhimento')
  @HttpCode(200)
  @Permissao('financeiro.tituloPagar.criar')
  @AuditadoNoHandler('financeiro.gerarRecolhimentoRetencao pelo executor (trilha na mesma transação)')
  recolher(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.gerarRecolhimentoRetencao',
      corpo(esquemaRecolhimento, b),
      'Título do recolhimento gerado; as retenções da competência ficam ligadas a ele.',
    );
  }
}
