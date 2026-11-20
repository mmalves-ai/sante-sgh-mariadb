// Cálculo mensal da folha, parte F2 (M53.3; ficha do M53, seção 7; `Gestão de pessoas > Folha de pagamento`):
//   GET  /api/pessoas/folha/calculo/apoio                         empresas, papéis, liberação e ações da sessão
//   GET  /api/pessoas/folha/salarios?vinculo                      vigências do salário contratual (sensível, auditado)
//   POST /api/pessoas/folha/salarios                              nova vigência do salário
//   GET  /api/pessoas/folha/parametros?empresa                    vigências dos parâmetros da folha da empresa
//   POST /api/pessoas/folha/parametros                            nova vigência dos parâmetros
//   GET  /api/pessoas/folha/calculos?empresa&competencia          processamentos (cabeçalho e totais)
//   POST /api/pessoas/folha/calculos                              calcula (ou simula) a competência; pendências barram
//   GET  /api/pessoas/folha/calculos/:id                          totais por colaborador e a prova da soma
//   GET  /api/pessoas/folha/calculos/:id/vinculos/:vinculo        linhas e memória do colaborador (auditado)
//   GET  /api/pessoas/folha/calculos/:id/conferencia/pdf          relatório de conferência em PDF/A (auditado)
//   POST /api/pessoas/folha/calculos/:id/descarte                 descarta o cálculo em vigor, com motivo (13º: também
//                                                                 exige pessoas.decimo.calcular)
//   POST /api/pessoas/folha/decimo/:id/descarte                   descarta a parcela do 13º (pessoas.decimo.calcular)
// Toda gravação leva a Idempotency-Key (guarda) e a trilha; o estabelecimento vem da sessão. Nenhum CPF nem nome.
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
  type ApoioCalculoFolha,
  type DetalheProcessoFolha,
  esquemaCalcularFolha,
  esquemaDescartarProcessoFolha,
  esquemaFiltroParametrosFolha,
  esquemaFiltroProcessosFolha,
  esquemaFiltroSalarios,
  esquemaRegistrarParametrosFolha,
  esquemaRegistrarSalario,
  EVENTOS_AUDITAVEIS,
  type LinhasDoVinculoFolha,
  type ListaParametrosFolha,
  type ListaProcessosFolha,
  type ListaSalarios,
  type ResultadoCalculoFolha,
  type ResultadoFolha,
} from '@sgh/contratos';
import { AuditadoNoHandler, Auditar, Permissao } from '../../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { idDaRota, sessaoDe } from '../../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../../config/public-api.js';
import { corpo } from '../../exames/public-api.js';
import { PORTA_REALIZADO, type PortaRealizado } from '../escala/porta-realizado.js';
import { PORTA_PONTO, type PortaPonto } from '../ponto/porta-ponto.js';
import { PORTA_PESSOAS, type PortaPessoas } from '../porta.js';
import { PORTA_RUBRICAS, type PortaRubricas } from '../rubricas/porta-rubricas.js';
import {
  GERADOR_PDF_FOLHA,
  type GeradorPdfFolha,
  htmlConferenciaCalculo,
  responderPdf,
  type RespostaPdf,
} from './documentos-calculo.js';
import { PORTA_CALCULO_FOLHA, type PortaCalculoFolha } from './porta-calculo.js';
import { PORTA_FOLHA, type PortaFolha } from './porta-folha.js';
import { PERMISSOES_CALCULO_FOLHA as P, ServicoCalculoFolha } from './servico-calculo.js';

const E = EVENTOS_AUDITAVEIS;
const NA_TABELA = (t: string) => `${t} com a SGH_TRILHA na mesma transação`;

@Controller('pessoas')
export class CalculoFolhaController {
  readonly servico: ServicoCalculoFolha;

  constructor(
    @Inject(PORTA_CALCULO_FOLHA) porta: PortaCalculoFolha,
    @Inject(PORTA_FOLHA) folha: PortaFolha,
    @Inject(PORTA_RUBRICAS) rubricas: PortaRubricas,
    @Inject(PORTA_PESSOAS) pessoas: PortaPessoas,
    @Inject(PORTA_PONTO) ponto: PortaPonto,
    @Inject(PORTA_REALIZADO) realizado: PortaRealizado,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(GERADOR_PDF_FOLHA) private readonly pdf: GeradorPdfFolha | null = null,
  ) {
    this.servico = new ServicoCalculoFolha(
      porta,
      folha,
      rubricas,
      pessoas,
      ponto,
      realizado,
      trilha,
      configuracao,
      cache,
    );
  }

  @Get('folha/calculo/apoio')
  @Permissao('pessoas.folha.abrir')
  apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioCalculoFolha> {
    return this.servico.apoioTela(sessaoDe(req));
  }

