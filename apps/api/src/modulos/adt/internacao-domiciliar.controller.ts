// Internação domiciliar (C2-079, 04-INT linha 84): orçamento, transferência para casa, chamados e visitas. Rotas
// (porta própria; sem banco do cliente, 503):
//   GET  /api/internacao/domiciliar/opcoes                       tipos e motivos de chamado, programas, áreas, fontes…
//   GET  /api/internacao/domiciliar/painel                       internações abertas, fila dos chamados, visitas, orçamentos
//   GET  /api/internacao/domiciliar/pacientes/:id                visão do paciente (endereços, orçamentos, internações…)
//   POST /api/internacao/domiciliar/orcamentos                   cria o orçamento (rascunho) com os itens
//   POST /api/internacao/domiciliar/orcamentos/:id               troca cabeçalho e itens do rascunho { …, versao }
//   POST /api/internacao/domiciliar/orcamentos/:id/:acao         enviar | aprovar | recusar | cancelar { versao }
//   POST /api/internacao/domiciliar/internacoes                  transferência para casa
//   POST /api/internacao/domiciliar/internacoes/:id/:acao        avaliar | iniciar | suspender | retomar | encerrar | cancelar
//   POST /api/internacao/domiciliar/chamados                     abre o chamado
//   POST /api/internacao/domiciliar/chamados/:id/:acao           triar | atribuir | concluir | anular
//   POST /api/internacao/domiciliar/visitas                      agenda a visita
//   POST /api/internacao/domiciliar/visitas/:id/:acao            confirmar | iniciar | realizar | cancelar | nao_realizar
// Ler: quem consulta a internação; gravar: quem interna (internacao.internacao.criar).
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
  Req,
} from '@nestjs/common';
import type {
  AcaoChamadoDomiciliar,
  AcaoInternacaoDomiciliar,
  AcaoOrcamentoDomiciliar,
  AcaoVisitaDomiciliar,
} from '@sgh/dominio-internacao';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  PORTA_INTERNACAO_DOMICILIAR,
  type PortaInternacaoDomiciliarPropria,
} from './internacao-domiciliar-propria.js';

const TRILHA = 'internação domiciliar pelo executor (trilha na mesma transação)';
const ACOES_ORCAMENTO = ['enviar', 'aprovar', 'recusar', 'cancelar'] as const;
const ACOES_INTERNACAO = ['avaliar', 'iniciar', 'suspender', 'retomar', 'encerrar', 'cancelar'] as const;
const ACOES_CHAMADO = ['triar', 'atribuir', 'concluir', 'anular'] as const;
const ACOES_VISITA = ['confirmar', 'iniciar', 'realizar', 'cancelar', 'nao_realizar'] as const;

function acaoValida<T extends string>(acao: string, validas: readonly T[]): T {
  if (!(validas as readonly string[]).includes(acao))
    throw new ErroProblema('registro-inexistente', 404, `Ação ${acao} desconhecida`);
  return acao as T;
}

@Controller('internacao/domiciliar')
export class InternacaoDomiciliarController {
  constructor(
    @Optional()
    @Inject(PORTA_INTERNACAO_DOMICILIAR)
    private readonly porta: PortaInternacaoDomiciliarPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaInternacaoDomiciliarPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('opcoes')
  @Permissao('internacao.internacao.ler')
  opcoes(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.opcoes(c));
  }

  @Get('painel')
  @Permissao('internacao.internacao.ler')
  painel(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.painel(c));
  }

  @Get('pacientes/:id')
  @Permissao('internacao.internacao.ler')
  paciente(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.paciente(c, id));
  }

  @Post('orcamentos')
  @HttpCode(201)
  @Permissao('internacao.internacao.criar')
  @AuditadoNoHandler(TRILHA)
  criarOrcamento(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.salvarOrcamento(c, null, corpo));
  }

  @Post('orcamentos/:id')
  @HttpCode(200)
  @Permissao('internacao.internacao.criar')
  @AuditadoNoHandler(TRILHA)
  alterarOrcamento(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.salvarOrcamento(c, id, corpo));
  }

  @Post('orcamentos/:id/:acao')
  @HttpCode(200)
  @Permissao('internacao.internacao.criar')
  @AuditadoNoHandler(TRILHA)
  acaoOrcamento(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Param('acao') acao: string,
    @Body() corpo: unknown,
  ) {
    const a = acaoValida<Exclude<AcaoOrcamentoDomiciliar, 'editar'>>(acao, ACOES_ORCAMENTO);
    return this.com(req, (p, c) => p.acaoOrcamento(c, id, a, corpo));
  }

  @Post('internacoes')
  @HttpCode(201)
  @Permissao('internacao.internacao.criar')
  @AuditadoNoHandler(TRILHA)
  transferir(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.transferir(c, corpo));
  }

  @Post('internacoes/:id/:acao')
  @HttpCode(200)
  @Permissao('internacao.internacao.criar')
  @AuditadoNoHandler(TRILHA)
  acaoInternacao(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Param('acao') acao: string,
    @Body() corpo: unknown,
  ) {
    const a = acaoValida<AcaoInternacaoDomiciliar>(acao, ACOES_INTERNACAO);
    return this.com(req, (p, c) => p.acaoInternacao(c, id, a, corpo));
  }

  @Post('chamados')
  @HttpCode(201)
  @Permissao('internacao.internacao.criar')
  @AuditadoNoHandler(TRILHA)
  abrirChamado(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.abrirChamado(c, corpo));
  }

  @Post('chamados/:id/:acao')
  @HttpCode(200)
  @Permissao('internacao.internacao.criar')
  @AuditadoNoHandler(TRILHA)
  acaoChamado(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Param('acao') acao: string,
    @Body() corpo: unknown,
  ) {
    const a = acaoValida<Exclude<AcaoChamadoDomiciliar, 'iniciar'>>(acao, ACOES_CHAMADO);
    return this.com(req, (p, c) => p.acaoChamado(c, id, a, corpo));
  }

  @Post('visitas')
  @HttpCode(201)
  @Permissao('internacao.internacao.criar')
  @AuditadoNoHandler(TRILHA)
  agendarVisita(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.agendarVisita(c, corpo));
  }

  @Post('visitas/:id/:acao')
  @HttpCode(200)
  @Permissao('internacao.internacao.criar')
  @AuditadoNoHandler(TRILHA)
  acaoVisita(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Param('acao') acao: string,
    @Body() corpo: unknown,
  ) {
    const a = acaoValida<AcaoVisitaDomiciliar>(acao, ACOES_VISITA);
    return this.com(req, (p, c) => p.acaoVisita(c, id, a, corpo));
  }
}
