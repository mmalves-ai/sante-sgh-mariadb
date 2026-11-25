// Plantão realizado e o relatório ao repasse (M52.6; ficha do M52, seções 5 e 7; item `Gestão de pessoas > Escala de
// plantão (médica e de enfermagem)`; DP-33):
//   GET  /api/pessoas/realizado/apoio                           liberação, ações, unidades e a situação do repasse
//   GET  /api/pessoas/realizado?competencia&unidade&situacao    os plantões publicados com o realizado
//   GET  /api/pessoas/realizado/plantoes/:id/sugestao           o horário real pelas marcações do ponto
//   POST /api/pessoas/realizado/plantoes/:id                    registrar o realizado (`pessoas.realizado.registrar`)
//   POST /api/pessoas/realizado/:id/decisao                     aprovar ou recusar (`pessoas.realizado.aprovar`)
//   POST /api/pessoas/realizado/:id/estorno                     W0-06: estornar o aprovado, com motivo (o lançado leva o
//                                                               lançamento negativo; o já apurado recusa com 409)
//   GET  /api/pessoas/realizado/tarifas ; POST ; POST :id/encerramento   tarifas por hora (`pessoas.realizado.lancar`)
//   GET  /api/pessoas/realizado/regras-plantao ; POST ; POST :id/encerramento  regras de plantão do repasse (C2-100)
//   GET  /api/pessoas/realizado/repasse?competencia [/pdf | /csv]        o relatório de plantões realizados ao repasse
//   POST /api/pessoas/realizado/repasse/lancamento              o lançamento no repasse (executor; chave e DP-33)
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
  type ApoioRealizado,
  esquemaDecidirRealizado,
  esquemaEncerrarTarifa,
  esquemaEstornarRealizado,
  esquemaFiltroRealizado,
  esquemaLancarPlantoesRepasse,
  esquemaRegistrarRealizado,
  esquemaRelatorioRepasse,
  esquemaTarifaPlantao,
  esquemaRegraPlantao,
  esquemaEncerrarRegraPlantao,
  type ListaRegrasPlantao,
  type ListaRealizado,
  type ListaTarifas,
  type RelatorioRepasse,
  type ResultadoF6,
  type ResultadoLancamentoPlantao,
  type SugestaoRealizado,
} from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { csv, idDaRota, sessaoDe } from '../../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../../config/public-api.js';
import { corpo } from '../../exames/public-api.js';
import { PORTA_PESSOAS, type PortaPessoas } from '../porta.js';
import { PORTA_PONTO, type PortaPonto } from '../ponto/porta-ponto.js';
import { htmlRelatorioRepasse } from '../treinamento/documentos-f6.js';
import {
  enviarPdfF6,
  GERADOR_PDF_F6,
  type GeradorPdfF6,
  type RespostaF6,
} from '../treinamento/treinamento.controller.js';
import { PORTA_REALIZADO, type PortaRealizado } from './porta-realizado.js';
import { ServicoRealizado } from './servico-realizado.js';

const NA_TABELA = (t: string) => `${t} com a trilha_auditoria na mesma transação`;

@Controller('pessoas/realizado')
export class RealizadoController {
  readonly servico: ServicoRealizado;

  constructor(
    @Inject(PORTA_REALIZADO) porta: PortaRealizado,
    @Inject(PORTA_PESSOAS) pessoas: PortaPessoas,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(PORTA_PONTO) ponto: PortaPonto | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(GERADOR_PDF_F6) private readonly pdf: GeradorPdfF6 | null = null,
  ) {
    this.servico = new ServicoRealizado(porta, pessoas, ponto, trilha, configuracao, cache);
  }

  @Get('apoio')
  @Permissao('pessoas.realizado.ler')
  apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioRealizado> {
    return this.servico.apoioTela(sessaoDe(req));
  }

