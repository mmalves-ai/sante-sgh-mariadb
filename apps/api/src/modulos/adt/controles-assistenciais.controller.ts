// F78.04-1: controles da internação no banco do cliente (porta própria; sem banco do cliente, 503).
// Formulários de declaração de óbito (04-INT linha 74):
//   GET  /api/internacao/controles/formularios-obito?situacao=   formulários, resumo e declarações sem formulário
//   POST /api/internacao/controles/formularios-obito/lotes        recebe o lote da secretaria (número inicial e final)
//   POST /api/internacao/controles/formularios-obito/conciliar    liga as declarações emitidas ao formulário de mesmo número
//   POST /api/internacao/controles/formularios-obito/:id/acao     usar, extraviar, cancelar ou devolver
// Auditoria do isolamento (04-INT linha 75):
//   GET  /api/internacao/controles/isolamentos                    isolamentos ativos com a última auditoria e a próxima
//   GET  /api/internacao/controles/isolamentos/criterios?tipo=    critérios do tipo de precaução
//   POST /api/internacao/controles/isolamentos/criterios          inclui um critério
//   POST /api/internacao/controles/isolamentos/auditorias         registra a auditoria com as respostas
//   POST /api/internacao/controles/isolamentos/auditorias/:id/cancelar
//   GET  /api/internacao/controles/isolamentos/pacientes/:p       visão por paciente
//   GET  /api/internacao/controles/isolamentos/avisos?todos=      avisos à CCIH dos critérios "alertar"/"bloquear"
//   POST /api/internacao/controles/isolamentos/avisos/:id/resolver  a CCIH registra a providência e resolve
// Regulação (04-INT linha 78):
//   GET  /api/internacao/controles/regulacao/apoio                consciência, suporte de O2, diurese e germes
//   GET  /api/internacao/controles/regulacao/:id                  linha do tempo (quadros e eventos)
//   POST /api/internacao/controles/regulacao/:id/quadros          quadro clínico estruturado
//   POST /api/internacao/controles/regulacao/:id/eventos          resposta, contato, mudança de situação, cancelamento
// Níveis de acesso: os já existentes da declaração de óbito, das precauções e da regulação, para todo cargo que os tiver.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  PORTA_CONTROLES_ASSISTENCIAIS,
  type PortaControlesAssistenciaisPropria,
} from './controles-assistenciais-propria.js';

export const PERMISSOES_CONTROLES_ASSISTENCIAIS = {
  formularioObito: 'pep.declaracaoObito.emitir',
  isolamentoLer: 'qualidade.precaucao.ler',
  isolamentoAuditar: 'qualidade.precaucao.definir',
  regulacaoLer: 'internacao.regulacao.ler',
  regulacaoRegistrar: 'internacao.regulacao.registrar',
} as const;
const P = PERMISSOES_CONTROLES_ASSISTENCIAIS;
const TRILHA = 'executor: trilha na mesma transação do controle da internação';

@Controller('internacao/controles')
export class ControlesAssistenciaisController {
  constructor(
    @Optional()
    @Inject(PORTA_CONTROLES_ASSISTENCIAIS)
    private readonly porta: PortaControlesAssistenciaisPropria | null = null,
  ) {}

  private com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaControlesAssistenciaisPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  // ── Formulários de declaração de óbito ──

  @Get('formularios-obito')
  @Permissao(P.formularioObito)
  formularios(@Req() req: RequisicaoAutorizada, @Query('situacao') situacao?: string) {
    return this.com(req, (p, c) => p.formulariosObito(c, situacao?.trim() || null));
  }

  @Post('formularios-obito/lotes')
  @AuditadoNoHandler(TRILHA)
  @HttpCode(201)
  @Permissao(P.formularioObito)
  receberLote(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.receberLote(c, corpo));
  }

  @Post('formularios-obito/conciliar')
  @AuditadoNoHandler(TRILHA)
  @HttpCode(200)
  @Permissao(P.formularioObito)
  conciliar(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.conciliarUsos(c));
  }

  @Post('formularios-obito/:id/acao')
  @AuditadoNoHandler(TRILHA)
  @HttpCode(200)
  @Permissao(P.formularioObito)
  acao(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.acaoFormulario(c, id, corpo));
  }

  // ── Auditoria do isolamento ──

  @Get('isolamentos')
  @Permissao(P.isolamentoLer)
  isolamentos(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.isolamentosParaAuditar(c));
  }

  @Get('isolamentos/criterios')
  @Permissao(P.isolamentoLer)
  criterios(@Req() req: RequisicaoAutorizada, @Query('tipo', ParseIntPipe) tipo: number) {
    return this.com(req, (p, c) => p.criteriosAuditoria(c, tipo));
  }

  @Post('isolamentos/criterios')
  @AuditadoNoHandler(TRILHA)
  @HttpCode(201)
  @Permissao(P.isolamentoAuditar)
  incluirCriterio(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirCriterio(c, corpo));
  }

  @Post('isolamentos/auditorias')
  @AuditadoNoHandler(TRILHA)
  @HttpCode(201)
  @Permissao(P.isolamentoAuditar)
  auditar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.auditar(c, corpo));
  }

  @Post('isolamentos/auditorias/:id/cancelar')
  @AuditadoNoHandler(TRILHA)
  @HttpCode(200)
  @Permissao(P.isolamentoAuditar)
  cancelarAuditoria(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.cancelarAuditoria(c, id, corpo));
  }

  @Get('isolamentos/avisos')
  @Permissao(P.isolamentoLer)
  avisosIsolamento(@Req() req: RequisicaoAutorizada, @Query('todos') todos?: string) {
    return this.com(req, (p, c) => p.avisosIsolamento(c, todos === '1' || todos === 'true'));
  }

  @Post('isolamentos/avisos/:id/resolver')
  @AuditadoNoHandler(TRILHA)
  @HttpCode(200)
  @Permissao(P.isolamentoAuditar)
  resolverAvisoIsolamento(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.resolverAvisoIsolamento(c, id, corpo));
  }

  @Get('isolamentos/pacientes/:p')
  @Permissao(P.isolamentoLer)
  @Auditar('pep.documento.lido')
  auditoriasDoPaciente(@Req() req: RequisicaoAutorizada, @Param('p', ParseIntPipe) paciente: number) {
    req.sghAlvo = { paciente, tabelaAlvo: 'auditoria_isolamento', chaveNaturalAlvo: `paciente:${paciente}` };
    return this.com(req, (p, c) => p.auditoriasDoPaciente(c, paciente));
  }

  // ── Regulação: quadro clínico e evolução ──

  @Get('regulacao/apoio')
  @Permissao(P.regulacaoLer)
  apoioRegulacao(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.apoioRegulacao(c));
  }

  @Get('regulacao/:id')
  @Permissao(P.regulacaoLer)
  linhaDoTempo(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.linhaDoTempoRegulacao(c, id));
  }

  @Post('regulacao/:id/quadros')
  @AuditadoNoHandler(TRILHA)
  @HttpCode(201)
  @Permissao(P.regulacaoRegistrar)
  quadro(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.registrarQuadro(c, id, corpo));
  }

  @Post('regulacao/:id/eventos')
  @AuditadoNoHandler(TRILHA)
  @HttpCode(201)
  @Permissao(P.regulacaoRegistrar)
  evento(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.registrarEvento(c, id, corpo));
  }
}
