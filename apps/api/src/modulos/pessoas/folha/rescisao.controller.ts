// Rescisão, parte F4 (M53.5; ficha do M53, seção 7; `Gestão de pessoas > Folha de pagamento (rubricas, férias,
// rescisão)`):
//   GET  /api/pessoas/folha/rescisoes/apoio                   empresas, modalidades, tipos de rescisão e ações da sessão
//   GET  /api/pessoas/folha/rescisoes/desligados?de&ate       colaboradores desligados no intervalo, com a rescisão em vigor
//   GET  /api/pessoas/folha/rescisoes?vinculo&empresa&de&ate&situacao   rescisões calculadas
//   POST /api/pessoas/folha/rescisoes                         prévia ou rescisão gravada (substitui a anterior); pendências barram
//   GET  /api/pessoas/folha/rescisoes/:id                     a rescisão e o termo (valores só com o salário; auditado)
//   GET  /api/pessoas/folha/rescisoes/:id/termo/pdf            o termo de rescisão em PDF/A (com o salário; auditado)
//   POST /api/pessoas/folha/rescisoes/:id/cancelamento        cancela a rescisão em vigor, com motivo
// A memória e o PDF de conferência do processamento são os das rotas do cálculo (`folha/calculos/:id`, que exigem
// `pessoas.salario.ler` para a rescisão); o descarte do processamento sai só pelo cancelamento daqui. Toda gravação
// leva a Idempotency-Key (guarda) e a trilha; o estabelecimento vem da sessão.
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
  type ApoioRescisao,
  type DetalheRescisao,
  esquemaCalcularRescisao,
  esquemaCancelarRescisao,
  esquemaFiltroDesligados,
  esquemaFiltroRescisoes,
  EVENTOS_AUDITAVEIS,
  type ListaDesligados,
  type ListaRescisoes,
  type ResultadoCalculoRescisao,
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
  htmlTermoRescisao,
  responderPdf,
  type RespostaPdf,
} from './documentos-calculo.js';
import { PORTA_CALCULO_FOLHA, type PortaCalculoFolha } from './porta-calculo.js';
import { PORTA_FOLHA, type PortaFolha } from './porta-folha.js';
import { PERMISSOES_RESCISAO_FOLHA as P, ServicoRescisaoFolha } from './servico-rescisao.js';

const E = EVENTOS_AUDITAVEIS;
const NA_TABELA = (t: string) => `${t} com a SGH_TRILHA na mesma transação`;

@Controller('pessoas/folha')
export class RescisaoFolhaController {
  readonly servico: ServicoRescisaoFolha;

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
    this.servico = new ServicoRescisaoFolha(
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

  @Get('rescisoes/apoio')
  @Permissao('pessoas.folha.abrir')
  apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioRescisao> {
    return this.servico.apoioTela(sessaoDe(req));
  }

  @Get('rescisoes/desligados')
  @Permissao(P.ler)
  desligados(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<ListaDesligados> {
    return this.servico.desligados(sessaoDe(req), corpo(esquemaFiltroDesligados, q));
  }

  @Get('rescisoes')
  @Permissao(P.ler)
  listar(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<ListaRescisoes> {
    return this.servico.listar(sessaoDe(req), corpo(esquemaFiltroRescisoes, q));
  }

  @Post('rescisoes')
  @HttpCode(200)
  @Permissao(P.calcular)
  @AuditadoNoHandler(
    NA_TABELA('SGH_PES_RESCISAO, SGH_PES_FOLHA_PROCESSO, SGH_PES_FOLHA_CALCULO e SGH_PES_FERIAS'),
  )
  calcular(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoCalculoRescisao> {
    return this.servico.calcular(sessaoDe(req), corpo(esquemaCalcularRescisao, b));
  }

  /** A rescisão e o termo; os valores e a memória só com `pessoas.salario.ler` (D-PERM-SAL-533; leitura auditada). */
  @Get('rescisoes/:id')
  @Permissao(P.ler)
  @Auditar(E.pessoasRescisaoLida.codigo)
  detalhe(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<DetalheRescisao> {
    const r = idDaRota(id);
    req.sghAlvo = { tabelaAlvo: 'SGH_PES_RESCISAO', idAlvo: String(r), chaveNaturalAlvo: 'detalhe' };
    return this.servico.detalhe(sessaoDe(req), r);
  }

  /** O termo de rescisão em PDF/A (exige `pessoas.salario.ler`; leitura auditada). */
  @Get('rescisoes/:id/termo/pdf')
  @Permissao(P.ler)
  @Auditar(E.pessoasRescisaoLida.codigo)
  async termoPdf(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: false }) res: RespostaPdf,
  ) {
    const r = idDaRota(id);
    req.sghAlvo = { tabelaAlvo: 'SGH_PES_RESCISAO', idAlvo: String(r), chaveNaturalAlvo: 'termo' };
    const { detalhe, matricula } = await this.servico.termo(sessaoDe(req), r);
    return responderPdf(
      this.pdf,
      res,
      htmlTermoRescisao(detalhe, matricula),
      `Termo de rescisão ${detalhe.rescisao.desligamento}`,
      `termo-rescisao-${detalhe.rescisao.vinculo}-${detalhe.rescisao.desligamento}`,
    );
  }

  @Post('rescisoes/:id/cancelamento')
  @HttpCode(200)
  @Permissao(P.calcular)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_RESCISAO e SGH_PES_FOLHA_PROCESSO'))
  cancelar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFolha> {
    return this.servico.cancelar(sessaoDe(req), idDaRota(id), corpo(esquemaCancelarRescisao, b));
  }
}
