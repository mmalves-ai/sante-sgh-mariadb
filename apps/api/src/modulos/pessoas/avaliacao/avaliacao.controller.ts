// Avaliação de desempenho, competências, alerta de experiência e PDI (W0-06, parte 5; M2 de mercado;
// `Gestão de pessoas > Avaliação de desempenho`):
//   GET  /api/pessoas/avaliacoes/apoio                          cargos, cursos, liberação e o que a sessão pode fazer
//   GET  /api/pessoas/avaliacoes/competencias                   competências (com os cargos) e o histórico
//   POST /api/pessoas/avaliacoes/competencias                   inclusão
//   POST /api/pessoas/avaliacoes/competencias/:id/alteracao     alteração com motivo (o valor anterior fica)
//   POST /api/pessoas/avaliacoes/competencias/:id/situacao      inativar ou reativar com motivo
//   POST /api/pessoas/avaliacoes/competencias/:id/exclusao      excluir a nunca usada (usada: 409 e a inativação)
//   GET  /api/pessoas/avaliacoes/cargos/:cargo/competencias     as competências do cargo
//   POST /api/pessoas/avaliacoes/cargos/:cargo/competencias     ligar a competência ao cargo
//   POST /api/pessoas/avaliacoes/cargos/:cargo/competencias/:competencia/desligamento   retirar, com motivo
//   GET  /api/pessoas/avaliacoes/ciclos                         ciclos com a contagem das avaliações em vigor
//   GET  /api/pessoas/avaliacoes/ciclos/:id                     ciclo, avaliações (todas as versões) e histórico
//   POST /api/pessoas/avaliacoes/ciclos                         inclusão
//   POST /api/pessoas/avaliacoes/ciclos/:id/alteracao           alteração do aberto com motivo
//   POST /api/pessoas/avaliacoes/ciclos/:id/situacao            encerrar, cancelar ou reabrir com motivo
//   POST /api/pessoas/avaliacoes/ciclos/:id/exclusao            excluir o ciclo sem avaliação (com: 409)
//   GET  /api/pessoas/avaliacoes/alertas-experiencia            marcos de 45 e 90 dias sem avaliação
//   GET  /api/pessoas/avaliacoes/colaborador/:vinculo           avaliações e PDI do colaborador
//   POST /api/pessoas/avaliacoes                                abrir a avaliação em rascunho
//   GET  /api/pessoas/avaliacoes/:id                            ficha (notas, versões e ações)
//   POST /api/pessoas/avaliacoes/:id/notas                      notas e parecer do rascunho
//   POST /api/pessoas/avaliacoes/:id/finalizacao                finalizar (toda competência com nota)
//   POST /api/pessoas/avaliacoes/:id/ciencia                    ciência colhida em papel, registrada pelo RH
//   POST /api/pessoas/avaliacoes/:id/correcao                   versão nova com justificativa
//   POST /api/pessoas/avaliacoes/:id/exclusao                   excluir o rascunho com motivo (com retrato)
//   POST /api/pessoas/avaliacoes/pdi                            ação nova no PDI (competência e curso)
//   POST /api/pessoas/avaliacoes/pdi/:id/alteracao              alteração da aberta com motivo
//   POST /api/pessoas/avaliacoes/pdi/:id/situacao               concluir ou cancelar com motivo
//   GET  /api/pessoas/avaliacoes/minhas                         as próprias avaliações (só o próprio vínculo)
//   GET  /api/pessoas/avaliacoes/minhas/:id                     a ficha da própria avaliação
//   POST /api/pessoas/avaliacoes/minhas/:id/ciencia             a ciência do próprio colaborador
// Toda gravação leva a Idempotency-Key (guarda) e a trilha; o estabelecimento vem da sessão.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import {
  type AlertaExperienciaResposta,
  type ApoioAvaliacao,
  type AvaliacaoResposta,
  type AvaliacoesDoColaborador,
  type CicloAvaliacaoResposta,
  type CompetenciaDoCargoResposta,
  esquemaAbrirAvaliacao,
  esquemaAlterarCiclo,
  esquemaAlterarCompetencia,
  esquemaAlterarPdi,
  esquemaCienciaPropria,
  esquemaCienciaRegistrada,
  esquemaCorrigirAvaliacao,
  esquemaDesligarCompetenciaCargo,
  esquemaExcluirAvaliacao,
  esquemaExcluirCiclo,
  esquemaExcluirCompetencia,
  esquemaFinalizarAvaliacao,
  esquemaIncluirCiclo,
  esquemaIncluirCompetencia,
  esquemaIncluirPdi,
  esquemaLigarCompetenciaCargo,
  esquemaNotasAvaliacao,
  esquemaSituacaoCiclo,
  esquemaSituacaoCompetencia,
  esquemaSituacaoPdi,
  type FichaAvaliacao,
  type FichaCicloAvaliacao,
  type ListaCompetencias,
  type ResultadoAvaliacaoDesempenho,
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
import { PORTA_CARGOS, type PortaCargos } from '../cargos/porta-cargos.js';
import { PORTA_PESSOAS, type PortaPessoas } from '../porta.js';
import { PORTA_PONTO, type PortaPonto } from '../ponto/porta-ponto.js';
import { PORTA_TREINAMENTO, type PortaTreinamento } from '../treinamento/porta-treinamento.js';
import { PORTA_AVALIACAO, type PortaAvaliacao } from './porta-avaliacao.js';
import { PERMISSOES_AVALIACAO, ServicoAvaliacao } from './servico-avaliacao.js';

