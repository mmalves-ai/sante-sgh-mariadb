// eSocial, parte F5 (M53.6; ficha do M53, seção 7; `Gestão de pessoas > eSocial (eventos, lotes, retornos)`):
//   GET  /api/pessoas/esocial/apoio                         empresas, catálogo, leiaute vigente, transmissão e ações
//   GET  /api/pessoas/esocial/empregadores?empresa          parâmetros do eSocial com vigência
//   POST /api/pessoas/esocial/empregadores                  nova vigência (transmissor único por raiz de CNPJ)
//   GET  /api/pessoas/esocial/fichas/:vinculo               a ficha do eSocial do colaborador (decifrada; auditado)
//   POST /api/pessoas/esocial/fichas/:vinculo               grava a ficha (cifrada; versão)
//   GET  /api/pessoas/esocial/eventos?filtro                eventos (sem dado pessoal)
//   GET  /api/pessoas/esocial/eventos/:id                   o evento e o XML (com `gerar`; auditado)
//   POST /api/pessoas/esocial/eventos/tabela                prévia ou gravação dos eventos de tabela
//   POST /api/pessoas/esocial/eventos/trabalhador           prévia ou gravação de um evento do trabalhador
//   POST /api/pessoas/esocial/eventos/:id/descarte          descarta o evento ainda não enviado (motivo)
//   POST /api/pessoas/esocial/eventos/:id/exclusao          S-3000 do evento aceito (prévia ou gravação)
//   GET  /api/pessoas/esocial/lotes?empresa&situacao        lotes
//   GET  /api/pessoas/esocial/lotes/:id                     o lote e os eventos
//   POST /api/pessoas/esocial/lotes                         monta o lote (1 a 50 validados)
//   POST /api/pessoas/esocial/lotes/:id/envio               envia (coletor fora de produção; regra 3)
//   POST /api/pessoas/esocial/lotes/:id/retorno             registra o retorno, evento a evento
//   POST /api/pessoas/esocial/lotes/:id/consulta            consulta o retorno no eSocial pelo protocolo (produção)
//   POST /api/pessoas/esocial/lotes/:id/cancelamento        cancela o lote montado (motivo)
//   GET  /api/pessoas/esocial/pendencias?empresa            pendências do outro sistema: só contagem (regra 2)
//   GET  /api/pessoas/esocial/conciliacao?empresa&competencia   conciliação do transmissor único (regra 1)
//   POST /api/pessoas/esocial/conciliacao                   grava a conferência da competência
// M53.7 (F6, periódicos e fechamento):
//   GET  /api/pessoas/esocial/periodicos?empresa&apuracao&periodo   painel do período (folha, S-1200, S-1210, S-1299)
//   POST /api/pessoas/esocial/periodicos/remuneracao        S-1200 do período fechado na folha (prévia ou gravação)
//   POST /api/pessoas/esocial/periodicos/pagamentos         S-1210 dos pagamentos do mês (prévia ou gravação)
//   POST /api/pessoas/esocial/periodicos/fechamento         S-1299 do período (só com tudo aceito)
//   POST /api/pessoas/esocial/periodicos/reabertura         S-1298 do período fechado no eSocial
// Toda gravação leva a Idempotency-Key (guarda) e a trilha; o estabelecimento vem da sessão.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type ApoioEsocial,
  type ConciliacaoEsocial,
  type DetalheEventoEsocial,
  type DetalheLoteEsocial,
  type EmpregadorEsocialLido,
  esquemaCancelarLoteEsocial,
  esquemaConferirConciliacaoEsocial,
  esquemaDescartarEventoEsocial,
  esquemaEmpregadorEsocial,
  esquemaEnviarLoteEsocial,
  esquemaExcluirEventoEsocial,
  esquemaFiltroConciliacaoEsocial,
  esquemaFiltroEventosEsocial,
  esquemaFiltroLotesEsocial,
  esquemaFiltroPeriodicosEsocial,
  esquemaGerarFechamentoEsocial,
  esquemaGerarPagamentosEsocial,
  esquemaGerarRemuneracaoEsocial,
  type PainelPeriodicosEsocial,
  esquemaGerarEventosTabela,
  esquemaGerarEventoTrabalhador,
  esquemaMontarLoteEsocial,
  esquemaRegistrarFichaEsocial,
  esquemaRetornoLoteEsocial,
  EVENTOS_AUDITAVEIS,
  type EventoEsocialResumo,
  type FichaEsocialDoVinculo,
  type ListaEventosEsocial,
  type ListaLotesEsocial,
  type PendenciasLegadoEsocial,
  type ResultadoGeracaoEsocial,
} from '@sgh/contratos';
import { z } from 'zod';
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
import type { CifraCpf } from '../cifra-cpf.js';
import { PORTA_CALCULO_FOLHA, type PortaCalculoFolha } from '../folha/porta-calculo.js';
import { PORTA_FOLHA, type PortaFolha } from '../folha/porta-folha.js';
import { CIFRA_CPF_PESSOAS } from '../pessoas.controller.js';
import { PORTA_PESSOAS, type PortaPessoas } from '../porta.js';
import { PORTA_RUBRICAS, type PortaRubricas } from '../rubricas/porta-rubricas.js';
import { PORTA_ESOCIAL, type PortaEsocial } from './porta-esocial.js';
import { PERMISSOES_ESOCIAL as P, ServicoEsocial, TRANSMISSOR_DESLIGADO } from './servico-esocial.js';
import { ServicoPeriodicosEsocial } from './servico-periodicos.js';
import { type DisponibilidadeTransmissor, TRANSMISSOR_ESOCIAL } from './transmissor/transmissor-esocial.js';

