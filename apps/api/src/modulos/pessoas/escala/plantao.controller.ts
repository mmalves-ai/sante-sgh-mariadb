// Telas "Trocas de plantão", "Quem está de plantão agora" e "Dimensionamento de enfermagem" (M52.3; ficha do M52, seção
// 7; `Gestão de pessoas > Escala de plantão (médica e de enfermagem)` e `Gestão de pessoas > Dimensionamento de
// enfermagem (COFEN 543/2017)`):
//   GET  /api/pessoas/trocas/apoio                         escalas publicadas, liberação e ações da pessoa da sessão
//   GET  /api/pessoas/trocas                               trocas (quem só pede vê só as suas)
//   GET  /api/pessoas/trocas/escala/:escala                plantões da escala publicada que ainda não começaram
//   POST /api/pessoas/trocas                               pedir a troca ou a cessão (regra 8)
//   POST /api/pessoas/trocas/:troca/resposta               aceite ou recusa do colega
//   POST /api/pessoas/trocas/:troca/decisao                aprovação ou reprovação (gestor de escala)
//   POST /api/pessoas/trocas/:troca/cancelamento           cancelamento por quem pediu
//   GET  /api/pessoas/plantao-agora                        quem está de plantão no instante (regra 10)
//   POST /api/pessoas/plantao-agora/acionamentos           acionar o sobreaviso
//   POST /api/pessoas/plantao-agora/acionamentos/:id/chegada | /cancelamento
//   GET  /api/pessoas/dimensionamento/apoio | /dimensionamentos
//   POST /api/pessoas/dimensionamento/previa               o cálculo com as parcelas (nada é gravado)
//   POST /api/pessoas/dimensionamentos                     registrar o cálculo (regra 9)
// Toda gravação leva a Idempotency-Key. O estabelecimento vem da sessão.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type ApoioDimensionamento,
  type ApoioTrocas,
  type DimensionamentoLido,
  esquemaAcionarSobreaviso,
  esquemaCalcularDimensionamento,
  esquemaCancelarAcionamento,
  esquemaCancelarTroca,
  esquemaDecidirTroca,
  esquemaFiltroDimensionamentos,
  esquemaFiltroPlantaoAgora,
  esquemaFiltroTrocas,
  esquemaPedirTroca,
  esquemaRegistrarChegadaSobreaviso,
  esquemaResponderTroca,
  type ListaDimensionamentos,
  type ListaTrocas,
  type PlantaoAgora,
  type PlantoesParaTroca,
  type ResultadoEscala,
} from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../../autorizacao/decoradores.js';
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
import { PORTA_ESCALA, type PortaEscala } from './porta-escala.js';
import { ServicoEscala } from './servico-escala.js';
import { ServicoPlantao } from './servico-plantao.js';

const TRILHA_TROCA = 'SGH_PES_TROCA com a SGH_TRILHA na mesma transação';
const TRILHA_ACIONAMENTO = 'SGH_PES_ACIONAMENTO com a SGH_TRILHA na mesma transação';

@Controller('pessoas')
export class PlantaoController {
  readonly servico: ServicoPlantao;

  constructor(
    @Inject(PORTA_ESCALA) porta: PortaEscala,
    @Inject(PORTA_PESSOAS) pessoas: PortaPessoas,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    const escala = new ServicoEscala(porta, pessoas, trilha, configuracao, cache);
    this.servico = new ServicoPlantao(escala, porta, pessoas, trilha, configuracao, cache);
  }

  // ── Trocas ──

  @Get('trocas/apoio')
  @Permissao('pessoas.troca.pedir')
  apoioTrocas(@Req() req: RequisicaoAutorizada): Promise<ApoioTrocas> {
    return this.servico.apoioTrocas(sessaoDe(req));
  }