  @Get()
  @Permissao('pessoas.realizado.ler')
  lista(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<ListaRealizado> {
    return this.servico.lista(sessaoDe(req), corpo(esquemaFiltroRealizado, q));
  }

  @Get('plantoes/:id/sugestao')
  @Permissao('pessoas.realizado.registrar')
  sugestao(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<SugestaoRealizado> {
    return this.servico.sugestao(sessaoDe(req), idDaRota(id));
  }

  @Post('plantoes/:id')
  @HttpCode(200)
  @Permissao('pessoas.realizado.registrar')
  @AuditadoNoHandler(NA_TABELA('plantao'))
  registrar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoF6> {
    return this.servico.registrar(
      sessaoDe(req),
      corpo(esquemaRegistrarRealizado, { ...(b as object), plantao: idDaRota(id) }),
    );
  }

  @Post(':id/decisao')
  @HttpCode(200)
  @Permissao('pessoas.realizado.aprovar')
  @AuditadoNoHandler(NA_TABELA('plantao'))
  decidir(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoF6> {
    return this.servico.decidir(
      sessaoDe(req),
      corpo(esquemaDecidirRealizado, { ...(b as object), realizado: idDaRota(id) }),
    );
  }

  @Post(':id/estorno')
  @HttpCode(200)
  @Permissao('pessoas.realizado.aprovar')
  @AuditadoNoHandler(NA_TABELA('plantao (o lançamento negativo pelo executor)'))
  estornar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoF6> {
    return this.servico.estornar(
      sessaoDe(req),
      corpo(esquemaEstornarRealizado, { ...(b as object), realizado: idDaRota(id) }),
    );
  }

  @Get('tarifas')
  @Permissao('pessoas.realizado.ler')
  tarifas(@Req() req: RequisicaoAutorizada): Promise<ListaTarifas> {
    return this.servico.tarifas(sessaoDe(req));
  }

  @Post('tarifas')
  @HttpCode(200)
  @Permissao('pessoas.realizado.lancar')
  @AuditadoNoHandler(NA_TABELA('valor_hora_plantao'))
  incluirTarifa(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoF6> {
    return this.servico.incluirTarifa(sessaoDe(req), corpo(esquemaTarifaPlantao, b));
  }

  @Post('tarifas/:id/encerramento')
  @HttpCode(200)
  @Permissao('pessoas.realizado.lancar')
  @AuditadoNoHandler(NA_TABELA('valor_hora_plantao'))
  encerrarTarifa(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoF6> {
    return this.servico.encerrarTarifa(
      sessaoDe(req),
      corpo(esquemaEncerrarTarifa, { ...(b as object), tarifa: idDaRota(id) }),
    );
  }

  @Get('regras-plantao')
  @Permissao('pessoas.realizado.ler')
  regrasPlantao(@Req() req: RequisicaoAutorizada): Promise<ListaRegrasPlantao> {
    return this.servico.regrasPlantao(sessaoDe(req));
  }

  @Post('regras-plantao')
  @HttpCode(200)
  @Permissao('pessoas.realizado.lancar')
  @AuditadoNoHandler(NA_TABELA('regra_repasse_plantao'))
  incluirRegraPlantao(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoF6> {
    return this.servico.incluirRegraPlantao(sessaoDe(req), corpo(esquemaRegraPlantao, b));
  }

  @Post('regras-plantao/:id/encerramento')
  @HttpCode(200)
  @Permissao('pessoas.realizado.lancar')
  @AuditadoNoHandler(NA_TABELA('regra_repasse_plantao'))
  encerrarRegraPlantao(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoF6> {
    return this.servico.encerrarRegraPlantao(
      sessaoDe(req),
      corpo(esquemaEncerrarRegraPlantao, { ...(b as object), regra: idDaRota(id) }),
    );
  }

  @Get('repasse')
  @Permissao('pessoas.realizado.ler')
  relatorio(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<RelatorioRepasse> {
    return this.servico.relatorio(sessaoDe(req), corpo(esquemaRelatorioRepasse, q).competencia);
  }

  @Get('repasse/pdf')
  @Permissao('pessoas.realizado.ler')
  async relatorioPdf(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
    @Res() res: RespostaF6,
  ) {
    const s = sessaoDe(req);
    const c = corpo(esquemaRelatorioRepasse, q).competencia;
    const [r, { hoje }] = await Promise.all([
      this.servico.relatorio(s, c),
      this.servico.porta.relogio(s.porta),
    ]);
    return enviarPdfF6(
      this.pdf,
      res,
      htmlRelatorioRepasse(r, hoje),
      `Plantões realizados ${c}`,
      `plantoes-realizados-${c}`,
    );
  }

  @Get('repasse/csv')
  @Permissao('pessoas.realizado.ler')
  async relatorioCsv(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
    @Res() res: RespostaF6,
  ) {
    const c = corpo(esquemaRelatorioRepasse, q).competencia;
    const r = await this.servico.relatorio(sessaoDe(req), c);
    const linhas = [
      'competencia;prestador;nome;plantoes;minutos;valor;conta',
      ...r.grupos.map((g) =>
        [g.competencia, g.prestador, g.nome, g.plantoes, g.minutos, g.valor.toFixed(2), g.parcelas]
          .map(csv)
          .join(';'),
      ),
    ];
    res.header('content-type', 'text/csv; charset=utf-8');
    res.header('content-disposition', `attachment; filename="plantoes-realizados-${c}.csv"`);
    return res.send(`${linhas.join('\n')}\n`);
  }

  @Post('repasse/lancamento')
  @HttpCode(200)
  @Permissao('pessoas.realizado.lancar')
  @AuditadoNoHandler('repasse.lancarEvento (origem plantão) pelo executor, com a trilha na mesma transação')
  lancar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoLancamentoPlantao> {
    return this.servico.lancar(sessaoDe(req), corpo(esquemaLancarPlantoesRepasse, b));
  }
}