const E = EVENTOS_AUDITAVEIS;
const NA_TABELA = (t: string) => `${t} com a SGH_TRILHA na mesma transação`;
const esquemaEmpresaOpcional = z
  .object({ empresa: z.coerce.number().int().min(0).max(32_767).optional() })
  .strict();

@Controller('pessoas/esocial')
export class EsocialController {
  readonly servico: ServicoEsocial;
  readonly periodicos: ServicoPeriodicosEsocial;

  constructor(
    @Inject(PORTA_ESOCIAL) porta: PortaEsocial,
    @Inject(PORTA_FOLHA) folha: PortaFolha,
    @Inject(PORTA_CALCULO_FOLHA) calculo: PortaCalculoFolha,
    @Inject(PORTA_RUBRICAS) rubricas: PortaRubricas,
    @Inject(PORTA_PESSOAS) pessoas: PortaPessoas,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(CIFRA_CPF_PESSOAS) cifra: CifraCpf | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(TRANSMISSOR_ESOCIAL) transmissao: DisponibilidadeTransmissor | null = null,
  ) {
    this.servico = new ServicoEsocial(
      porta,
      folha,
      calculo,
      rubricas,
      pessoas,
      cifra,
      trilha,
      configuracao,
      cache,
      undefined,
      transmissao ?? TRANSMISSOR_DESLIGADO,
    );
    this.periodicos = new ServicoPeriodicosEsocial(this.servico);
  }

  // ── M53.7 (F6): periódicos e fechamento ─────────────────────────────────────────────────────────────────────

