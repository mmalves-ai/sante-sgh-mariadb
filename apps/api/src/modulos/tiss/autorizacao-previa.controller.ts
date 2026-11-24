// Autorização prévia à operadora (F78.06-2, 06-FAT L25 e L27). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/tiss/autorizacoes/pacientes/:paciente   coberturas e pedidos do paciente (visão por paciente)
//   GET  /api/tiss/autorizacoes/:id                   o pedido com itens, respostas e consultas de andamento
//   GET  /api/tiss/autorizacoes/:id/xml               a mensagem SOLICITACAO_PROCEDIMENTOS enviada
//   POST /api/tiss/autorizacoes                       monta o pedido (rascunho) com os itens
//   POST /api/tiss/autorizacoes/:id/envio             { versao } envia (webservice: XML validado no XSD)
//   POST /api/tiss/autorizacoes/:id/resposta          resposta da operadora por item
//   POST /api/tiss/autorizacoes/:id/andamento         registra a consulta do andamento
//   POST /api/tiss/autorizacoes/:id/cancelamento      { versao, motivo }
// Tudo ligado para todos; quem faz o quê é decidido pelas permissões do cargo.
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
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  PORTA_AUTORIZACAO_PREVIA,
  type PortaAutorizacaoPreviaPropria,
} from './autorizacao-previa-propria.js';

export const PERMISSOES_AUTORIZACAO_PREVIA = {
  ler: 'faturamento.autorizacao.ler',
  solicitar: 'faturamento.autorizacao.solicitar',
  responder: 'faturamento.autorizacao.responder',
} as const;

const TRILHA = 'executor: trilha na mesma transação do pedido de autorização';

@Controller('tiss/autorizacoes')
export class AutorizacaoPreviaController {
  constructor(
    @Optional()
    @Inject(PORTA_AUTORIZACAO_PREVIA)
    private readonly porta: PortaAutorizacaoPreviaPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaAutorizacaoPreviaPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    return fn(this.porta, sessaoDe(req).porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('pacientes/:paciente')
  @Permissao(PERMISSOES_AUTORIZACAO_PREVIA.ler)
  doPaciente(@Req() req: RequisicaoAutorizada, @Param('paciente', ParseIntPipe) paciente: number) {
    return this.com(req, (p, c) => p.doPaciente(c, paciente));
  }

  @Get(':id')
  @Permissao(PERMISSOES_AUTORIZACAO_PREVIA.ler)
  detalhe(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.detalhe(c, id));
  }

  @Get(':id/xml')
  @Permissao(PERMISSOES_AUTORIZACAO_PREVIA.ler)
  xml(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.xml(c, id));
  }

  @Post()
  @AuditadoNoHandler(TRILHA)
  @HttpCode(201)
  @Permissao(PERMISSOES_AUTORIZACAO_PREVIA.solicitar)
  criar(@Req() req: RequisicaoAutorizada, @Body() b: unknown) {
    return this.com(req, (p, c) => p.criar(c, b));
  }

  @Post(':id/envio')
  @AuditadoNoHandler(TRILHA)
  @HttpCode(200)
  @Permissao(PERMISSOES_AUTORIZACAO_PREVIA.solicitar)
  enviar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() b: unknown) {
    return this.com(req, (p, c) => p.enviar(c, id, b));
  }

  @Post(':id/resposta')
  @AuditadoNoHandler(TRILHA)
  @HttpCode(200)
  @Permissao(PERMISSOES_AUTORIZACAO_PREVIA.responder)
  responder(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() b: unknown) {
    return this.com(req, (p, c) => p.responder(c, id, b));
  }

  @Post(':id/andamento')
  @AuditadoNoHandler(TRILHA)
  @HttpCode(201)
  @Permissao(PERMISSOES_AUTORIZACAO_PREVIA.solicitar)
  andamento(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.consultarAndamento(c, id));
  }

  @Post(':id/cancelamento')
  @AuditadoNoHandler(TRILHA)
  @HttpCode(200)
  @Permissao(PERMISSOES_AUTORIZACAO_PREVIA.solicitar)
  cancelar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() b: unknown) {
    return this.com(req, (p, c) => p.cancelar(c, id, b));
  }
}