const P = PERMISSOES_AVALIACAO;
const NA_TABELA = (t: string) => `${t} com a SGH_TRILHA na mesma transação`;
const com = (b: unknown, x: Record<string, number>) => ({ ...(b as object), ...x });

@Controller('pessoas/avaliacoes')
export class AvaliacaoController {
  readonly servico: ServicoAvaliacao;

  constructor(
    @Inject(PORTA_AVALIACAO) porta: PortaAvaliacao,
    @Inject(PORTA_PESSOAS) pessoas: PortaPessoas,
    @Inject(PORTA_CARGOS) cargos: PortaCargos,
    @Inject(PORTA_TREINAMENTO) treinamento: PortaTreinamento,
    @Inject(PORTA_PONTO) ponto: PortaPonto,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.servico = new ServicoAvaliacao(
      porta,
      pessoas,
      cargos,
      treinamento,
      ponto,
      trilha,
      configuracao,
      cache,
    );
  }

  // ── Leituras ─────────────────────────────────────────────────────────────────────────────────────────────────

  @Get('apoio')
  @Permissao(P.ler)
  apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioAvaliacao> {
    return this.servico.apoioTela(sessaoDe(req));
  }

  @Get('competencias')
  @Permissao(P.ler)
  competencias(@Req() req: RequisicaoAutorizada): Promise<ListaCompetencias> {
    return this.servico.competencias(sessaoDe(req));
  }

