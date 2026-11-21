// Integrações novas e o laboratório de apoio (M34; ficha, seção 7):
//   GET  /api/integracoes/monitor                      filas (outbox, saídas, entradas), mortos, alertas e a saúde das filas
//   GET  /api/integracoes/envios?situacao&parceiro     as mensagens de saída (sem conteúdo: resumo e recibo)
//   POST /api/integracoes/envios/:id/tratar            reprocessar, corrigir ou descartar a morta (motivo; auditado)
//   GET  /api/integracoes/parceiros                    os novos e os que leem o banco (visões: existência e contagem)
//   POST /api/integracoes/parceiros                    cadastrar (o segredo da credencial sai uma vez)
//   POST /api/integracoes/parceiros/:codigo            mudar, ativar ou desativar (com o motivo)
//   POST /api/integracoes/parceiros/:codigo/credencial trocar a credencial (o segredo sai uma vez)
//   POST /api/integracoes/parceiros/:codigo/teste      evento de teste na outbox (mesma transação da trilha)
//   GET  /api/integracoes/fhir; POST /api/integracoes/fhir/teste   FHIR R4, RNDS e o recurso de teste (simulador)
//   GET  /api/integracoes/hl7                          canais do motor de integração e as filas HL7 em uso
//   GET  /api/integracoes/mensagens                    a comunicação com o paciente pela Hal-AI (sem canal próprio)
//   GET  /api/integracoes/apoio/retornos; POST apoio/retornos/:id  a fila de conferência do laboratório de apoio
//   GET  /api/integracoes/apoio/interfaces             as interfaces com de-para de laboratório de apoio
//   POST /api/integracoes/entrada/:hospital            a entrada idempotente do parceiro (credencial própria)
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type CredencialEmitida,
  type EnvioLido,
  type EstadoFhir,
  type EstadoHl7,
  type EstadoMensagens,
  EVENTOS_AUDITAVEIS,
  type MonitorIntegracoes,
  type ParceiroLido,
  PERMISSOES_M34_CODIGOS as P,
  type RespostaRecebida,
  type RetornoApoioLido,
} from '@sgh/contratos';
import { AuditadoNoHandler, Auditar, Permissao, Publica } from '../../autorizacao/decoradores.js';
import { estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { CONFIGURACAO, type Configuracao } from '../../configuracao.js';
import { ErroProblema } from '../../problema.filter.js';
import { sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ConfiguracaoM34 } from '../relatorio/public-api.js';
import { ServicoEntrada } from './aplicacao/receber.js';
import { ServicoRetornoApoio } from './aplicacao/retorno-apoio.js';
import { ServicoIntegracoes } from './aplicacao/servico.js';
import type { ArmazemConteudo } from './infra/armazem-conteudo.js';
import { PORTA_INTEGRACAO, type PortaIntegracao } from './porta.js';

export const ARMAZEM_CONTEUDO = Symbol('ARMAZEM_CONTEUDO');
/** Os estabelecimentos que recebem pela entrada (os configurados; na sessão sintética, o sintético). */
export const ESTABELECIMENTOS_ENTRADA = Symbol('ESTABELECIMENTOS_ENTRADA');

@Controller('integracoes')
export class IntegracaoController {
  readonly servico: ServicoIntegracoes;
  readonly entrada: ServicoEntrada;
  readonly retorno: ServicoRetornoApoio;
  constructor(
    @Inject(PORTA_INTEGRACAO) private readonly porta: PortaIntegracao,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Inject(CONFIGURACAO) private readonly configuracao: Configuracao,
    @Inject(ARMAZEM_CONTEUDO) armazem: ArmazemConteudo,
    @Optional() @Inject(ESTABELECIMENTOS_ENTRADA) private readonly estabelecimentos: readonly string[] = [],
    @Optional() @Inject(FONTE_CONFIGURACAO) fonte: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    const config = new ConfiguracaoM34(fonte, cache);
    this.servico = new ServicoIntegracoes(porta, config, configuracao);
    this.entrada = new ServicoEntrada(porta, armazem);
    this.retorno = new ServicoRetornoApoio(porta, armazem, config, trilha);
  }

  // ── Monitor de filas e reprocessamento ──────────────────────────────────────────────────────────────

  @Get('monitor')
  @Permissao(P.filaLer)
  monitor(@Req() req: RequisicaoAutorizada): Promise<MonitorIntegracoes> {
    return this.servico.monitor(sessaoDe(req));
  }

  @Get('envios')
  @Permissao(P.filaLer)
  envios(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<EnvioLido[]> {
    return this.servico.envios(sessaoDe(req), q);
  }

  @Post('envios/:id/tratar')
  @HttpCode(200)
  @Permissao(P.filaReprocessar)
  @AuditadoNoHandler('tratamento da mensagem de saída e da falha, com a trilha na mesma transação')
  tratar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<EnvioLido> {
    return this.servico.tratarMorto(sessaoDe(req), id, b);
  }

  // ── Parceiros ───────────────────────────────────────────────────────────────────────────────────────

  @Get('parceiros')
  @Permissao(P.parceiroLer)
  parceiros(@Req() req: RequisicaoAutorizada) {
    return this.servico.parceiros(sessaoDe(req));
  }

  @Post('parceiros')
  @HttpCode(201)
  @Permissao(P.parceiroEditar)
  @AuditadoNoHandler(
    'parceiro, cliente da API e chave (só o resumo) com a trilha na mesma transação',
  )
  criarParceiro(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ parceiro: ParceiroLido; credencial: CredencialEmitida }> {
    return this.servico.criarParceiro(sessaoDe(req), b);
  }

  @Post('parceiros/:codigo')
  @HttpCode(200)
  @Permissao(P.parceiroEditar)
  @AuditadoNoHandler('parceiro com a trilha na mesma transação')
  alterarParceiro(
    @Param('codigo') codigo: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ParceiroLido> {
    return this.servico.alterarParceiro(sessaoDe(req), codigo, b);
  }

  @Post('parceiros/:codigo/credencial')
  @HttpCode(200)
  @Permissao(P.parceiroEditar)
  @AuditadoNoHandler('chave nova (o resumo; a anterior revogada) com a trilha na mesma transação')
  credencial(@Param('codigo') codigo: string, @Req() req: RequisicaoAutorizada): Promise<CredencialEmitida> {
    return this.servico.trocarCredencial(sessaoDe(req), codigo);
  }

  @Post('parceiros/:codigo/teste')
  @HttpCode(200)
  @Permissao(P.parceiroEditar)
  @AuditadoNoHandler('evento de teste na mensagem de saída com a trilha na mesma transação')
  teste(@Param('codigo') codigo: string, @Req() req: RequisicaoAutorizada): Promise<{ evento: string }> {
    return this.servico.mensagemDeTeste(sessaoDe(req), codigo);
  }

  // ── FHIR R4, RNDS, HL7 v2 e mensagens ───────────────────────────────────────────────────────────────

  @Get('fhir')
  @Permissao(P.fhirLer)
  fhir(@Req() req: RequisicaoAutorizada): Promise<EstadoFhir> {
    return this.servico.fhir(sessaoDe(req));
  }

  @Post('fhir/teste')
  @HttpCode(200)
  @Permissao(P.fhirEnviar)
  @AuditadoNoHandler('envio de teste ao simulador ou à homologação, registrado na trilha')
  fhirTeste(@Req() req: RequisicaoAutorizada) {
    return this.servico.enviarTesteFhir(sessaoDe(req));
  }

  @Get('hl7')
  @Permissao(P.hl7Ler)
  hl7(@Req() req: RequisicaoAutorizada): Promise<EstadoHl7> {
    return this.servico.hl7(sessaoDe(req));
  }

  @Get('mensagens')
  @Permissao(P.mensagemLer)
  mensagens(@Req() req: RequisicaoAutorizada): Promise<EstadoMensagens> {
    return this.servico.mensagens(sessaoDe(req));
  }

  // ── Laboratório de apoio ────────────────────────────────────────────────────────────────────────────

  @Get('apoio/retornos')
  @Permissao(P.apoioLer)
  @Auditar(EVENTOS_AUDITAVEIS.integracaoConsultaLida.codigo)
  async retornos(@Req() req: RequisicaoAutorizada): Promise<RetornoApoioLido[]> {
    req.sghAlvo = { tabelaAlvo: 'mensagem_integracao_entrada', idAlvo: 'fila de conferência' };
    return this.retorno.fila(sessaoDe(req));
  }

  @Post('apoio/retornos/:id')
  @HttpCode(200)
  @Permissao(P.apoioConferir)
  @AuditadoNoHandler(
    'resultado do apoio pelo Executor (trilha na mesma transação) e a conclusão da mensagem recebida',
  )
  conferir(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.retorno.conferir(sessaoDe(req), id, b);
  }

  @Get('apoio/interfaces')
  @Permissao(P.apoioLer)
  interfaces(@Req() req: RequisicaoAutorizada) {
    return this.porta.interfacesApoio(sessaoDe(req).porta);
  }

  // ── Entrada idempotente ─────────────────────────────────────────────────────────────────────────────

  @Post('entrada/:hospital')
  @HttpCode(200)
  @Publica(
    'entrada do parceiro: a credencial do cliente de integração é conferida no handler (resumo e escopo)',
  )
  receber(
    @Param('hospital') hospital: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<RespostaRecebida> {
    if (
      !/^[a-z0-9]{1,10}$/.test(hospital) ||
      (this.estabelecimentos.length > 0 && !this.estabelecimentos.includes(hospital))
    )
      throw new ErroProblema('nao-encontrado', 404, 'Estabelecimento não encontrado');
    const bruto = req.headers['idempotency-key'];
    const idem = Array.isArray(bruto) ? (bruto[0] ?? null) : (bruto ?? null);
    return this.entrada.receber({
      hospital,
      rede: this.configuracao.rede ?? 'rede-sintetica',
      autorizacao: req.headers['authorization'],
      idempotencia: typeof idem === 'string' ? idem : null,
      corpo: b,
      estacao: estacaoDaRequisicao(req),
    });
  }
}
