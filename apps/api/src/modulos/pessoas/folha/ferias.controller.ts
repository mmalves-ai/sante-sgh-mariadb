// Férias e 13º salário, parte F3 (M53.4; ficha do M53, seção 7; `Gestão de pessoas > Folha de pagamento (rubricas,
// férias, rescisão)`):
//   GET  /api/pessoas/folha/ferias/apoio                 empresas, liberação e ações da sessão
//   GET  /api/pessoas/folha/ferias/saldo?vinculo         períodos aquisitivos, saldo e frações do colaborador
//   GET  /api/pessoas/folha/ferias?vinculo&de&ate&situacao   escala de férias (frações que tocam o intervalo)
//   POST /api/pessoas/folha/ferias                       programa uma fração (recusa com o motivo da CLT)
//   GET  /api/pessoas/folha/ferias/:id                   a fração e o recibo (valores só com o salário; auditado)
//   GET  /api/pessoas/folha/ferias/:id/recibo/pdf        aviso e recibo de férias em PDF/A (com o salário; auditado)
//   POST /api/pessoas/folha/ferias/:id/calculo           prévia ou recibo gravado; pendências barram
//   POST /api/pessoas/folha/ferias/:id/cancelamento      cancela a programação ou o recibo, com motivo
//   GET  /api/pessoas/folha/decimo?empresa&ano           parcelas do 13º (processamentos decimo1 e decimo2)
//   POST /api/pessoas/folha/decimo                       calcula (ou simula) a 1ª parcela ou a final do 13º
// O detalhe, a memória por colaborador e o PDF de conferência do 13º são os das rotas do cálculo (`folha/calculos/:id`);
// o descarte da parcela tem rota própria com a permissão do 13º (`folha/decimo/:id/descarte`, no controlador do cálculo). Toda gravação leva a Idempotency-Key (guarda) e a trilha; o estabelecimento vem da sessão.
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
  type ApoioFeriasDecimo,
  type DetalheFerias,
  esquemaCalcularDecimo,
  esquemaCalcularFerias,
  esquemaCancelarFerias,
  esquemaFiltroDecimo,
  esquemaFiltroFerias,
  esquemaFiltroSaldoFerias,
  esquemaProgramarFerias,
  EVENTOS_AUDITAVEIS,
  type ListaFerias,
  type ListaProcessosFolha,
  type ResultadoCalculoDecimo,
  type ResultadoCalculoFerias,
  type ResultadoFolha,
  type ResultadoProgramacaoFerias,
  type SaldoFerias,
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
import { PORTA_PESSOAS, type PortaPessoas } from '../porta.js';
import { PORTA_RUBRICAS, type PortaRubricas } from '../rubricas/porta-rubricas.js';
import {
  GERADOR_PDF_FOLHA,
  type GeradorPdfFolha,
  htmlReciboFerias,
  responderPdf,
  type RespostaPdf,
} from './documentos-calculo.js';
import { PORTA_CALCULO_FOLHA, type PortaCalculoFolha } from './porta-calculo.js';
import { PORTA_FOLHA, type PortaFolha } from './porta-folha.js';
import { PERMISSOES_FERIAS_FOLHA as P, ServicoFeriasFolha } from './servico-ferias.js';

const E = EVENTOS_AUDITAVEIS;
const NA_TABELA = (t: string) => `${t} com a SGH_TRILHA na mesma transação`;

@Controller('pessoas/folha')
export class FeriasFolhaController {
  readonly servico: ServicoFeriasFolha;

  constructor(
    @Inject(PORTA_CALCULO_FOLHA) porta: PortaCalculoFolha,
    @Inject(PORTA_FOLHA) folha: PortaFolha,
    @Inject(PORTA_RUBRICAS) rubricas: PortaRubricas,
    @Inject(PORTA_PESSOAS) pessoas: PortaPessoas,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(GERADOR_PDF_FOLHA) private readonly pdf: GeradorPdfFolha | null = null,
  ) {
    this.servico = new ServicoFeriasFolha(porta, folha, rubricas, pessoas, trilha, configuracao, cache);
  }