  @Get('cargos/:cargo/competencias')
  @Permissao(P.ler)
  doCargo(
    @Param('cargo') cargo: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<CompetenciaDoCargoResposta[]> {
    return this.servico.competenciasDoCargo(sessaoDe(req), idDaRota(cargo));
  }

  @Get('ciclos')
  @Permissao(P.ler)
  ciclos(@Req() req: RequisicaoAutorizada): Promise<CicloAvaliacaoResposta[]> {
    return this.servico.ciclos(sessaoDe(req));
  }

  @Get('ciclos/:id')
  @Permissao(P.ler)
  ciclo(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<FichaCicloAvaliacao> {
    return this.servico.fichaCiclo(sessaoDe(req), idDaRota(id));
  }

  @Get('alertas-experiencia')
  @Permissao(P.ler)
  alertas(@Req() req: RequisicaoAutorizada): Promise<AlertaExperienciaResposta[]> {
    return this.servico.alertasExperiencia(sessaoDe(req));
  }

  @Get('colaborador/:vinculo')
  @Permissao(P.ler)
  colaborador(
    @Param('vinculo') v: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<AvaliacoesDoColaborador> {
    return this.servico.doColaborador(sessaoDe(req), idDaRota(v));
  }

  @Get('minhas')
  @Permissao(P.ciencia)
  minhas(@Req() req: RequisicaoAutorizada): Promise<AvaliacaoResposta[]> {
    return this.servico.minhas(sessaoDe(req));
  }

  @Get('minhas/:id')
  @Permissao(P.ciencia)
  minha(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<FichaAvaliacao> {
    return this.servico.ficha(sessaoDe(req), idDaRota(id), true);
  }

  @Get(':id')
  @Permissao(P.ler)
  ficha(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<FichaAvaliacao> {
    return this.servico.ficha(sessaoDe(req), idDaRota(id));
  }

  // ── Competência ──────────────────────────────────────────────────────────────────────────────────────────────

  @Post('competencias')
  @HttpCode(200)
  @Permissao(P.gerir)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_COMPETENCIA'))
  incluirCompetencia(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAvaliacaoDesempenho> {
    return this.servico.incluirCompetencia(sessaoDe(req), corpo(esquemaIncluirCompetencia, b));
  }

  @Post('competencias/:id/alteracao')
  @HttpCode(200)
  @Permissao(P.gerir)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_COMPETENCIA e SGH_PES_CORRECAO'))
  alterarCompetencia(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.servico.alterarCompetencia(
      sessaoDe(req),
      corpo(esquemaAlterarCompetencia, com(b, { competencia: idDaRota(id) })),
    );
  }

  @Post('competencias/:id/situacao')
  @HttpCode(200)
  @Permissao(P.gerir)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_COMPETENCIA e SGH_PES_CORRECAO'))
  situacaoCompetencia(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.servico.situacaoCompetencia(
      sessaoDe(req),
      corpo(esquemaSituacaoCompetencia, com(b, { competencia: idDaRota(id) })),
    );
  }

  @Post('competencias/:id/exclusao')
  @HttpCode(200)
  @Permissao(P.gerir)
  @AuditadoNoHandler(NA_TABELA('SGH_HIST_EXCLUSAO (retrato) e o DELETE da competência nunca usada'))
  excluirCompetencia(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.servico.excluirCompetencia(
      sessaoDe(req),
      corpo(esquemaExcluirCompetencia, com(b, { competencia: idDaRota(id) })),
    );
  }

  @Post('cargos/:cargo/competencias')
  @HttpCode(200)
  @Permissao(P.gerir)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_CARGO_COMPETENCIA'))
  ligar(@Param('cargo') cargo: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.servico.ligarCompetenciaCargo(
      sessaoDe(req),
      corpo(esquemaLigarCompetenciaCargo, com(b, { cargo: idDaRota(cargo) })),
    );
  }

  @Post('cargos/:cargo/competencias/:competencia/desligamento')
  @HttpCode(200)
  @Permissao(P.gerir)
  @AuditadoNoHandler(NA_TABELA('SGH_HIST_EXCLUSAO (retrato) e o DELETE da SGH_PES_CARGO_COMPETENCIA'))
  desligar(
    @Param('cargo') cargo: string,
    @Param('competencia') k: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.servico.desligarCompetenciaCargo(
      sessaoDe(req),
      corpo(esquemaDesligarCompetenciaCargo, com(b, { cargo: idDaRota(cargo), competencia: idDaRota(k) })),
    );
  }

  // ── Ciclo ────────────────────────────────────────────────────────────────────────────────────────────────────

  @Post('ciclos')
  @HttpCode(200)
  @Permissao(P.gerir)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_AVAL_CICLO'))
  incluirCiclo(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoAvaliacaoDesempenho> {
    return this.servico.incluirCiclo(sessaoDe(req), corpo(esquemaIncluirCiclo, b));
  }

  @Post('ciclos/:id/alteracao')
  @HttpCode(200)
  @Permissao(P.gerir)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_AVAL_CICLO e SGH_PES_CORRECAO'))
  alterarCiclo(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.servico.alterarCiclo(
      sessaoDe(req),
      corpo(esquemaAlterarCiclo, com(b, { ciclo: idDaRota(id) })),
    );
  }

  @Post('ciclos/:id/situacao')
  @HttpCode(200)
  @Permissao(P.gerir)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_AVAL_CICLO e SGH_PES_CORRECAO'))
  situacaoCiclo(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.servico.situacaoCiclo(
      sessaoDe(req),
      corpo(esquemaSituacaoCiclo, com(b, { ciclo: idDaRota(id) })),
    );
  }

  @Post('ciclos/:id/exclusao')
  @HttpCode(200)
  @Permissao(P.gerir)
  @AuditadoNoHandler(NA_TABELA('SGH_HIST_EXCLUSAO (retrato) e o DELETE do ciclo sem avaliação'))
  excluirCiclo(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.servico.excluirCiclo(
      sessaoDe(req),
      corpo(esquemaExcluirCiclo, com(b, { ciclo: idDaRota(id) })),
    );
  }

  // ── PDI ──────────────────────────────────────────────────────────────────────────────────────────────────────

  @Post('pdi')
  @HttpCode(200)
  @Permissao(P.gerir)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_PDI'))
  incluirPdi(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoAvaliacaoDesempenho> {
    return this.servico.incluirPdi(sessaoDe(req), corpo(esquemaIncluirPdi, b));
  }

  @Post('pdi/:id/alteracao')
  @HttpCode(200)
  @Permissao(P.gerir)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_PDI e SGH_PES_CORRECAO'))
  alterarPdi(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.servico.alterarPdi(sessaoDe(req), corpo(esquemaAlterarPdi, com(b, { pdi: idDaRota(id) })));
  }

  @Post('pdi/:id/situacao')
  @HttpCode(200)
  @Permissao(P.gerir)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_PDI e SGH_PES_CORRECAO'))
  situacaoPdi(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.servico.situacaoPdi(sessaoDe(req), corpo(esquemaSituacaoPdi, com(b, { pdi: idDaRota(id) })));
  }

  // ── Ciência própria ──────────────────────────────────────────────────────────────────────────────────────────

  @Post('minhas/:id/ciencia')
  @HttpCode(200)
  @Permissao(P.ciencia)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_AVALIACAO'))
  cienciaPropria(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.servico.cienciaPropria(
      sessaoDe(req),
      corpo(esquemaCienciaPropria, com(b, { avaliacao: idDaRota(id) })),
    );
  }

  // ── Avaliação ────────────────────────────────────────────────────────────────────────────────────────────────

  @Post()
  @HttpCode(200)
  @Permissao(P.gerir)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_AVALIACAO e SGH_PES_AVAL_ITEM'))
  abrir(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoAvaliacaoDesempenho> {
    return this.servico.abrir(sessaoDe(req), corpo(esquemaAbrirAvaliacao, b));
  }

  @Post(':id/notas')
  @HttpCode(200)
  @Permissao(P.gerir)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_AVALIACAO e SGH_PES_AVAL_ITEM'))
  notas(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.servico.lancarNotas(
      sessaoDe(req),
      corpo(esquemaNotasAvaliacao, com(b, { avaliacao: idDaRota(id) })),
    );
  }

  @Post(':id/finalizacao')
  @HttpCode(200)
  @Permissao(P.gerir)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_AVALIACAO'))
  finalizar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.servico.finalizar(
      sessaoDe(req),
      corpo(esquemaFinalizarAvaliacao, com(b, { avaliacao: idDaRota(id) })),
    );
  }

  @Post(':id/ciencia')
  @HttpCode(200)
  @Permissao(P.gerir)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_AVALIACAO'))
  cienciaRegistrada(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.servico.cienciaRegistrada(
      sessaoDe(req),
      corpo(esquemaCienciaRegistrada, com(b, { avaliacao: idDaRota(id) })),
    );
  }

  @Post(':id/correcao')
  @HttpCode(200)
  @Permissao(P.gerir)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_AVALIACAO (versão nova) e SGH_PES_AVAL_ITEM (notas copiadas)'))
  corrigir(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.servico.corrigir(
      sessaoDe(req),
      corpo(esquemaCorrigirAvaliacao, com(b, { avaliacao: idDaRota(id) })),
    );
  }

  @Post(':id/exclusao')
  @HttpCode(200)
  @Permissao(P.gerir)
  @AuditadoNoHandler(NA_TABELA('SGH_HIST_EXCLUSAO (retrato) e o DELETE do rascunho e das notas'))
  excluir(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.servico.excluir(
      sessaoDe(req),
      corpo(esquemaExcluirAvaliacao, com(b, { avaliacao: idDaRota(id) })),
    );
  }
}
