// Fluxo do material esterilizado entre a CME e os setores (F7, 04-CME linha 117; RDC 15/2012). Rotas (porta própria;
// sem banco do cliente, 503):
//   GET  /api/cirurgia/cme/fluxo                              fila de solicitações, arsenal, pacotes fora da CME,
//                                                             movimentos recentes, permissões por setor e setores
//   GET  /api/cirurgia/cme/fluxo/usuarios?busca=              usuários para o cadastro de permissões (3 letras)
//   POST /api/cirurgia/cme/fluxo/solicitacoes/:id/receber     a CME recebe a solicitação
//   POST /api/cirurgia/cme/fluxo/solicitacoes/:id/cancelar    cancela a solicitação ainda não atendida, com o motivo
//   POST /api/cirurgia/cme/fluxo/entregas                     entrega ao setor os pacotes da solicitação
//   POST /api/cirurgia/cme/fluxo/recolhimentos                recolhe do setor (arsenal ou expurgo)
//   POST /api/cirurgia/cme/fluxo/movimentos/:id/conferir      o setor confere o movimento
//   POST /api/cirurgia/cme/fluxo/permissoes                   grava as permissões do colaborador num setor
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
import { PERMISSOES_CME } from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_CME_MOVIMENTO, type PortaCmeMovimentoPropria } from './cme-movimento-propria.js';

@Controller('cirurgia/cme/fluxo')
export class CmeMovimentoController {
  constructor(
    @Optional()
    @Inject(PORTA_CME_MOVIMENTO)
    private readonly porta: PortaCmeMovimentoPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaCmeMovimentoPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    return fn(this.porta, sessaoDe(req).porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao(PERMISSOES_CME.ler)
  painel(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.painel(c));
  }

  @Get('usuarios')
  @Permissao(PERMISSOES_CME.operar)
  usuarios(@Req() req: RequisicaoAutorizada, @Query('busca') busca?: string) {
    return this.com(req, (p, c) => p.usuarios(c, busca ?? '').then((itens) => ({ itens })));
  }

  @Post('solicitacoes/:id/receber')
  @HttpCode(200)
  @Permissao(PERMISSOES_CME.operar)
  @AuditadoNoHandler(
    'solicitação de material estéril recebida pela CME pelo executor (trilha na mesma transação)',
  )
  receber(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.receber(c, id));
  }

  @Post('solicitacoes/:id/cancelar')
  @HttpCode(200)
  @Permissao(PERMISSOES_CME.solicitar)
  @AuditadoNoHandler('solicitação de material estéril cancelada pelo executor (trilha na mesma transação)')
  cancelar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.cancelar(c, id, corpo));
  }

  @Post('entregas')
  @HttpCode(201)
  @Permissao(PERMISSOES_CME.operar)
  @AuditadoNoHandler('entrega de material estéril ao setor pelo executor (trilha na mesma transação)')
  entregar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.entregarAoSetor(c, corpo));
  }

  @Post('recolhimentos')
  @HttpCode(201)
  @Permissao(PERMISSOES_CME.operar)
  @AuditadoNoHandler('recolhimento de material do setor pelo executor (trilha na mesma transação)')
  recolher(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.recolher(c, corpo));
  }

  @Post('movimentos/:id/conferir')
  @HttpCode(200)
  @Permissao(PERMISSOES_CME.solicitar)
  @AuditadoNoHandler('conferência do movimento de material estéril pelo executor (trilha na mesma transação)')
  conferir(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.conferir(c, id));
  }

  @Post('permissoes')
  @HttpCode(200)
  @Permissao(PERMISSOES_CME.operar)
  @AuditadoNoHandler('permissões da CME por setor pelo executor (trilha na mesma transação)')
  permissao(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.gravarPermissao(c, corpo));
  }
}
