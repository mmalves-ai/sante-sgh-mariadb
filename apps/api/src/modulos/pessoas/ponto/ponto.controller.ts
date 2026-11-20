// Telas do ponto (M52.4; ficha do M52, seção 7; `Gestão de pessoas > Ponto eletrônico (marcações, justificativas)` e
// `Gestão de pessoas > Programação de escala e banco de horas`):
//   GET  /api/pessoas/ponto/apoio ; GET ponto/colaboradores            domínios, liberação, ações, parâmetros; busca
//   GET  /api/pessoas/ponto/arquivos ; GET arquivos/:id ; POST arquivos  arquivo do relógio (validação e quarentena)
//   GET  /api/pessoas/ponto/painel                                     o período de cada colaborador
//   GET  /api/pessoas/ponto/espelho/:vinculo/:competencia[/pdf]         espelho (dado pessoal: leitura auditada)
//   POST /api/pessoas/ponto/ajustes ; POST ajustes/:id/decisao          ajuste e justificativa; aprovação por outra pessoa
//   POST /api/pessoas/ponto/ajustes/:id/desistencia                     W0-06: o próprio solicitante desiste do pendente
//   POST /api/pessoas/ponto/fechamento | reabertura | banco/acerto      período e banco de horas
//   GET  /api/pessoas/ponto/aej | eventos-folha                         arquivo de jornada (com o CPF) e eventos da folha
//   GET  /api/pessoas/ponto/meu[/pdf] ; POST meu/ciencia                o próprio espelho e a ciência
//   GET|POST /api/pessoas/ponto/regras-banco                            a regra do banco de horas de cada regime
//   POST /api/pessoas/ponto/regras-banco/:regime/situacao               W0-06: desativar ou reativar a regra, com motivo
// A marcação e o arquivo do relógio (AFD) NÃO têm rota de alteração nem de exclusão (Dec. 10.854/2021, art. 31, § 2º,
// I): o ajuste só acrescenta, com justificativa e aprovador (o portão W0-06 confere).
// Toda gravação leva a Idempotency-Key (guarda) e a trilha; o estabelecimento vem da sessão.
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
  type ApoioPonto,
  type ArquivoAfdDetalhe,
  type EspelhoPonto,
  esquemaAcertoBanco,
  esquemaDesistirAjuste,
  esquemaSituacaoRegraBanco,
  esquemaBuscaColaboradorPonto,
  esquemaCienciaEspelho,
  esquemaCompetenciaEscala,
  esquemaDecidirAjuste,
  esquemaEspelhoPonto,
  esquemaExportarPonto,
  esquemaFecharPeriodo,
  esquemaFiltroArquivosAfd,
  esquemaFiltroPonto,
  esquemaImportarAfd,
  esquemaLancarAjuste,
  esquemaReabrirPeriodo,
  esquemaRegraBanco,
  EVENTOS_AUDITAVEIS,
  type ListaArquivosAfd,
  type MeuEspelho,
  type PainelPonto,
  type RegrasBancoLista,
  type ResultadoImportacaoAfd,
  type ResultadoPonto,
} from '@sgh/contratos';
import { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import { idDaRota, sessaoDe } from '../../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../../config/public-api.js';
import { corpo } from '../../exames/public-api.js';
import type { CifraCpf } from '../cifra-cpf.js';
import { PORTA_ESCALA, type PortaEscala } from '../escala/porta-escala.js';
import { CIFRA_CPF_PESSOAS } from '../pessoas.controller.js';
import { PORTA_PESSOAS, type PortaPessoas } from '../porta.js';
import { htmlEspelho } from './documentos-ponto.js';
import { PORTA_PONTO, type PortaPonto } from './porta-ponto.js';
import { ServicoPonto } from './servico-ponto.js';

export const GERADOR_PDF_PONTO = Symbol('GERADOR_PDF_PONTO');
type GeradorPdf = (html: string, titulo: string) => Promise<Buffer>;
type Resposta = { header(n: string, v: string): unknown; send(b: unknown): unknown };

const E = EVENTOS_AUDITAVEIS;
const NA_TABELA = (t: string) => `${t} com a SGH_TRILHA na mesma transação`;
const esquemaMeu = z
  .object({
    competencia: esquemaCompetenciaEscala.optional(),
    vinculo: z.coerce.number().int().positive().optional(),
  })
  .strict();

@Controller('pessoas')
export class PontoController {
  readonly servico: ServicoPonto;

  constructor(
    @Inject(PORTA_PONTO) porta: PortaPonto,
    @Inject(PORTA_PESSOAS) pessoas: PortaPessoas,
    @Inject(PORTA_ESCALA) escala: PortaEscala,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(CIFRA_CPF_PESSOAS) cifra: CifraCpf | null = null,
    @Optional() @Inject(GERADOR_PDF_PONTO) private readonly pdf: GeradorPdf | null = null,
  ) {
    this.servico = new ServicoPonto(porta, pessoas, escala, trilha, configuracao, cache, cifra);
  }

  private async enviarPdf(res: Resposta, html: string, titulo: string, arquivo: string) {
    if (!this.pdf) {
      res.header('content-type', 'text/html; charset=utf-8');
      return res.send(html);
    }
    const pdf = await this.pdf(html, titulo).catch(() => null);
    if (!pdf)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Gerador de PDF indisponível',
        'O conversor de PDF/A não respondeu.',
      );
    res.header('content-type', 'application/pdf');
    res.header('content-disposition', `attachment; filename="${arquivo}.pdf"`);
    return res.send(pdf);
  }

  // ── Apoio, busca e arquivos do relógio ──────────────────────────────────────────────────────────────────────

  @Get('ponto/apoio')
  @Permissao('pessoas.ponto.ler')
  apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioPonto> {
    return this.servico.apoioTela(sessaoDe(req));
  }

  @Get('ponto/colaboradores')
  @Permissao('pessoas.ponto.ler')
  busca(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const f = corpo(esquemaBuscaColaboradorPonto, q);
    return this.servico.buscarColaboradores(sessaoDe(req), f.termo, f.estado);
  }

  @Get('ponto/arquivos')
  @Permissao('pessoas.ponto.ler')
  arquivos(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<ListaArquivosAfd> {
    return this.servico.listarArquivos(sessaoDe(req), corpo(esquemaFiltroArquivosAfd, q));
  }

  @Get('ponto/arquivos/:id')
  @Permissao('pessoas.ponto.ler')
  arquivo(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<ArquivoAfdDetalhe> {
    return this.servico.arquivo(sessaoDe(req), idDaRota(id));
  }

  @Post('ponto/arquivos')
  @HttpCode(200)
  @Permissao('pessoas.ponto.importar')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_AFD_ARQUIVO e SGH_PES_MARCACAO'))
  importar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoImportacaoAfd> {
    return this.servico.importarAfd(sessaoDe(req), corpo(esquemaImportarAfd, b));
  }

  // ── Painel e espelho ────────────────────────────────────────────────────────────────────────────────────────

  @Get('ponto/painel')
  @Permissao('pessoas.ponto.ler')
  painel(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<PainelPonto> {
    return this.servico.painel(sessaoDe(req), corpo(esquemaFiltroPonto, q));
  }

  @Get('ponto/espelho/:vinculo/:competencia')
  @Permissao('pessoas.ponto.ler')
  @Auditar(E.pessoasPontoLido.codigo)
  espelho(
    @Param('vinculo') v: string,
    @Param('competencia') c: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<EspelhoPonto> {
    const f = corpo(esquemaEspelhoPonto, { vinculo: v, competencia: c });
    return this.servico.espelho(sessaoDe(req), f.vinculo, f.competencia);
  }

  @Get('ponto/espelho/:vinculo/:competencia/pdf')
  @Permissao('pessoas.ponto.ler')
  @Auditar(E.pessoasPontoLido.codigo)
  async espelhoPdf(
    @Param('vinculo') v: string,
    @Param('competencia') c: string,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: false }) res: Resposta,
  ) {
    const f = corpo(esquemaEspelhoPonto, { vinculo: v, competencia: c });
    const e = await this.servico.espelho(sessaoDe(req), f.vinculo, f.competencia);
    return this.enviarPdf(
      res,
      htmlEspelho(e),
      `Espelho de ponto ${f.competencia}`,
      `espelho-${f.vinculo}-${f.competencia}`,
    );
  }

  // ── Ajustes ─────────────────────────────────────────────────────────────────────────────────────────────────

  @Post('ponto/ajustes')
  @HttpCode(200)
  @Permissao('pessoas.ponto.justificar')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_PONTO_AJUSTE'))
  lancar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoPonto> {
    return this.servico.lancarAjuste(sessaoDe(req), corpo(esquemaLancarAjuste, b));
  }

  @Post('ponto/ajustes/:id/decisao')
  @HttpCode(200)
  @Permissao('pessoas.ponto.aprovar')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_PONTO_AJUSTE'))
  decidir(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoPonto> {
    return this.servico.decidirAjuste(
      sessaoDe(req),
      corpo(esquemaDecidirAjuste, { ...(b as object), ajuste: idDaRota(id) }),
    );
  }

  @Post('ponto/ajustes/:id/desistencia')
  @HttpCode(200)
  @Permissao('pessoas.ponto.justificar')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_PONTO_AJUSTE'))
  desistir(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoPonto> {
    return this.servico.desistirAjuste(
      sessaoDe(req),
      corpo(esquemaDesistirAjuste, { ...(b as object), ajuste: idDaRota(id) }),
    );
  }

  // ── Período e banco de horas ────────────────────────────────────────────────────────────────────────────────

  @Post('ponto/fechamento')
  @HttpCode(200)
  @Permissao('pessoas.ponto.aprovar')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_PONTO_FECHAMENTO e SGH_PES_BANCO_HORAS'))
  fechar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoPonto> {
    return this.servico.fechar(sessaoDe(req), corpo(esquemaFecharPeriodo, b));
  }

  @Post('ponto/reabertura')
  @HttpCode(200)
  @Permissao('pessoas.ponto.aprovar')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_PONTO_FECHAMENTO e SGH_PES_BANCO_HORAS'))
  reabrir(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoPonto> {
    return this.servico.reabrir(sessaoDe(req), corpo(esquemaReabrirPeriodo, b));
  }

  @Post('ponto/banco/acerto')
  @HttpCode(200)
  @Permissao('pessoas.ponto.aprovar')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_BANCO_HORAS'))
  acerto(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoPonto> {
    return this.servico.acertoBanco(sessaoDe(req), corpo(esquemaAcertoBanco, b));
  }

  @Get('ponto/regras-banco')
  @Permissao('pessoas.regime.ler')
  regras(@Req() req: RequisicaoAutorizada): Promise<RegrasBancoLista> {
    return this.servico.regrasBanco(sessaoDe(req));
  }

  @Post('ponto/regras-banco')
  @HttpCode(200)
  @Permissao('pessoas.regime.editar')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_BANCO_REGRA'))
  gravarRegra(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoPonto> {
    return this.servico.gravarRegraBanco(sessaoDe(req), corpo(esquemaRegraBanco, b));
  }

  @Post('ponto/regras-banco/:regime/situacao')
  @HttpCode(200)
  @Permissao('pessoas.regime.editar')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_BANCO_REGRA'))
  situacaoRegra(
    @Param('regime') regime: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoPonto> {
    return this.servico.situacaoRegraBanco(
      sessaoDe(req),
      corpo(esquemaSituacaoRegraBanco, { ...(b as object), regime: idDaRota(regime) }),
    );
  }

  // ── Exportações (com o CPF no AEJ: leitura auditada) ────────────────────────────────────────────────────────

  @Get('ponto/aej')
  @Permissao('pessoas.ponto.exportar')
  @Auditar(E.pessoasPontoExportado.codigo)
  async aej(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: false }) res: Resposta,
  ) {
    const f = corpo(esquemaExportarPonto, q);
    const r = await this.servico.aej(sessaoDe(req), f.competencia);
    res.header('content-type', 'text/plain; charset=utf-8');
    res.header('content-disposition', `attachment; filename="${r.nome}"`);
    return res.send(r.conteudo);
  }

  @Get('ponto/eventos-folha')
  @Permissao('pessoas.ponto.exportar')
  @Auditar(E.pessoasPontoExportado.codigo)
  async eventosFolha(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: false }) res: Resposta,
  ) {
    const f = corpo(esquemaExportarPonto, q);
    const s = sessaoDe(req);
    const t = await this.servico.eventosFolha(s, f.competencia);
    res.header('content-type', 'text/csv; charset=utf-8');
    res.header(
      'content-disposition',
      `attachment; filename="eventos-ponto-${s.hospital}-${f.competencia}.csv"`,
    );
    return res.send(t);
  }

  // ── O próprio espelho ───────────────────────────────────────────────────────────────────────────────────────

  @Get('ponto/meu')
  @Permissao('pessoas.ponto.ciencia')
  @Auditar(E.pessoasPontoLido.codigo)
  meu(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<MeuEspelho> {
    const f = corpo(esquemaMeu, q);
    return this.servico.meuEspelho(sessaoDe(req), f.competencia ?? null, f.vinculo ?? null);
  }

  @Get('ponto/meu/pdf')
  @Permissao('pessoas.ponto.ciencia')
  @Auditar(E.pessoasPontoLido.codigo)
  async meuPdf(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: false }) res: Resposta,
  ) {
    const f = corpo(esquemaMeu, q);
    const m = await this.servico.meuEspelho(sessaoDe(req), f.competencia ?? null, f.vinculo ?? null);
    if (!m.espelho)
      throw new ErroProblema('nao-encontrado', 404, 'Espelho não encontrado', 'Nenhum período fechado.');
    return this.enviarPdf(
      res,
      htmlEspelho(m.espelho),
      `Espelho de ponto ${m.espelho.competencia}`,
      `espelho-${m.espelho.competencia}`,
    );
  }

  @Post('ponto/meu/ciencia')
  @HttpCode(200)
  @Permissao('pessoas.ponto.ciencia')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_PONTO_FECHAMENTO'))
  ciencia(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoPonto> {
    return this.servico.ciencia(sessaoDe(req), corpo(esquemaCienciaEspelho, b));
  }
}