  @Get('periodicos')
  @Permissao(P.ler)
  painelPeriodicos(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PainelPeriodicosEsocial> {
    return this.periodicos.painel(sessaoDe(req), corpo(esquemaFiltroPeriodicosEsocial, q));
  }

  @Post('periodicos/remuneracao')
  @HttpCode(200)
  @Permissao(P.gerar)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_ESOCIAL_EVENTO'))
  gerarRemuneracao(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoGeracaoEsocial> {
    return this.periodicos.gerarRemuneracao(sessaoDe(req), corpo(esquemaGerarRemuneracaoEsocial, b));
  }

  @Post('periodicos/pagamentos')
  @HttpCode(200)
  @Permissao(P.gerar)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_ESOCIAL_EVENTO'))
  gerarPagamentos(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoGeracaoEsocial> {
    return this.periodicos.gerarPagamentos(sessaoDe(req), corpo(esquemaGerarPagamentosEsocial, b));
  }

  @Post('periodicos/fechamento')
  @HttpCode(200)
  @Permissao(P.gerar)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_ESOCIAL_EVENTO'))
  gerarFechamento(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoGeracaoEsocial> {
    return this.periodicos.gerarFechamento(sessaoDe(req), corpo(esquemaGerarFechamentoEsocial, b));
  }

  @Post('periodicos/reabertura')
  @HttpCode(200)
  @Permissao(P.gerar)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_ESOCIAL_EVENTO'))
  gerarReabertura(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoGeracaoEsocial> {
    return this.periodicos.gerarReabertura(sessaoDe(req), corpo(esquemaGerarFechamentoEsocial, b));
  }

  @Get('apoio')
  @Permissao(P.ler)
  apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioEsocial> {
    return this.servico.apoioTela(sessaoDe(req));
  }

  @Get('empregadores')
  @Permissao(P.ler)
  empregadores(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<EmpregadorEsocialLido[]> {
    return this.servico.empregadores(sessaoDe(req), corpo(esquemaEmpresaOpcional, q).empresa ?? null);
  }

  @Post('empregadores')
  @HttpCode(200)
  @Permissao(P.gerar)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_ESOCIAL_EMPREGADOR'))
  registrarEmpregador(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<EmpregadorEsocialLido> {
    return this.servico.registrarEmpregador(sessaoDe(req), corpo(esquemaEmpregadorEsocial, b));
  }

  /** A ficha do eSocial do colaborador (dado pessoal decifrado: leitura auditada). */
  @Get('fichas/:vinculo')
  @Permissao(P.gerar)
  @Auditar(E.pessoasEsocialFichaLida.codigo)
  ficha(@Param('vinculo') v: string, @Req() req: RequisicaoAutorizada): Promise<FichaEsocialDoVinculo> {
    const id = idDaRota(v);
    req.sghAlvo = { tabelaAlvo: 'SGH_PES_ESOCIAL_FICHA', idAlvo: String(id), chaveNaturalAlvo: 'vinculo' };
    return this.servico.ficha(sessaoDe(req), id);
  }

  @Post('fichas/:vinculo')
  @HttpCode(200)
  @Permissao(P.gerar)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_ESOCIAL_FICHA'))
  registrarFicha(
    @Param('vinculo') v: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<FichaEsocialDoVinculo> {
    return this.servico.registrarFicha(sessaoDe(req), idDaRota(v), corpo(esquemaRegistrarFichaEsocial, b));
  }

  @Get('eventos')
  @Permissao(P.ler)
  eventos(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaEventosEsocial> {
    return this.servico.listarEventos(sessaoDe(req), corpo(esquemaFiltroEventosEsocial, q));
  }

  /** O evento; o XML (CPF e nome no do trabalhador) só com `pessoas.esocial.gerar` (leitura auditada). */
  @Get('eventos/:id')
  @Permissao(P.ler)
  @Auditar(E.pessoasEsocialEventoLido.codigo)
  evento(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<DetalheEventoEsocial> {
    const r = idDaRota(id);
    req.sghAlvo = { tabelaAlvo: 'SGH_PES_ESOCIAL_EVENTO', idAlvo: String(r), chaveNaturalAlvo: 'detalhe' };
    return this.servico.detalheEvento(sessaoDe(req), r);
  }

  @Post('eventos/tabela')
  @HttpCode(200)
  @Permissao(P.gerar)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_ESOCIAL_EVENTO'))
  gerarTabela(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoGeracaoEsocial> {
    return this.servico.gerarTabela(sessaoDe(req), corpo(esquemaGerarEventosTabela, b));
  }

  @Post('eventos/trabalhador')
  @HttpCode(200)
  @Permissao(P.gerar)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_ESOCIAL_EVENTO'))
  gerarTrabalhador(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoGeracaoEsocial> {
    return this.servico.gerarTrabalhador(sessaoDe(req), corpo(esquemaGerarEventoTrabalhador, b));
  }

  @Post('eventos/:id/descarte')
  @HttpCode(200)
  @Permissao(P.gerar)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_ESOCIAL_EVENTO'))
  descartar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<EventoEsocialResumo> {
    return this.servico.descartar(sessaoDe(req), idDaRota(id), corpo(esquemaDescartarEventoEsocial, b));
  }

  @Post('eventos/:id/exclusao')
  @HttpCode(200)
  @Permissao(P.gerar)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_ESOCIAL_EVENTO'))
  excluir(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoGeracaoEsocial> {
    return this.servico.excluir(sessaoDe(req), idDaRota(id), corpo(esquemaExcluirEventoEsocial, b));
  }

  @Get('lotes')
  @Permissao(P.ler)
  lotes(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<ListaLotesEsocial> {
    return this.servico.listarLotes(sessaoDe(req), corpo(esquemaFiltroLotesEsocial, q));
  }

  @Get('lotes/:id')
  @Permissao(P.ler)
  lote(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<DetalheLoteEsocial> {
    return this.servico.detalheLote(sessaoDe(req), idDaRota(id));
  }

  @Post('lotes')
  @HttpCode(200)
  @Permissao(P.transmitir)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_ESOCIAL_LOTE e SGH_PES_ESOCIAL_EVENTO'))
  montarLote(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<DetalheLoteEsocial> {
    return this.servico.montarLote(sessaoDe(req), corpo(esquemaMontarLoteEsocial, b));
  }

  @Post('lotes/:id/envio')
  @HttpCode(200)
  @Permissao(P.transmitir)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_ESOCIAL_LOTE e SGH_PES_ESOCIAL_EVENTO'))
  enviarLote(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DetalheLoteEsocial> {
    return this.servico.enviarLote(sessaoDe(req), idDaRota(id), corpo(esquemaEnviarLoteEsocial, b));
  }

  @Post('lotes/:id/retorno')
  @HttpCode(200)
  @Permissao(P.transmitir)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_ESOCIAL_LOTE e SGH_PES_ESOCIAL_EVENTO'))
  retorno(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DetalheLoteEsocial> {
    return this.servico.registrarRetorno(sessaoDe(req), idDaRota(id), corpo(esquemaRetornoLoteEsocial, b));
  }

  @Post('lotes/:id/consulta')
  @HttpCode(200)
  @Permissao(P.transmitir)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_ESOCIAL_LOTE e SGH_PES_ESOCIAL_EVENTO'))
  consultarRetorno(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DetalheLoteEsocial> {
    return this.servico.consultarRetorno(sessaoDe(req), idDaRota(id), corpo(esquemaEnviarLoteEsocial, b));
  }

  @Post('lotes/:id/cancelamento')
  @HttpCode(200)
  @Permissao(P.transmitir)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_ESOCIAL_LOTE e SGH_PES_ESOCIAL_EVENTO'))
  cancelarLote(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DetalheLoteEsocial> {
    return this.servico.cancelarLote(sessaoDe(req), idDaRota(id), corpo(esquemaCancelarLoteEsocial, b));
  }

  @Get('pendencias')
  @Permissao(P.ler)
  pendencias(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PendenciasLegadoEsocial> {
    return this.servico.pendenciasLegado(sessaoDe(req), corpo(esquemaEmpresaOpcional, q).empresa ?? null);
  }

  @Get('conciliacao')
  @Permissao(P.ler)
  conciliacao(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ConciliacaoEsocial> {
    return this.servico.conciliacao(sessaoDe(req), corpo(esquemaFiltroConciliacaoEsocial, q));
  }

  @Post('conciliacao')
  @HttpCode(200)
  @Permissao(P.transmitir)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_ESOCIAL_CONCILIA'))
  conferirConciliacao(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ConciliacaoEsocial> {
    return this.servico.conferirConciliacao(sessaoDe(req), corpo(esquemaConferirConciliacaoEsocial, b));
  }
}
