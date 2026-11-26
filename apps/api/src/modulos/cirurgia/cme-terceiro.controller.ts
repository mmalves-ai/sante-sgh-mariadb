// Material de terceiro e consignado processado pela CME (F7, 04-CME linha 119; RDC 15/2012). Rotas (porta própria;
// sem banco do cliente, 503):
//   GET  /api/cirurgia/cme/terceiros                           materiais, recebimentos recentes, setores e cirurgias
//   GET  /api/cirurgia/cme/terceiros/donos?tipo=&termo=        fornecedores ou profissionais donos, pela busca
//   POST /api/cirurgia/cme/terceiros/materiais                 cadastra o material com o dono e o roteiro
//   POST /api/cirurgia/cme/terceiros/recebimentos              recebe na CME com o entregador e os itens
//   POST /api/cirurgia/cme/terceiros/recebimentos/:id/conferir      confere peça a peça (ou registra a divergência)
//   POST /api/cirurgia/cme/terceiros/recebimentos/:id/reprocessar   envia ao reprocessamento (pacote por item)
//   POST /api/cirurgia/cme/terceiros/recebimentos/:id/disponibilizar  disponível com todos os pacotes estéreis
//   POST /api/cirurgia/cme/terceiros/recebimentos/:id/devolver      devolução conferida ao dono
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
import { PORTA_CME_TERCEIRO, type PortaCmeTerceiroPropria } from './cme-terceiro-propria.js';

@Controller('cirurgia/cme/terceiros')
export class CmeTerceiroController {
  constructor(
    @Optional()
    @Inject(PORTA_CME_TERCEIRO)
    private readonly porta: PortaCmeTerceiroPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaCmeTerceiroPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    return fn(this.porta, sessaoDe(req).porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao(PERMISSOES_CME.ler)
  painel(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.painelTerceiros(c));
  }

  @Get('donos')
  @Permissao(PERMISSOES_CME.ler)
  donos(@Req() req: RequisicaoAutorizada, @Query('tipo') tipo = 'fornecedor', @Query('termo') termo = '') {
    return this.com(req, (p, c) => p.donos(c, String(tipo), String(termo)));
  }

  @Post('materiais')
  @HttpCode(201)
  @Permissao(PERMISSOES_CME.operar)
  @AuditadoNoHandler('cadastro do material de terceiro pelo executor (trilha na mesma transação)')
  material(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.cadastrarMaterial(c, corpo));
  }

  @Post('recebimentos')
  @HttpCode(201)
  @Permissao(PERMISSOES_CME.operar)
  @AuditadoNoHandler('recebimento do material de terceiro pelo executor (trilha na mesma transação)')
  receber(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.receber(c, corpo));
  }

  @Post('recebimentos/:id/conferir')
  @HttpCode(200)
  @Permissao(PERMISSOES_CME.operar)
  @AuditadoNoHandler('conferência do material de terceiro pelo executor (trilha na mesma transação)')
  conferir(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.conferir(c, id, corpo));
  }

  @Post('recebimentos/:id/reprocessar')
  @HttpCode(200)
  @Permissao(PERMISSOES_CME.operar)
  @AuditadoNoHandler(
    'envio do material de terceiro ao reprocessamento pelo executor (trilha na mesma transação)',
  )
  reprocessar(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.reprocessar(c, id, corpo));
  }

  @Post('recebimentos/:id/disponibilizar')
  @HttpCode(200)
  @Permissao(PERMISSOES_CME.operar)
  @AuditadoNoHandler('disponibilidade do material de terceiro pelo executor (trilha na mesma transação)')
  disponibilizar(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.disponibilizar(c, id, corpo));
  }

  @Post('recebimentos/:id/devolver')
  @HttpCode(200)
  @Permissao(PERMISSOES_CME.operar)
  @AuditadoNoHandler('devolução do material de terceiro pelo executor (trilha na mesma transação)')
  devolver(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.devolver(c, id, corpo));
  }
}
