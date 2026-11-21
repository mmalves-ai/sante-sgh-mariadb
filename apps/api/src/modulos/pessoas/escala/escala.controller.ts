// Telas "Escala do setor" e "Regimes e banco de horas" (M52.2; ficha do M52, seção 7; `Gestão de pessoas > Escala de
// plantão` e `Gestão de pessoas > Programação de escala e banco de horas`):
//   GET  /api/pessoas/escala/apoio                                   unidades, domínios, regimes, liberação, ações
//   GET  /api/pessoas/escala/colaboradores                           colaboradores ativos com o regime (sem CPF)
//   GET  /api/pessoas/escalas                                        escalas do estabelecimento
//   POST /api/pessoas/escalas                                        nova escala (rascunho)
//   GET  /api/pessoas/escalas/:escala                                a grade mês × profissional, furos e a trilha
//   POST /api/pessoas/escalas/:escala/cobertura                      cobertura mínima (publicada: com motivo)
//   POST /api/pessoas/escalas/:escala/plantoes                       incluir plantão (regras 3 e 5 a 8)
//   POST /api/pessoas/escalas/:escala/plantoes/:plantao              alterar plantão
//   POST /api/pessoas/escalas/:escala/plantoes/:plantao/cancelamento cancelar plantão (nunca apagado)
//   POST /api/pessoas/escalas/:escala/publicacao                     publicar (só o perfil de gestor de escala)
//   POST /api/pessoas/escalas/:escala/exclusao                       W0-06: excluir o rascunho (só sem vínculo; retrato)
//   POST /api/pessoas/escalas/:escala/cancelamento                   W0-06: cancelar a publicada com motivo
//   POST /api/pessoas/regimes/vigencias/:vigencia/anulacao           W0-06: anular a vigência lançada por engano
//   GET  /api/pessoas/regimes/apoio | /regimes | /regimes/colaboradores[/:vinculo]   regimes e vigências
//   POST /api/pessoas/regimes | /regimes/:regime | /regimes/atribuicao              incluir, alterar, atribuir
// Toda gravação leva a Idempotency-Key. O estabelecimento vem da sessão.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type ApoioEscala,
  esquemaAlterarCobertura,
  esquemaAlterarPlantao,
  esquemaAlterarRegime,
  esquemaAnularVigencia,
  esquemaAtribuirRegime,
  esquemaCancelarEscala,
  esquemaCancelarPlantao,
  esquemaCriarEscala,
  esquemaExcluirEscala,
  esquemaFiltroColaboradoresEscala,
  esquemaFiltroEscalas,
  esquemaIncluirPlantao,
  esquemaIncluirRegime,
  esquemaPublicarEscala,
  type GradeEscala,
  type ListaColaboradoresEscala,
  type ListaEscalas,
  type ListaRegimes,
  type ResultadoEscala,
  type VigenciaRegime,
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
import { PORTA_PONTO, type PortaPonto } from '../ponto/porta-ponto.js';
import { PORTA_ESCALA, type PortaEscala } from './porta-escala.js';
import { ServicoEscala } from './servico-escala.js';

const TRILHA_PLANTAO =
  'plantao, escala (versão) e publicacao_escala com a trilha_auditoria na mesma transação';

@Controller('pessoas')
export class EscalaController {
  readonly servico: ServicoEscala;

  constructor(
    @Inject(PORTA_ESCALA) porta: PortaEscala,
    @Inject(PORTA_PESSOAS) pessoas: PortaPessoas,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(PORTA_PONTO) ponto: PortaPonto | null = null,
  ) {
    this.servico = new ServicoEscala(porta, pessoas, trilha, configuracao, cache, ponto);
  }

  // ── Escala ──

  @Get('escala/apoio')
  @Permissao('pessoas.escala.ler')
  apoioEscala(@Req() req: RequisicaoAutorizada): Promise<ApoioEscala> {
    return this.servico.apoioTela(sessaoDe(req));
  }

