// Financeiro e fiscal (M32; ficha, seções 4, 5 e 7). Telas de trabalho sobre os títulos, movimentos e cadastros do banco
// do cliente (porta própria), com alçada, conciliação, glosa no título, fluxo e fiscal:
//   GET  /api/financeiro/gravacao | apoio | worklist | indicadores
//   GET  /api/financeiro/pagar/titulos (auditada) | pagar/titulos/:id ; POST pagar/titulos | pagar/titulos/:id/excluir
//   GET  /api/financeiro/pagar/aprovacao ; POST pagar/titulos/:id/aprovar ; GET/POST alcadas
//   GET  /api/financeiro/pagar/borderos ; POST pagar/baixa ; GET/POST pagar/remessas ; GET pagar/adiantamentos
//   POST /api/financeiro/dados/mostrar (auditada: o documento sem máscara, com a finalidade)
//   GET  /api/financeiro/receber/titulos (auditada) | receber/titulos/:id | receber/contas-sem-titulo
//   POST receber/titulos | receber/competencia | receber/titulos/:id/baixa | receber/titulos/:id/glosa
//   GET  receber/convenios | receber/renegociacoes
//   GET  /api/financeiro/tesouraria/movimento ; POST tesouraria/movimento ; GET tesouraria/conciliacao
//   POST tesouraria/extratos | tesouraria/conciliacao ; GET tesouraria/creditos ; POST tesouraria/creditos/:id/atribuir
//   GET  tesouraria/fluxo-caixa ; GET gerencial/dre | gerencial/apropriacoes
//   GET  fiscal/entradas | fiscal/nfse | fiscal/declaracoes | contabil/lotes | contabil/de-para
//   POST fiscal/nfse | fiscal/declaracoes/dmed | fiscal/declaracoes/reinf | contabil/lotes
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type AdiantamentoResposta,
  type ApoioFinanceiro,
  type BorderoResposta,
  type ConciliacaoResposta,
  type ContaSemTituloResposta,
  type CreditoPendenteResposta,
  type DetalheTituloPagarResposta,
  type DetalheTituloReceberResposta,
  type DreResposta,
  type EscrituracaoResposta,
  esquemaAprovarTitulo,
  esquemaAtribuirCredito,
  esquemaCompensarAdiantamento,
  esquemaConcederAdiantamento,
  esquemaDevolverAdiantamento,
  esquemaBaixarTitulo,
  esquemaConciliar,
  esquemaCriarTituloPagar,
  esquemaCriarTituloReceber,
  esquemaEmitirNfse,
  esquemaExportarLoteContabil,
  esquemaFaixaAlcada,
  esquemaGerarDeclaracao,
  esquemaGerarRemessa,
  esquemaImportarExtrato,
  esquemaLancarMovimento,
  esquemaMostrarDado,
  esquemaRegistrarGlosaTitulo,
  EVENTOS_AUDITAVEIS,
  type FaixaAlcadaResposta,
  type FluxoCaixaResposta,
  type GravacaoFinanceiro,
  type IndicadorResposta,
  type ItemFilaAprovacao,
  type ListaApropriacoes,
  type ListaTitulosPagar,
  type ListaTitulosReceber,
  type MovimentoResposta,
  type RegistroFiscalResposta,
  type ResultadoFinanceiro,
  PERMISSAO_MODULO_FINANCEIRO,
  type WorklistFinanceiro,
} from '@sgh/contratos';
import {
  ROTULO_TIPO_CREDOR,
  ROTULO_TIPO_MOVIMENTO,
  SITUACOES_TITULO_PAGAR,
  somarDias,
  TIPOS_CREDOR,
} from '@sgh/dominio-financeiro';
import { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { exigir, idDaRota, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { corpo, inteiroOuNulo } from '../exames/public-api.js';
import { ApoiosFinanceiro } from './apoios.js';
import { ARMAZEM_FINANCEIRO } from './simbolos.js';
import type { ArmazemFinanceiro } from './armazem.js';
import { type ContextoFinanceiro, PORTA_FINANCEIRO, type PortaFinanceiro } from './porta.js';
import { ServicoFinanceiro } from './servico.js';

const ctx = (s: { porta: ContextoFinanceiro }): ContextoFinanceiro => s.porta;
const E = EVENTOS_AUDITAVEIS;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const dataOu = (v: string | undefined, padrao: string): string => {
  if (v === undefined || v === '') return padrao;
  if (!DATA.test(v)) throw new ErroProblema('entrada-invalida', 400, 'Data inválida', 'Use AAAA-MM-DD.');
  return v;
};
const pagina = (v: string | undefined) => Math.min(10_000, Math.max(0, inteiroOuNulo(v) ?? 0));
const esquemaCompetencia = z
  .object({
    convenio: z.number().int().min(0).max(32_767),
    ano: z.number().int().min(2000).max(2100),
    mes: z.number().int().min(1).max(12),
    vencimento: z.string().regex(DATA),
    documento: z.number().int().min(0).max(2_147_483_647).default(0),
  })
  .strict();
const esquemaBaixaManual = z
  .object({
    versao: z.string().min(10).max(40).nullable().default(null),
    conta: z.number().int().positive(),
    dataRecebimento: z.string().regex(DATA),
    valorRecebido: z.number().positive(),
    formaPagamento: z.number().int().min(0).max(99),
    motivo: z.string(),
  })
  .strict();

/** O corpo da declaração com o tipo da rota (DMED na rota da DMED; R-2000 ou R-4000 na da REINF). */
function declaracaoDaRota(b: unknown, rota: 'dmed' | 'reinf') {
  const e = corpo(esquemaGerarDeclaracao, b);
  if ((e.tipo === 'dmed') !== (rota === 'dmed'))
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Tipo de declaração inválido',
      'O tipo não é o desta rota.',
      {
        campos: ['tipo'],
      },
    );
  return e;
}

@Controller('financeiro')
export class FinanceiroController {
  readonly apoios: ApoiosFinanceiro;
  readonly servico: ServicoFinanceiro;
  constructor(
    @Inject(PORTA_FINANCEIRO) private readonly porta: PortaFinanceiro,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Inject(ARMAZEM_FINANCEIRO) armazem: ArmazemFinanceiro,
    @Optional() @Inject(FONTE_CONFIGURACAO) fonteConfiguracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    const ambiente = (process.env['AMBIENTE'] ?? 'dev').trim() || 'dev';
    this.apoios = new ApoiosFinanceiro(porta, trilha, fonteConfiguracao, cache, ambiente);
    this.servico = new ServicoFinanceiro(porta, this.apoios, ambiente, armazem);
  }

  // ── Situação, apoio, fila e indicadores ──────────────────────────────────────────────────────────────────────

  // D-MODULO-32: a situação, o apoio e a fila servem a todas as telas do módulo (quem tem qualquer opção do financeiro).
  @Get('gravacao')
  @Permissao(PERMISSAO_MODULO_FINANCEIRO)
  gravacao(@Req() req: RequisicaoAutorizada): Promise<GravacaoFinanceiro> {
    return this.apoios.gravacao(sessaoDe(req));
  }

  @Get('apoio')
  @Permissao(PERMISSAO_MODULO_FINANCEIRO)
  async apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioFinanceiro> {
    const s = sessaoDe(req);
    const contas = await this.porta.contas(ctx(s), s.login);
    // O saldo da conta é do movimento bancário: sem a leitura dele, a lista leva só a identificação da conta.
    const veSaldo = s.pode('financeiro.movimento.ler');
    return {
      hoje: await this.porta.hoje(ctx(s)),
      contas: veSaldo
        ? contas
        : contas.map((c) => ({ ...c, saldo: 0, saldoFechadoEm: null, saldoApuradoOutroSistema: null })),
      classificacoes: await this.porta.classificacoes(ctx(s)),
      retencoes: await this.porta.retencoes(ctx(s)),
      formasPagamento: await this.porta.formasPagamento(ctx(s)),
      tiposCredor: TIPOS_CREDOR.map((codigo) => ({ codigo, rotulo: ROTULO_TIPO_CREDOR[codigo] })),
    };
  }

  @Get('worklist')
  @Permissao(PERMISSAO_MODULO_FINANCEIRO)
  worklist(@Req() req: RequisicaoAutorizada): Promise<WorklistFinanceiro> {
    return this.servico.worklist(sessaoDe(req));
  }

  @Get('indicadores')
  @Permissao('financeiro.indicador.ler')
  @Auditar(E.financeiroRelatorioLido.codigo)
  async indicadores(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<IndicadorResposta[]> {
    const s = sessaoDe(req);
    const hoje = await this.porta.hoje(ctx(s));
    return this.servico.indicadores(s, dataOu(q['de'], `${hoje.slice(0, 4)}-01-01`), dataOu(q['ate'], hoje));
  }

  // ── Contas a pagar ───────────────────────────────────────────────────────────────────────────────────────────

  @Get('pagar/titulos')
  @Permissao('financeiro.tituloPagar.ler')
  @Auditar(E.financeiroTitulosLidos.codigo)
  async titulosPagar(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaTitulosPagar> {
    const s = sessaoDe(req);
    const hoje = await this.porta.hoje(ctx(s));
    const sit = (q['situacao'] ?? '').trim();
    if (sit && !(SITUACOES_TITULO_PAGAR as readonly string[]).includes(sit))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Situação inválida',
        `Use ${SITUACOES_TITULO_PAGAR.join(', ')}.`,
      );
    return this.porta.titulosPagar(ctx(s), {
      situacao: (sit || null) as never,
      vencimentoDe: q['de'] ? dataOu(q['de'], hoje) : null,
      vencimentoAte: q['ate'] ? dataOu(q['ate'], hoje) : null,
      credor: inteiroOuNulo(q['credor']),
      tipo: (q['tipo'] ?? '').trim() || null,
      pagina: pagina(q['pagina']),
      hoje,
    });
  }

  @Get('pagar/titulos/:id')
  @Permissao('financeiro.tituloPagar.ler')
  tituloPagar(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DetalheTituloPagarResposta> {
    return this.servico.detalheTituloPagar(sessaoDe(req), idDaRota(id));
  }

  @Post('pagar/titulos')
  @HttpCode(200)
  @Permissao('financeiro.tituloPagar.criar')
  @AuditadoNoHandler('financeiro.criarTituloPagar pelo executor (trilha na mesma transação)')
  criarTituloPagar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.servico.criarTituloPagar(
      sessaoDe(req),
      corpo(esquemaCriarTituloPagar, { ...((b ?? {}) as object), acao: 'incluir' }),
    );
  }

  @Post('pagar/titulos/:id/excluir')
  @HttpCode(200)
  @Permissao('financeiro.tituloPagar.criar')
  @AuditadoNoHandler('financeiro.criarTituloPagar (exclusão em aberto) pelo executor')
  excluirTituloPagar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFinanceiro> {
    return this.servico.criarTituloPagar(
      sessaoDe(req),
      corpo(esquemaCriarTituloPagar, { ...((b ?? {}) as object), acao: 'excluir', titulo: idDaRota(id) }),
    );
  }

  @Get('pagar/aprovacao')
  @Permissao('financeiro.tituloPagar.ler')
  async filaAprovacao(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ItemFilaAprovacao[]> {
    return this.servico.filaAprovacao(
      sessaoDe(req),
      Math.min(365, Math.max(0, inteiroOuNulo(q['dias']) ?? 30)),
    );
  }

  @Post('pagar/titulos/:id/aprovar')
  @HttpCode(200)
  @Permissao('financeiro.tituloPagar.aprovar')
  @AuditadoNoHandler('aprovação na alçada com a trilha na mesma transação')
  aprovar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFinanceiro> {
    return this.servico.aprovar(
      sessaoDe(req),
      corpo(esquemaAprovarTitulo, { ...((b ?? {}) as object), titulo: idDaRota(id) }),
    );
  }

  @Get('alcadas')
  @Permissao('financeiro.tituloPagar.ler')
  async alcadas(@Req() req: RequisicaoAutorizada): Promise<FaixaAlcadaResposta[]> {
    return (await this.porta.faixas(ctx(sessaoDe(req)))).map((f) => ({
      id: f.id,
      centroCusto: f.centroCusto,
      tipoCredor: f.tipoCredor,
      valorDe: f.valorDe,
      valorAte: f.valorAte,
      aprovacoes: f.aprovacoes,
      permissao: f.permissao,
      vigenciaInicio: f.vigenciaInicio,
      vigenciaFim: f.vigenciaFim,
      ativa: f.ativa,
    }));
  }

  @Post('alcadas')
  @HttpCode(200)
  @Permissao('financeiro.parametro.editar')
  @AuditadoNoHandler('faixa de alçada com a trilha na mesma transação')
  salvarAlcada(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.servico.salvarFaixa(sessaoDe(req), corpo(esquemaFaixaAlcada, b));
  }

  @Get('pagar/borderos')
  @Permissao('financeiro.bordero.ler')
  async borderos(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<BorderoResposta[]> {
    const s = sessaoDe(req);
    const hoje = await this.porta.hoje(ctx(s));
    return this.porta.borderos(ctx(s), dataOu(q['de'], somarDias(hoje, -60)), dataOu(q['ate'], hoje));
  }

  @Post('pagar/baixa')
  @HttpCode(200)
  @Permissao('financeiro.tituloPagar.baixar')
  @AuditadoNoHandler('financeiro.baixarTitulo pelo executor (trilha na mesma transação)')
  baixar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.servico.baixar(
      sessaoDe(req),
      corpo(esquemaBaixarTitulo, { ...((b ?? {}) as object), cenario: 'pagar' }),
    );
  }

  @Get('pagar/remessas')
  @Permissao('financeiro.remessa.ler')
  async remessas(@Req() req: RequisicaoAutorizada): Promise<RegistroFiscalResposta[]> {
    const s = sessaoDe(req);
    // Regra 15: só as remessas das contas do escopo (permissao_conta_bancaria).
    const ids = new Set((await this.porta.contas(ctx(s), s.login)).map((c) => c.id));
    const lista = await this.porta.registrosFiscais(ctx(s), 'remessa');
    return lista.filter((r) => ids.has(Number(r['CONTA'])));
  }

  @Post('pagar/remessas')
  @HttpCode(200)
  @Permissao('financeiro.remessa.gerar')
  @AuditadoNoHandler('remessa (simulador fora de produção) com a trilha na mesma transação')
  gerarRemessa(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.servico.gerarRemessa(sessaoDe(req), corpo(esquemaGerarRemessa, b));
  }

  @Get('pagar/adiantamentos')
  @Permissao('financeiro.adiantamento.ler')
  adiantamentos(@Req() req: RequisicaoAutorizada): Promise<AdiantamentoResposta[]> {
    return this.porta.adiantamentos(ctx(sessaoDe(req)));
  }

  @Post('pagar/adiantamentos')
  @HttpCode(200)
  @Permissao('financeiro.adiantamento.conceder')
  @AuditadoNoHandler('concessão do adiantamento com a trilha na mesma transação')
  conceder(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.servico.concederAdiantamento(sessaoDe(req), corpo(esquemaConcederAdiantamento, b));
  }

  @Post('pagar/adiantamentos/:id/compensar')
  @HttpCode(200)
  @Permissao('financeiro.adiantamento.conceder')
  @AuditadoNoHandler('compensação do adiantamento com a trilha na mesma transação')
  compensar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFinanceiro> {
    return this.servico.compensarAdiantamento(
      sessaoDe(req),
      corpo(esquemaCompensarAdiantamento, { ...((b ?? {}) as object), adiantamento: Number(id) }),
    );
  }

  @Post('pagar/adiantamentos/:id/devolver')
  @HttpCode(200)
  @Permissao('financeiro.adiantamento.conceder')
  @AuditadoNoHandler('devolução do saldo do adiantamento com a trilha na mesma transação')
  devolver(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFinanceiro> {
    return this.servico.devolverAdiantamento(
      sessaoDe(req),
      corpo(esquemaDevolverAdiantamento, { ...((b ?? {}) as object), adiantamento: Number(id) }),
    );
  }

  @Post('dados/mostrar')
  @HttpCode(200)
  @Permissao('financeiro.dado.mostrar')
  @Auditar(E.financeiroDadoMostrado.codigo)
  async mostrar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<{ valor: string }> {
    const s = sessaoDe(req);
    const e = corpo(esquemaMostrarDado, b);
    await exigir(s, 'financeiro.dado.mostrar', this.trilha);
    const v = await this.porta.documentoCredor(ctx(s), e.titulo);
    if (v === null) throw new ErroProblema('nao-encontrado', 404, 'Título não encontrado');
    return { valor: v };
  }

  // ── Contas a receber ─────────────────────────────────────────────────────────────────────────────────────────

  @Get('receber/titulos')
  @Permissao('financeiro.tituloReceber.ler')
  @Auditar(E.financeiroTitulosLidos.codigo)
  async titulosReceber(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaTitulosReceber> {
    const s = sessaoDe(req);
    const hoje = await this.porta.hoje(ctx(s));
    const aberto = q['aberto'] === 'sim' ? true : q['aberto'] === 'nao' ? false : null;
    return this.porta.titulosReceber(ctx(s), {
      devedor: (q['devedor'] ?? '').trim() || null,
      convenio: inteiroOuNulo(q['convenio']),
      aberto,
      vencimentoDe: q['de'] ? dataOu(q['de'], hoje) : null,
      vencimentoAte: q['ate'] ? dataOu(q['ate'], hoje) : null,
      pagina: pagina(q['pagina']),
      hoje,
    });
  }

  @Get('receber/titulos/:id')
  @Permissao('financeiro.tituloReceber.ler')
  tituloReceber(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DetalheTituloReceberResposta> {
    return this.servico.detalheTituloReceber(sessaoDe(req), idDaRota(id));
  }

  @Get('receber/contas-sem-titulo')
  @Permissao('financeiro.tituloReceber.ler')
  async contasSemTitulo(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ContaSemTituloResposta[]> {
    const s = sessaoDe(req);
    const hoje = await this.porta.hoje(ctx(s));
    return this.porta.contasSemTitulo(ctx(s), {
      convenio: inteiroOuNulo(q['convenio']),
      ano: inteiroOuNulo(q['ano']) ?? Number(hoje.slice(0, 4)),
      mes: inteiroOuNulo(q['mes']),
    });
  }

  @Post('receber/titulos')
  @HttpCode(200)
  @Permissao('financeiro.tituloReceber.criar')
  @AuditadoNoHandler('financeiro.criarTituloReceber pelo executor (trilha na mesma transação)')
  criarTituloReceber(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.servico.criarTituloReceber(sessaoDe(req), corpo(esquemaCriarTituloReceber, b));
  }

  @Post('receber/competencia')
  @HttpCode(200)
  @Permissao('financeiro.tituloReceber.criar')
  @AuditadoNoHandler('financeiro.criarTituloReceber por grupo de contas da competência, pelo executor')
  titulosDaCompetencia(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.servico.titulosDaCompetencia(sessaoDe(req), corpo(esquemaCompetencia, b));
  }

  @Post('receber/titulos/:id/baixa')
  @HttpCode(200)
  @Permissao('financeiro.tituloReceber.baixarManual')
  @AuditadoNoHandler('financeiro.baixarTitulo (baixa manual) pelo executor')
  baixaManual(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFinanceiro> {
    const e = corpo(esquemaBaixaManual, b);
    return this.servico.baixar(
      sessaoDe(req),
      corpo(esquemaBaixarTitulo, { ...e, cenario: 'receber', titulo: idDaRota(id) }),
    );
  }

  @Post('receber/titulos/:id/glosa')
  @HttpCode(200)
  @Permissao('financeiro.tituloReceber.baixar')
  @AuditadoNoHandler('glosa no título com a trilha na mesma transação')
  glosa(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFinanceiro> {
    return this.servico.registrarGlosa(
      sessaoDe(req),
      corpo(esquemaRegistrarGlosaTitulo, { ...((b ?? {}) as object), tituloReceber: idDaRota(id) }),
    );
  }

  @Get('receber/convenios')
  @Permissao('financeiro.creditoConvenio.ler')
  convenios(@Req() req: RequisicaoAutorizada) {
    return this.porta.contaCorrenteConvenios(ctx(sessaoDe(req)));
  }

  @Get('receber/renegociacoes')
  @Permissao('financeiro.tituloReceber.ler')
  renegociacoes(@Req() req: RequisicaoAutorizada) {
    return this.porta.renegociacoes(ctx(sessaoDe(req)));
  }

  // ── Tesouraria ───────────────────────────────────────────────────────────────────────────────────────────────

  @Get('tesouraria/movimento')
  @Permissao('financeiro.movimento.ler')
  @Auditar(E.financeiroMovimentoLido.codigo)
  async movimento(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<MovimentoResposta[]> {
    const s = sessaoDe(req);
    const hoje = await this.porta.hoje(ctx(s));
    const conta = inteiroOuNulo(q['conta']);
    const contas = await this.porta.contas(ctx(s), s.login);
    // Regra 15: só a conta do escopo (permissao_conta_bancaria); fora dele, 403 (anti-IDOR).
    if (conta === null || !contas.some((c) => c.id === conta))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Fora do escopo',
        'A conta bancária não está no seu escopo de contas.',
        {
          codigo: 'fora-do-escopo',
        },
      );
    const lista = await this.porta.movimento(
      ctx(s),
      conta,
      dataOu(q['de'], somarDias(hoje, -30)),
      dataOu(q['ate'], hoje),
    );
    return lista.map((m) => ({ ...m, rotuloTipo: ROTULO_TIPO_MOVIMENTO[m.tipo] ?? m.tipo }));
  }

  @Post('tesouraria/movimento')
  @HttpCode(200)
  @Permissao('financeiro.movimento.criar')
  @AuditadoNoHandler('financeiro.lancarMovimento pelo executor (trilha na mesma transação)')
  lancarMovimento(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.servico.lancarMovimento(sessaoDe(req), corpo(esquemaLancarMovimento, b));
  }

  @Get('tesouraria/conciliacao')
  @Permissao('financeiro.conciliacao.ler')
  async conciliacao(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ConciliacaoResposta> {
    const s = sessaoDe(req);
    const conta = inteiroOuNulo(q['conta']);
    const contas = await this.porta.contas(ctx(s), s.login);
    if (conta === null || !contas.some((c) => c.id === conta))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Fora do escopo',
        'A conta bancária não está no seu escopo de contas.',
        {
          codigo: 'fora-do-escopo',
        },
      );
    return this.servico.conciliacao(s, conta);
  }

  @Post('tesouraria/extratos')
  @HttpCode(200)
  @Permissao('financeiro.conciliacao.conciliar')
  @AuditadoNoHandler('extrato (arquivo no disco local com hash) com a trilha na mesma transação')
  importarExtrato(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.servico.importarExtrato(sessaoDe(req), corpo(esquemaImportarExtrato, b));
  }

  @Post('tesouraria/conciliacao')
  @HttpCode(200)
  @Permissao('financeiro.conciliacao.conciliar')
  @AuditadoNoHandler('conciliação com a trilha na mesma transação')
  conciliar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.servico.conciliar(sessaoDe(req), corpo(esquemaConciliar, b));
  }

  @Get('tesouraria/creditos')
  @Permissao('financeiro.conciliacao.ler')
  async creditos(@Req() req: RequisicaoAutorizada): Promise<CreditoPendenteResposta[]> {
    return this.servico.creditosDoEscopo(sessaoDe(req), 180);
  }

  @Post('tesouraria/creditos/:id/atribuir')
  @HttpCode(200)
  @Permissao('financeiro.conciliacao.conciliar')
  @AuditadoNoHandler('atribuição do crédito com a trilha na mesma transação')
  atribuir(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFinanceiro> {
    const n = Number(id);
    if (!Number.isInteger(n) || n === 0) throw new ErroProblema('entrada-invalida', 400, 'Crédito inválido');
    return this.servico.atribuirCredito(
      sessaoDe(req),
      corpo(esquemaAtribuirCredito, { ...((b ?? {}) as object), credito: n }),
    );
  }

  @Get('tesouraria/fluxo-caixa')
  @Permissao('financeiro.fluxoCaixa.ler')
  @Auditar(E.financeiroRelatorioLido.codigo)
  async fluxo(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<FluxoCaixaResposta> {
    const s = sessaoDe(req);
    const hoje = await this.porta.hoje(ctx(s));
    const ag = q['agrupamento'] === 'dia' || q['agrupamento'] === 'mes' ? q['agrupamento'] : 'semana';
    return this.servico.fluxoCaixa(s, {
      de: dataOu(q['de'], somarDias(hoje, -30)),
      ate: dataOu(q['ate'], somarDias(hoje, 90)),
      agrupamento: ag,
    });
  }

  @Get('gerencial/dre')
  @Permissao('financeiro.classificacao.ler')
  @Auditar(E.financeiroRelatorioLido.codigo)
  async dre(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<DreResposta> {
    const s = sessaoDe(req);
    const hoje = await this.porta.hoje(ctx(s));
    const mes = /^\d{4}-\d{2}$/;
    const de = mes.test(q['de'] ?? '') ? (q['de'] as string) : `${hoje.slice(0, 4)}-01`;
    const ate = mes.test(q['ate'] ?? '') ? (q['ate'] as string) : hoje.slice(0, 7);
    return this.servico.dre(s, { de, ate, regua: q['regua'] === 'caixa' ? 'caixa' : 'competencia' });
  }

  @Get('gerencial/apropriacoes')
  @Permissao('financeiro.classificacao.ler')
  @Auditar(E.financeiroRelatorioLido.codigo)
  async apropriacoes(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaApropriacoes> {
    const s = sessaoDe(req);
    const hoje = await this.porta.hoje(ctx(s));
    const de = dataOu(q['de'], `${hoje.slice(0, 7)}-01`);
    const ate = dataOu(q['ate'], hoje);
    if (de > ate)
      throw new ErroProblema('entrada-invalida', 400, 'Período inválido', 'A data inicial passa da final.');
    return this.porta.apropriacoes(ctx(s), {
      de,
      ate,
      grupo: inteiroOuNulo(q['grupo']),
      pagina: pagina(q['pagina']),
    });
  }

  // ── Fiscal e contábil ────────────────────────────────────────────────────────────────────────────────────────

  @Get('fiscal/entradas')
  @Permissao('financeiro.escrituracao.ler')
  @Auditar(E.financeiroRelatorioLido.codigo)
  async entradas(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<EscrituracaoResposta[]> {
    const s = sessaoDe(req);
    const hoje = await this.porta.hoje(ctx(s));
    return this.porta.escrituracao(
      ctx(s),
      inteiroOuNulo(q['ano']) ?? Number(hoje.slice(0, 4)),
      inteiroOuNulo(q['mes']) ?? Number(hoje.slice(5, 7)),
    );
  }

  @Get('fiscal/nfse')
  @Permissao('financeiro.nfse.ler')
  nfse(@Req() req: RequisicaoAutorizada): Promise<RegistroFiscalResposta[]> {
    return this.porta.registrosFiscais(ctx(sessaoDe(req)), 'nfse');
  }

  @Post('fiscal/nfse')
  @HttpCode(200)
  @Permissao('financeiro.nfse.emitir')
  @AuditadoNoHandler('NFS-e (simulador fora de produção) com a trilha na mesma transação')
  emitirNfse(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.servico.emitirNfse(sessaoDe(req), corpo(esquemaEmitirNfse, b));
  }

  @Get('fiscal/declaracoes')
  @Permissao('financeiro.reinf.ler')
  async declaracoes(@Req() req: RequisicaoAutorizada): Promise<RegistroFiscalResposta[]> {
    const lista = await this.porta.registrosFiscais(ctx(sessaoDe(req)), 'declaracao');
    return lista.filter((r) => String(r['TIPO'] ?? '').startsWith('reinf'));
  }

  @Get('fiscal/declaracoes/dmed')
  @Permissao('financeiro.dmed.ler')
  async declaracoesDmed(@Req() req: RequisicaoAutorizada): Promise<RegistroFiscalResposta[]> {
    const lista = await this.porta.registrosFiscais(ctx(sessaoDe(req)), 'declaracao');
    return lista.filter((r) => r['TIPO'] === 'dmed');
  }

  // D-DECLARACAO-32: DMED e EFD-REINF com permissões próprias, uma rota para cada (quem só gera a DMED não precisa da
  // permissão da REINF, e vice-versa); o tipo do corpo tem de ser o da rota.
  @Post('fiscal/declaracoes/dmed')
  @HttpCode(200)
  @Permissao('financeiro.dmed.gerar')
  @AuditadoNoHandler('DMED gerada (não enviada) com a trilha na mesma transação')
  gerarDmed(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.servico.gerarDeclaracao(sessaoDe(req), declaracaoDaRota(b, 'dmed'));
  }

  @Post('fiscal/declaracoes/reinf')
  @HttpCode(200)
  @Permissao('financeiro.reinf.gerar')
  @AuditadoNoHandler('EFD-REINF gerada (não enviada) com a trilha na mesma transação')
  gerarReinf(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.servico.gerarDeclaracao(sessaoDe(req), declaracaoDaRota(b, 'reinf'));
  }

  @Get('contabil/lotes')
  @Permissao('financeiro.exportacaoContabil.ler')
  lotes(@Req() req: RequisicaoAutorizada): Promise<RegistroFiscalResposta[]> {
    return this.porta.registrosFiscais(ctx(sessaoDe(req)), 'lote');
  }

  @Get('contabil/de-para')
  @Permissao('financeiro.exportacaoContabil.ler')
  dePara(@Req() req: RequisicaoAutorizada) {
    return this.porta.deParaContabil(ctx(sessaoDe(req)));
  }

  @Post('contabil/lotes')
  @HttpCode(200)
  @Permissao('financeiro.exportacaoContabil.exportar')
  @AuditadoNoHandler('lote contábil (contagem e soma) com a trilha na mesma transação')
  exportar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.servico.exportarLoteContabil(sessaoDe(req), corpo(esquemaExportarLoteContabil, b));
  }
}
