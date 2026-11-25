// Regulação de entrada (C1-080, 02-REC linha 38): os pedidos que a central de regulação manda para este hospital.
// Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/nir/regulacao/recebidos/opcoes         centrais ativas (forma de conexão e contato) e especialidades
//   GET  /api/nir/regulacao/recebidos?todos=sim&paciente=   a fila dos recebidos (os que pedem resposta primeiro)
//   POST /api/nir/regulacao/recebidos                registra o pedido recebido (número da central à mão)
//   POST /api/nir/regulacao/recebidos/:id/resposta   { decisao, motivo?, complemento?, especialidade?, versao }
//   POST /api/nir/regulacao/recebidos/:id/cancelamento   { motivo, complemento?, versao } (central cancelou, não veio)
//   POST /api/nir/regulacao/recebidos/:id/conclusao      { chegadaEm?, internacao?, versao } (o paciente chegou)
// Ler: quem consulta a regulação; registrar e responder: quem registra a regulação (o NIR).
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
import { PERMISSOES_NIR_CODIGOS as P } from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_REGULACAO_ENTRADA, type PortaRegulacaoEntradaPropria } from './regulacao-entrada-propria.js';

const TRILHA = 'regulação de entrada pelo executor (trilha, lista de espera e outbox na mesma transação)';

@Controller('nir/regulacao/recebidos')
export class RegulacaoEntradaController {
  constructor(
    @Optional()
    @Inject(PORTA_REGULACAO_ENTRADA)
    private readonly porta: PortaRegulacaoEntradaPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaRegulacaoEntradaPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('opcoes')
  @Permissao(P.regulacaoLer)
  opcoes(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.opcoes(c));
  }

  @Get()
  @Permissao(P.regulacaoLer)
  listar(@Req() req: RequisicaoAutorizada, @Query() filtro: Record<string, unknown>) {
    return this.com(req, async (p, c) => ({ itens: await p.recebidos(c, filtro) }));
  }

  @Post()
  @HttpCode(201)
  @Permissao(P.regulacaoRegistrar)
  @AuditadoNoHandler(TRILHA)
  receber(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.receber(c, corpo));
  }

  @Post(':id/resposta')
  @HttpCode(200)
  @Permissao(P.regulacaoRegistrar)
  @AuditadoNoHandler(TRILHA)
  responder(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.responder(c, id, corpo));
  }

  @Post(':id/cancelamento')
  @HttpCode(200)
  @Permissao(P.regulacaoRegistrar)
  @AuditadoNoHandler(TRILHA)
  cancelar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.cancelar(c, id, corpo));
  }

  @Post(':id/conclusao')
  @HttpCode(200)
  @Permissao(P.regulacaoRegistrar)
  @AuditadoNoHandler(TRILHA)
  concluir(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.concluir(c, id, corpo));
  }
}