  @Get('folha/salarios')
  @Permissao(P.salarioLer)
  @Auditar(E.pessoasSalarioLido.codigo)
  salarios(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<ListaSalarios> {
    const f = corpo(esquemaFiltroSalarios, q);
    req.sghAlvo = {
      tabelaAlvo: 'SGH_PES_SALARIO',
      idAlvo: String(f.vinculo),
      chaveNaturalAlvo: `vinculo:${f.vinculo}`,
    };
    return this.servico.listarSalarios(sessaoDe(req), f.vinculo);
  }

  @Post('folha/salarios')
  @HttpCode(200)
  @Permissao(P.salarioEditar)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_SALARIO'))
  registrarSalario(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFolha> {
    return this.servico.registrarSalario(sessaoDe(req), corpo(esquemaRegistrarSalario, b));
  }

  @Get('folha/parametros')
  @Permissao(P.ler)
  parametros(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaParametrosFolha> {
    return this.servico.listarParametros(sessaoDe(req), corpo(esquemaFiltroParametrosFolha, q).empresa);
  }

  @Post('folha/parametros')
  @HttpCode(200)
  @Permissao(P.parametros)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_FOLHA_PARAMETRO'))
  registrarParametros(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFolha> {
    return this.servico.registrarParametros(sessaoDe(req), corpo(esquemaRegistrarParametrosFolha, b));
  }

  @Get('folha/calculos')
  @Permissao(P.ler)
  calculos(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaProcessosFolha> {
    return this.servico.listarProcessos(sessaoDe(req), corpo(esquemaFiltroProcessosFolha, q));
  }

  @Post('folha/calculos')
  @HttpCode(200)
  @Permissao(P.calcular)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_FOLHA_PROCESSO e SGH_PES_FOLHA_CALCULO'))
  calcular(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoCalculoFolha> {
    return this.servico.calcular(sessaoDe(req), corpo(esquemaCalcularFolha, b));
  }

  /** Totais e a prova da soma; a lista por colaborador só com `pessoas.salario.ler` (D-PERM-SAL-533; leitura auditada). */
  @Get('folha/calculos/:id')
  @Permissao(P.ler)
  @Auditar(E.pessoasFolhaCalculoLido.codigo)
  detalhe(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<DetalheProcessoFolha> {
    const p = idDaRota(id);
    req.sghAlvo = { tabelaAlvo: 'SGH_PES_FOLHA_PROCESSO', idAlvo: String(p), chaveNaturalAlvo: 'detalhe' };
    return this.servico.detalhe(sessaoDe(req), p);
  }

  /** O relatório de conferência do processamento em PDF/A (IDs, contagens e somas; com `pessoas.salario.ler`; auditado). */
  @Get('folha/calculos/:id/conferencia/pdf')
  @Permissao(P.ler)
  @Auditar(E.pessoasFolhaCalculoLido.codigo)
  async conferenciaPdf(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: false }) res: RespostaPdf,
  ) {
    const p = idDaRota(id);
    // O relatório lista os valores por colaborador: exige `pessoas.salario.ler` (D-PERM-SAL-533).
    this.servico.exigirVerSalario(sessaoDe(req));
    req.sghAlvo = {
      tabelaAlvo: 'SGH_PES_FOLHA_PROCESSO',
      idAlvo: String(p),
      chaveNaturalAlvo: 'conferencia',
    };
    const d = await this.servico.detalhe(sessaoDe(req), p);
    return responderPdf(
      this.pdf,
      res,
      htmlConferenciaCalculo(d),
      `Conferência da folha ${d.processo.competencia}`,
      `conferencia-folha-${d.processo.competencia}-${d.processo.numero}`,
    );
  }

  @Get('folha/calculos/:id/vinculos/:vinculo')
  @Permissao(P.ler)
  @Auditar(E.pessoasFolhaCalculoLido.codigo)
  linhas(
    @Param('id') id: string,
    @Param('vinculo') vinculo: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<LinhasDoVinculoFolha> {
    const p = idDaRota(id);
    const v = idDaRota(vinculo);
    req.sghAlvo = {
      tabelaAlvo: 'SGH_PES_FOLHA_CALCULO',
      idAlvo: String(p),
      chaveNaturalAlvo: `vinculo:${v}`,
    };
    return this.servico.linhasDoVinculo(sessaoDe(req), p, v);
  }

  @Post('folha/calculos/:id/descarte')
  @HttpCode(200)
  @Permissao(P.calcular)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_FOLHA_PROCESSO'))
  descartar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFolha> {
    return this.servico.descartar(sessaoDe(req), idDaRota(id), corpo(esquemaDescartarProcessoFolha, b));
  }

  @Post('folha/decimo/:id/descarte')
  @HttpCode(200)
  @Permissao(P.decimo)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_FOLHA_PROCESSO'))
  descartarDecimo(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFolha> {
    return this.servico.descartar(
      sessaoDe(req),
      idDaRota(id),
      corpo(esquemaDescartarProcessoFolha, b),
      'decimo',
    );
  }
}