  @Get('ferias/apoio')
  @Permissao('pessoas.folha.abrir')
  apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioFeriasDecimo> {
    return this.servico.apoioTela(sessaoDe(req));
  }

  @Get('ferias/saldo')
  @Permissao(P.ler)
  saldo(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<SaldoFerias> {
    return this.servico.saldo(sessaoDe(req), corpo(esquemaFiltroSaldoFerias, q).vinculo);
  }

  @Get('ferias')
  @Permissao(P.ler)
  listar(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<ListaFerias> {
    return this.servico.listar(sessaoDe(req), corpo(esquemaFiltroFerias, q));
  }

  @Post('ferias')
  @HttpCode(200)
  @Permissao(P.programar)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_FERIAS'))
  programar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoProgramacaoFerias> {
    return this.servico.programar(sessaoDe(req), corpo(esquemaProgramarFerias, b));
  }

  /** A fração e o recibo; os valores e a memória só com `pessoas.salario.ler` (D-PERM-SAL-533; leitura auditada). */
  @Get('ferias/:id')
  @Permissao(P.ler)
  @Auditar(E.pessoasFeriasLida.codigo)
  detalhe(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<DetalheFerias> {
    const f = idDaRota(id);
    req.sghAlvo = { tabelaAlvo: 'SGH_PES_FERIAS', idAlvo: String(f), chaveNaturalAlvo: 'detalhe' };
    return this.servico.detalhe(sessaoDe(req), f);
  }

  /** O aviso e o recibo de férias em PDF/A (os valores exigem `pessoas.salario.ler`, D-PERM-SAL-533; leitura auditada). */
  @Get('ferias/:id/recibo/pdf')
  @Permissao(P.ler)
  @Auditar(E.pessoasFeriasLida.codigo)
  async reciboPdf(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: false }) res: RespostaPdf,
  ) {
    const f = idDaRota(id);
    req.sghAlvo = { tabelaAlvo: 'SGH_PES_FERIAS', idAlvo: String(f), chaveNaturalAlvo: 'recibo' };
    const { detalhe, matricula } = await this.servico.recibo(sessaoDe(req), f);
    return responderPdf(
      this.pdf,
      res,
      htmlReciboFerias(detalhe, matricula),
      `Recibo de férias ${detalhe.ferias.inicio}`,
      `recibo-ferias-${detalhe.ferias.vinculo}-${detalhe.ferias.inicio}`,
    );
  }

  @Post('ferias/:id/calculo')
  @HttpCode(200)
  @Permissao(P.calcular)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_FERIAS, SGH_PES_FOLHA_PROCESSO e SGH_PES_FOLHA_CALCULO'))
  calcular(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoCalculoFerias> {
    return this.servico.calcular(sessaoDe(req), idDaRota(id), corpo(esquemaCalcularFerias, b));
  }

  @Post('ferias/:id/cancelamento')
  @HttpCode(200)
  @Permissao(P.programar)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_FERIAS e SGH_PES_FOLHA_PROCESSO'))
  cancelar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFolha> {
    return this.servico.cancelar(sessaoDe(req), idDaRota(id), corpo(esquemaCancelarFerias, b));
  }

  @Get('decimo')
  @Permissao(P.folhaLer)
  decimos(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaProcessosFolha> {
    return this.servico.listarDecimo(sessaoDe(req), corpo(esquemaFiltroDecimo, q));
  }

  @Post('decimo')
  @HttpCode(200)
  @Permissao(P.decimo)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_FOLHA_PROCESSO e SGH_PES_FOLHA_CALCULO'))
  calcularDecimo(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoCalculoDecimo> {
    return this.servico.calcularDecimo(sessaoDe(req), corpo(esquemaCalcularDecimo, b));
  }
}
