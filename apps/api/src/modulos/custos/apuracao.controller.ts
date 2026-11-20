// Apuração do custo do mês, resultado e exportação (M54, etapa 5; ficha, seção 7 "Apuração do custo do mês" e
// "Resultado e margem"):
//   GET  /api/custos/apuracao/apoio                 grupos, situações, agrupamentos, destinos e as ações permitidas
//   GET  /api/custos/apuracao?competencia           a apuração vigente da competência, o histórico e os bloqueios
//   POST /api/custos/apuracao                       apurar a competência (absorção e custo por conta)
//   POST /api/custos/apuracao/:id/aprovacao         aprovar a apuração (pela versão lida)
//   GET  /api/custos/apuracao/relatorio?competencia o relatório de custos da apuração vigente (PDF/A pelo Gotenberg)
//   POST /api/custos/apuracao/exportacao            gerar o arquivo da apuração aprovada (Próprio, ApuraSUS, Federassantas)
//   GET  /api/custos/resultado?competencia&agrupamento   resultado e margem agrupados, com os indicadores
//   GET  /api/custos/resultado/contas?competencia&...    custo e margem por conta (paginado; a conta pelo número)
// Ler a apuração: `custos.apuracao.ler`; apurar: `custos.apuracao.apurar`; aprovar: `custos.apuracao.aprovar`;
// exportar: `custos.apuracao.exportar`; resultado e contas: `custos.resultado.ler`. As gravações e a exportação exigem
// a chave `custos` no estabelecimento (POL-3); as gravações vão com a SGH_TRILHA na mesma transação (com a porta em
// memória, o registrador da API registra).
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  type ApoioApuracaoCustos,
  type ApuracaoCustos,
  type ArquivoExportacaoCustos,
  esquemaAprovarApuracao,
  esquemaApurarCustos,
  esquemaConsultaApuracao,
  esquemaConsultaContasCusto,
  esquemaConsultaResultado,
  esquemaExportarCustos,
  EVENTOS_AUDITAVEIS,
  type PaginaContasCusto,
  type PainelApuracao,
  PERMISSOES_CUSTOS_CODIGOS as P,
  type ResultadoCustos,
} from '@sgh/contratos';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, linhaTrilha, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { LiberacaoPep } from '../pep/liberacao-pep.js';
import { CHAVE_LIBERACAO_CUSTOS } from './custos.controller.js';
import { PORTA_CUSTOS, type PortaCustos } from './porta.js';
import type { SessaoCustos } from './servico.js';
import { htmlRelatorioCustos } from './relatorio-custos.js';
import { ServicoApuracaoCustos } from './servico-apuracao.js';

export const GERADOR_PDF_CUSTOS = Symbol('GERADOR_PDF_CUSTOS');
type GeradorPdf = (html: string, titulo: string) => Promise<Buffer>;
type Resposta = { header(n: string, v: string): unknown; send(b: unknown): unknown };

function invalido(erro: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}): ErroProblema {
  return new ErroProblema(
    'entrada-invalida',
    400,
    'Dados inválidos',
    erro.issues[0]?.message ?? 'Confira os campos.',
    { campos: [...new Set(erro.issues.map((i) => i.path.map(String).join('.')))] },
  );
}