  @Get('escala/colaboradores')
  @Permissao('pessoas.escala.montar')
  colaboradoresEscala(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaColaboradoresEscala> {
    return this.servico.colaboradores(sessaoDe(req), corpo(esquemaFiltroColaboradoresEscala, q));
  }

  @Get('escalas')
  @Permissao('pessoas.escala.ler')
  escalas(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<ListaEscalas> {
    return this.servico.escalas(sessaoDe(req), corpo(esquemaFiltroEscalas, q));
  }

  @Post('escalas')
  @HttpCode(200)
  @Permissao('pessoas.escala.montar')
  @AuditadoNoHandler('escala e publicacao_escala com a trilha_auditoria na mesma transação')
  criarEscala(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoEscala> {
    return this.servico.criarEscala(sessaoDe(req), corpo(esquemaCriarEscala, b));
  }

  @Get('escalas/:escala')
  @Permissao('pessoas.escala.ler')
  grade(@Param('escala') escala: string, @Req() req: RequisicaoAutorizada): Promise<GradeEscala> {
    return this.servico.grade(sessaoDe(req), idDaRota(escala));
  }

  @Post('escalas/:escala/cobertura')
  @HttpCode(200)
  @Permissao('pessoas.escala.montar')
  @AuditadoNoHandler(
    'escala e publicacao_escala com a trilha_auditoria (e a integracao_mensagem se publicada)',
  )
  cobertura(
    @Param('escala') escala: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEscala> {
    return this.servico.alterarCobertura(
      sessaoDe(req),
      corpo(esquemaAlterarCobertura, { ...(b as object), escala: idDaRota(escala) }),
    );
  }

  @Post('escalas/:escala/plantoes')
  @HttpCode(200)
  @Permissao('pessoas.escala.montar')
  @AuditadoNoHandler(TRILHA_PLANTAO)
  incluirPlantao(
    @Param('escala') escala: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEscala> {
    return this.servico.incluirPlantao(
      sessaoDe(req),
      corpo(esquemaIncluirPlantao, { ...(b as object), escala: idDaRota(escala) }),
    );
  }

  @Post('escalas/:escala/plantoes/:plantao')
  @HttpCode(200)
  @Permissao('pessoas.escala.montar')
  @AuditadoNoHandler(TRILHA_PLANTAO)
  alterarPlantao(
    @Param('escala') escala: string,
    @Param('plantao') plantao: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEscala> {
    return this.servico.alterarPlantao(
      sessaoDe(req),
      corpo(esquemaAlterarPlantao, {
        ...(b as object),
        escala: idDaRota(escala),
        plantao: idDaRota(plantao),
      }),
    );
  }

  @Post('escalas/:escala/plantoes/:plantao/cancelamento')
  @HttpCode(200)
  @Permissao('pessoas.escala.montar')
  @AuditadoNoHandler(TRILHA_PLANTAO)
  cancelarPlantao(
    @Param('escala') escala: string,
    @Param('plantao') plantao: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEscala> {
    return this.servico.cancelarPlantao(
      sessaoDe(req),
      corpo(esquemaCancelarPlantao, {
        ...(b as object),
        escala: idDaRota(escala),
        plantao: idDaRota(plantao),
      }),
    );
  }

  @Post('escalas/:escala/publicacao')
  @HttpCode(200)
  @Permissao('pessoas.escala.publicar')
  @AuditadoNoHandler(
    'escala, publicacao_escala e integracao_mensagem com a trilha_auditoria na mesma transação',
  )
  publicar(
    @Param('escala') escala: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEscala> {
    return this.servico.publicar(
      sessaoDe(req),
      corpo(esquemaPublicarEscala, { ...(b as object), escala: idDaRota(escala) }),
    );
  }

  @Post('escalas/:escala/exclusao')
  @HttpCode(200)
  @Permissao('pessoas.escala.montar')
  @AuditadoNoHandler(
    'o retrato na trilha e o DELETE de escala, plantao e publicacao_escala com a trilha_auditoria na mesma transação',
  )
  excluirEscala(
    @Param('escala') escala: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEscala> {
    return this.servico.excluirEscala(
      sessaoDe(req),
      corpo(esquemaExcluirEscala, { ...(b as object), escala: idDaRota(escala) }),
    );
  }

  @Post('escalas/:escala/cancelamento')
  @HttpCode(200)
  @Permissao('pessoas.escala.publicar')
  @AuditadoNoHandler(
    'escala (cancelada), plantao, publicacao_escala e integracao_mensagem com a trilha_auditoria na mesma transação',
  )
  cancelarEscala(
    @Param('escala') escala: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEscala> {
    return this.servico.cancelarEscala(
      sessaoDe(req),
      corpo(esquemaCancelarEscala, { ...(b as object), escala: idDaRota(escala) }),
    );
  }

  // ── Regimes ──

  @Get('regimes/apoio')
  @Permissao('pessoas.regime.ler')
  apoioRegimes(@Req() req: RequisicaoAutorizada): Promise<ApoioEscala> {
    return this.servico.apoioTela(sessaoDe(req));
  }

  @Get('regimes')
  @Permissao('pessoas.regime.ler')
  regimes(@Req() req: RequisicaoAutorizada): Promise<ListaRegimes> {
    return this.servico.regimes(sessaoDe(req));
  }

  @Get('regimes/colaboradores')
  @Permissao('pessoas.regime.ler')
  colaboradoresRegime(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaColaboradoresEscala> {
    return this.servico.colaboradores(sessaoDe(req), corpo(esquemaFiltroColaboradoresEscala, q));
  }

  @Get('regimes/colaboradores/:vinculo')
  @Permissao('pessoas.regime.ler')
  vigencias(@Param('vinculo') vinculo: string, @Req() req: RequisicaoAutorizada): Promise<VigenciaRegime[]> {
    return this.servico.vigencias(sessaoDe(req), idDaRota(vinculo));
  }

  @Post('regimes')
  @HttpCode(200)
  @Permissao('pessoas.regime.editar')
  @AuditadoNoHandler('regime_jornada com a trilha_auditoria na mesma transação')
  incluirRegime(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoEscala> {
    return this.servico.incluirRegime(sessaoDe(req), corpo(esquemaIncluirRegime, b));
  }

  @Post('regimes/atribuicao')
  @HttpCode(200)
  @Permissao('pessoas.regime.editar')
  @AuditadoNoHandler('vigencia_regime_colaborador com a trilha_auditoria na mesma transação')
  atribuirRegime(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoEscala> {
    return this.servico.atribuirRegime(sessaoDe(req), corpo(esquemaAtribuirRegime, b));
  }

  @Post('regimes/vigencias/:vigencia/anulacao')
  @HttpCode(200)
  @Permissao('pessoas.regime.editar')
  @AuditadoNoHandler('vigencia_regime_colaborador (anulação) com a trilha_auditoria na mesma transação')
  anularVigencia(
    @Param('vigencia') vigencia: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEscala> {
    return this.servico.anularVigencia(
      sessaoDe(req),
      corpo(esquemaAnularVigencia, { ...(b as object), vigencia: idDaRota(vigencia) }),
    );
  }

  @Post('regimes/:regime')
  @HttpCode(200)
  @Permissao('pessoas.regime.editar')
  @AuditadoNoHandler('regime_jornada com a trilha_auditoria na mesma transação')
  alterarRegime(
    @Param('regime') regime: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEscala> {
    return this.servico.alterarRegime(
      sessaoDe(req),
      corpo(esquemaAlterarRegime, { ...(b as object), id: idDaRota(regime) }),
    );
  }
}