  @Get('trocas')
  @Permissao('pessoas.troca.pedir')
  trocas(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<ListaTrocas> {
    return this.servico.trocas(sessaoDe(req), corpo(esquemaFiltroTrocas, q));
  }

  @Get('trocas/escala/:escala')
  @Permissao('pessoas.troca.pedir')
  plantoesParaTroca(
    @Param('escala') escala: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PlantoesParaTroca> {
    return this.servico.plantoesParaTroca(sessaoDe(req), idDaRota(escala));
  }

  @Post('trocas')
  @HttpCode(200)
  @Permissao('pessoas.troca.pedir')
  @AuditadoNoHandler('SGH_PES_TROCA e SGH_OUTBOX com a SGH_TRILHA na mesma transação')
  pedirTroca(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoEscala> {
    return this.servico.pedirTroca(sessaoDe(req), corpo(esquemaPedirTroca, b));
  }

  @Post('trocas/:troca/resposta')
  @HttpCode(200)
  @Permissao('pessoas.troca.pedir')
  @AuditadoNoHandler(TRILHA_TROCA)
  responderTroca(
    @Param('troca') troca: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEscala> {
    return this.servico.responderTroca(
      sessaoDe(req),
      corpo(esquemaResponderTroca, { ...(b as object), troca: idDaRota(troca) }),
    );
  }

  @Post('trocas/:troca/decisao')
  @HttpCode(200)
  @Permissao('pessoas.troca.aprovar')
  @AuditadoNoHandler(
    'SGH_PES_TROCA; na aprovação, SGH_PES_PLANTAO, SGH_PES_ESCALA (versão), SGH_PES_ESCALA_EVENTO e SGH_OUTBOX, com a SGH_TRILHA na mesma transação',
  )
  decidirTroca(
    @Param('troca') troca: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEscala> {
    return this.servico.decidirTroca(
      sessaoDe(req),
      corpo(esquemaDecidirTroca, { ...(b as object), troca: idDaRota(troca) }),
    );
  }

  @Post('trocas/:troca/cancelamento')
  @HttpCode(200)
  @Permissao('pessoas.troca.pedir')
  @AuditadoNoHandler(TRILHA_TROCA)
  cancelarTroca(
    @Param('troca') troca: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEscala> {
    return this.servico.cancelarTroca(
      sessaoDe(req),
      corpo(esquemaCancelarTroca, { ...(b as object), troca: idDaRota(troca) }),
    );
  }

  // ── Quem está de plantão agora e o sobreaviso ──

  @Get('plantao-agora')
  @Permissao('pessoas.plantao.ler')
  plantaoAgora(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<PlantaoAgora> {
    return this.servico.plantaoAgora(sessaoDe(req), corpo(esquemaFiltroPlantaoAgora, q));
  }

  @Post('plantao-agora/acionamentos')
  @HttpCode(200)
  @Permissao('pessoas.sobreaviso.acionar')
  @AuditadoNoHandler('SGH_PES_ACIONAMENTO e SGH_OUTBOX com a SGH_TRILHA na mesma transação')
  acionar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoEscala> {
    return this.servico.acionar(sessaoDe(req), corpo(esquemaAcionarSobreaviso, b));
  }

  @Post('plantao-agora/acionamentos/:acionamento/chegada')
  @HttpCode(200)
  @Permissao('pessoas.sobreaviso.acionar')
  @AuditadoNoHandler(TRILHA_ACIONAMENTO)
  chegada(
    @Param('acionamento') acionamento: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEscala> {
    return this.servico.registrarChegada(
      sessaoDe(req),
      corpo(esquemaRegistrarChegadaSobreaviso, { ...(b as object), acionamento: idDaRota(acionamento) }),
    );
  }

  @Post('plantao-agora/acionamentos/:acionamento/cancelamento')
  @HttpCode(200)
  @Permissao('pessoas.sobreaviso.acionar')
  @AuditadoNoHandler(TRILHA_ACIONAMENTO)
  cancelarAcionamento(
    @Param('acionamento') acionamento: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEscala> {
    return this.servico.cancelarAcionamento(
      sessaoDe(req),
      corpo(esquemaCancelarAcionamento, { ...(b as object), acionamento: idDaRota(acionamento) }),
    );
  }

  // ── Dimensionamento ──

  @Get('dimensionamento/apoio')
  @Permissao('pessoas.dimensionamento.ler')
  apoioDimensionamento(@Req() req: RequisicaoAutorizada): Promise<ApoioDimensionamento> {
    return this.servico.apoioDimensionamento(sessaoDe(req));
  }

  @Get('dimensionamentos')
  @Permissao('pessoas.dimensionamento.ler')
  dimensionamentos(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaDimensionamentos> {
    return this.servico.dimensionamentos(sessaoDe(req), corpo(esquemaFiltroDimensionamentos, q));
  }

  @Post('dimensionamento/previa')
  @HttpCode(200)
  @Permissao('pessoas.dimensionamento.ler')
  @AuditadoNoHandler('prévia: só leitura, nada é gravado (POST pelo tamanho do pedido)')
  previa(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<DimensionamentoLido> {
    return this.servico.calcular(sessaoDe(req), corpo(esquemaCalcularDimensionamento, b));
  }

  @Post('dimensionamentos')
  @HttpCode(200)
  @Permissao('pessoas.dimensionamento.calcular')
  @AuditadoNoHandler('SGH_PES_DIMENSIONAMENTO (só inclusão) com a SGH_TRILHA na mesma transação')
  registrar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoEscala> {
    return this.servico.registrarDimensionamento(sessaoDe(req), corpo(esquemaCalcularDimensionamento, b));
  }
}