function hojeNoEstabelecimento(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

@Controller('custos')
export class ApuracaoCustosController {
  readonly servico: ServicoApuracaoCustos;
  private readonly liberacao: LiberacaoPep;

  constructor(
    @Inject(PORTA_CUSTOS) private readonly porta: PortaCustos,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(GERADOR_PDF_CUSTOS) private readonly pdf: GeradorPdf | null = null,
  ) {
    this.servico = new ServicoApuracaoCustos(porta);
    this.liberacao = new LiberacaoPep(configuracao, cache);
  }

  private sessao(s: SessaoCadastro): SessaoCustos {
    return {
      rede: s.rede,
      hospital: s.hospital,
      login: s.login,
      pode: (c) => s.pode(c),
      trilha: (evento, operacao, tabela, id) =>
        linhaTrilha(s, evento, 'custos.apuracao', operacao, { tabela, id: id === null ? null : String(id) }),
    };
  }

  /** Com a porta em memória, a trilha da gravação é a do registrador da API (no núcleo, vai na transação). */
  private async trilhaMemoria(s: SessaoCadastro, evento: string, id: number): Promise<void> {
    if (this.porta.destino !== 'memoria') return;
    await this.trilha.registrar({
      evento,
      rede: s.rede,
      hospital: s.hospital,
      usuario: s.login,
      estacao: estacaoDaRequisicao(s.req).slice(0, 80),
      correlacao: correlacaoDaRequisicao(s.req, `custos-apuracao-${id}`).slice(0, 64),
      recurso: 'custos.apuracao',
      resultado: 'sucesso',
      tabelaAlvo: 'MEMORIA',
      idAlvo: String(id),
    });
  }

  @Get('apuracao/apoio')
  @Permissao(P.apuracaoLer)
  @Auditar(EVENTOS_AUDITAVEIS.custosApuracaoLida.codigo)
  async apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioApuracaoCustos> {
    const s = sessaoDe(req);
    const [l, d] = await Promise.all([
      this.liberacao.consultar(s, CHAVE_LIBERACAO_CUSTOS),
      this.porta.dominios({ rede: s.rede, hospital: s.hospital }),
    ]);
    return this.servico.apoio(
      this.sessao(s),
      l.ligada,
      new Map(d.gruposExportacao.map((g) => [g.id, g.ativo])),
    );
  }

  @Get('apuracao')
  @Permissao(P.apuracaoLer)
  @Auditar(EVENTOS_AUDITAVEIS.custosApuracaoLida.codigo)
  async painel(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PainelApuracao> {
    const c = esquemaConsultaApuracao.safeParse(q);
    if (!c.success) throw invalido(c.error);
    return this.servico.painel(this.sessao(sessaoDe(req)), c.data.competencia);
  }

  @Post('apuracao')
  @HttpCode(201)
  @Permissao(P.apuracaoApurar)
  @AuditadoNoHandler('SGH_TRILHA na transação SGH_ da apuração (só valores e contagens; a conta pelo ID)')
  async apurar(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<ApuracaoCustos> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVE_LIBERACAO_CUSTOS);
    const d = esquemaApurarCustos.safeParse(corpo);
    if (!d.success) throw invalido(d.error);
    const r = await this.servico.apurar(this.sessao(s), d.data, hojeNoEstabelecimento());
    await this.trilhaMemoria(s, EVENTOS_AUDITAVEIS.custosApurado.codigo, r.id);
    return r;
  }

  @Post('apuracao/:id/aprovacao')
  @HttpCode(200)
  @Permissao(P.apuracaoAprovar)
  @AuditadoNoHandler('SGH_TRILHA na transação SGH_ da aprovação da apuração')
  async aprovar(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ApuracaoCustos> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVE_LIBERACAO_CUSTOS);
    const n = idDaRota(id);
    const d = esquemaAprovarApuracao.safeParse(corpo);
    if (!d.success) throw invalido(d.error);
    const r = await this.servico.aprovar(this.sessao(s), n, d.data.versao);
    await this.trilhaMemoria(s, EVENTOS_AUDITAVEIS.custosApuracaoAprovada.codigo, n);
    return r;
  }

  /** O relatório de custos da apuração vigente; sem o conversor (dev sem Gotenberg), o HTML. */
  @Get('apuracao/relatorio')
  @Permissao(P.apuracaoLer)
  @Auditar(EVENTOS_AUDITAVEIS.custosApuracaoLida.codigo)
  async relatorio(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
    @Res() res: Resposta,
  ): Promise<unknown> {
    const c = esquemaConsultaApuracao.safeParse(q);
    if (!c.success) throw invalido(c.error);
    const p = await this.servico.painel(this.sessao(sessaoDe(req)), c.data.competencia);
    if (!p.apuracao)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Competência sem apuração',
        'A competência ainda não foi apurada: apure antes de gerar o relatório.',
      );
    const html = htmlRelatorioCustos(p.apuracao);
    if (!this.pdf) {
      res.header('content-type', 'text/html; charset=utf-8');
      return res.send(html);
    }
    const pdf = await this.pdf(html, `Relatório de custos ${p.competencia}`).catch(() => null);
    if (!pdf)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Gerador de PDF indisponível',
        'O conversor de PDF/A não respondeu.',
      );
    res.header('content-type', 'application/pdf');
    res.header('content-disposition', `attachment; filename="relatorio-custos-${p.competencia}.pdf"`);
    return res.send(pdf);
  }

  @Post('apuracao/exportacao')
  @HttpCode(200)
  @Permissao(P.apuracaoExportar)
  @Auditar(EVENTOS_AUDITAVEIS.custosExportacaoGerada.codigo)
  async exportar(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<ArquivoExportacaoCustos> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVE_LIBERACAO_CUSTOS);
    const d = esquemaExportarCustos.safeParse(corpo);
    if (!d.success) throw invalido(d.error);
    return this.servico.exportar(this.sessao(s), d.data.competencia, d.data.destino);
  }

  @Get('resultado')
  @Permissao(P.resultadoLer)
  @Auditar(EVENTOS_AUDITAVEIS.custosResultadoLido.codigo)
  async resultado(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoCustos> {
    const c = esquemaConsultaResultado.safeParse(q);
    if (!c.success) throw invalido(c.error);
    return this.servico.resultado(this.sessao(sessaoDe(req)), c.data.competencia, c.data.agrupamento);
  }

  @Get('resultado/contas')
  @Permissao(P.resultadoLer)
  @Auditar(EVENTOS_AUDITAVEIS.custosContasLidas.codigo)
  async contas(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PaginaContasCusto> {
    const c = esquemaConsultaContasCusto.safeParse(q);
    if (!c.success) throw invalido(c.error);
    return this.servico.contas(this.sessao(sessaoDe(req)), c.data);
  }
}
