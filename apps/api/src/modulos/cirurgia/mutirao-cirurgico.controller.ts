// Projetos e mutirões cirúrgicos do SUS (F8, 04-CC linha 108). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/cirurgia/mutiroes                                     projetos com meta x produção, justificativas, opções
//   POST /api/cirurgia/mutiroes                                     { codigo, descricao, portaria, periodoInicio, ... }
//   GET  /api/cirurgia/mutiroes/:projeto                            metas x produção, insumos, fornecedores e vínculos
//   POST /api/cirurgia/mutiroes/:projeto/situacao                   { versao, situacao, motivo? } (nada apagado)
//   POST /api/cirurgia/mutiroes/:projeto/metas                      { procedimento, quantidadePrevista, valorUnitario? }
//   POST /api/cirurgia/mutiroes/:projeto/metas/:item/retirar        { versao }
//   POST /api/cirurgia/mutiroes/:projeto/insumos                    { insumo | itemFaturavel, quantidadePrevista }
//   POST /api/cirurgia/mutiroes/:projeto/insumos/:item/retirar      { versao }
//   POST /api/cirurgia/mutiroes/:projeto/fornecedores               { fornecedor }
//   POST /api/cirurgia/mutiroes/:projeto/fornecedores/:item/retirar { versao }
//   GET  /api/cirurgia/mutiroes/:projeto/documentos?tipo=&numero=   AIH ou APAC pelo número, com a conferência na hora
//   POST /api/cirurgia/mutiroes/:projeto/aih                        { documento, justificativa, complemento? }
//   POST /api/cirurgia/mutiroes/:projeto/apac                       { documento, justificativa, complemento? }
//   POST /api/cirurgia/mutiroes/:projeto/vinculos/:vinculo/retirar  { versao, justificativa, complemento? }
//   POST /api/cirurgia/mutiroes/justificativas                      { codigo, descricao, aplicaInclusao, ... }
//   POST /api/cirurgia/mutiroes/justificativas/:item/ativo          { versao, ativo }
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
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_MUTIRAO_CIRURGICO, type PortaMutiraoCirurgicoPropria } from './mutirao-cirurgico-propria.js';

/** O faturamento SUS lê e mantém o projeto; a AIH e a APAC são marcadas por quem registra cada uma. */
export const PERMISSOES_MUTIRAO_CIRURGICO = {
  ler: 'faturamento.sus.ler',
  editar: 'faturamento.susCadastro.editar',
  aih: 'faturamento.susAih.registrar',
  apac: 'faturamento.susApac.registrar',
} as const;

@Controller('cirurgia/mutiroes')
export class MutiraoCirurgicoController {
  constructor(
    @Optional()
    @Inject(PORTA_MUTIRAO_CIRURGICO)
    private readonly porta: PortaMutiraoCirurgicoPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaMutiraoCirurgicoPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    return fn(this.porta, sessaoDe(req).porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao(PERMISSOES_MUTIRAO_CIRURGICO.ler)
  painel(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.painel(c));
  }

  @Post()
  @HttpCode(200)
  @Permissao(PERMISSOES_MUTIRAO_CIRURGICO.editar)
  @AuditadoNoHandler('projeto de mutirão cirúrgico incluído pelo executor (trilha na mesma transação)')
  incluir(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirProjeto(c, corpo));
  }

  @Post('justificativas')
  @HttpCode(200)
  @Permissao(PERMISSOES_MUTIRAO_CIRURGICO.editar)
  @AuditadoNoHandler('justificativa do mutirão incluída pelo executor (trilha na mesma transação)')
  incluirJustificativa(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirJustificativa(c, corpo));
  }

  @Post('justificativas/:item/ativo')
  @HttpCode(200)
  @Permissao(PERMISSOES_MUTIRAO_CIRURGICO.editar)
  @AuditadoNoHandler(
    'justificativa do mutirão ativada ou desativada pelo executor (trilha na mesma transação)',
  )
  ativarJustificativa(
    @Req() req: RequisicaoAutorizada,
    @Param('item', ParseIntPipe) item: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.ativarJustificativa(c, item, corpo));
  }

  @Get(':projeto')
  @Permissao(PERMISSOES_MUTIRAO_CIRURGICO.ler)
  detalhe(@Req() req: RequisicaoAutorizada, @Param('projeto', ParseIntPipe) projeto: number) {
    return this.com(req, (p, c) => p.detalhe(c, projeto));
  }

  @Post(':projeto/situacao')
  @HttpCode(200)
  @Permissao(PERMISSOES_MUTIRAO_CIRURGICO.editar)
  @AuditadoNoHandler('situação do projeto de mutirão mudada pelo executor (trilha na mesma transação)')
  situacao(
    @Req() req: RequisicaoAutorizada,
    @Param('projeto', ParseIntPipe) projeto: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.mudarSituacao(c, projeto, corpo));
  }

  @Post(':projeto/metas')
  @HttpCode(200)
  @Permissao(PERMISSOES_MUTIRAO_CIRURGICO.editar)
  @AuditadoNoHandler('meta do mutirão incluída pelo executor (trilha na mesma transação)')
  incluirMeta(
    @Req() req: RequisicaoAutorizada,
    @Param('projeto', ParseIntPipe) projeto: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.incluirMeta(c, projeto, corpo));
  }

  @Post(':projeto/metas/:item/retirar')
  @HttpCode(200)
  @Permissao(PERMISSOES_MUTIRAO_CIRURGICO.editar)
  @AuditadoNoHandler('meta do mutirão retirada pelo executor (trilha na mesma transação)')
  retirarMeta(
    @Req() req: RequisicaoAutorizada,
    @Param('projeto', ParseIntPipe) projeto: number,
    @Param('item', ParseIntPipe) item: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.retirarMeta(c, projeto, item, corpo));
  }

  @Post(':projeto/insumos')
  @HttpCode(200)
  @Permissao(PERMISSOES_MUTIRAO_CIRURGICO.editar)
  @AuditadoNoHandler('insumo do mutirão incluído pelo executor (trilha na mesma transação)')
  incluirInsumo(
    @Req() req: RequisicaoAutorizada,
    @Param('projeto', ParseIntPipe) projeto: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.incluirInsumo(c, projeto, corpo));
  }

  @Post(':projeto/insumos/:item/retirar')
  @HttpCode(200)
  @Permissao(PERMISSOES_MUTIRAO_CIRURGICO.editar)
  @AuditadoNoHandler('insumo do mutirão retirado pelo executor (trilha na mesma transação)')
  retirarInsumo(
    @Req() req: RequisicaoAutorizada,
    @Param('projeto', ParseIntPipe) projeto: number,
    @Param('item', ParseIntPipe) item: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.retirarInsumo(c, projeto, item, corpo));
  }

  @Post(':projeto/fornecedores')
  @HttpCode(200)
  @Permissao(PERMISSOES_MUTIRAO_CIRURGICO.editar)
  @AuditadoNoHandler('fornecedor do mutirão incluído pelo executor (trilha na mesma transação)')
  incluirFornecedor(
    @Req() req: RequisicaoAutorizada,
    @Param('projeto', ParseIntPipe) projeto: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.incluirFornecedor(c, projeto, corpo));
  }

  @Post(':projeto/fornecedores/:item/retirar')
  @HttpCode(200)
  @Permissao(PERMISSOES_MUTIRAO_CIRURGICO.editar)
  @AuditadoNoHandler('fornecedor do mutirão retirado pelo executor (trilha na mesma transação)')
  retirarFornecedor(
    @Req() req: RequisicaoAutorizada,
    @Param('projeto', ParseIntPipe) projeto: number,
    @Param('item', ParseIntPipe) item: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.retirarFornecedor(c, projeto, item, corpo));
  }

  @Get(':projeto/documentos')
  @Permissao(PERMISSOES_MUTIRAO_CIRURGICO.ler)
  documentos(
    @Req() req: RequisicaoAutorizada,
    @Param('projeto', ParseIntPipe) projeto: number,
    @Query('tipo') tipo: unknown,
    @Query('numero') numero: unknown,
  ) {
    return this.com(req, (p, c) => p.buscarDocumento(c, projeto, { tipo, numero }));
  }

  @Post(':projeto/aih')
  @HttpCode(200)
  @Permissao(PERMISSOES_MUTIRAO_CIRURGICO.aih)
  @AuditadoNoHandler('AIH marcada com o projeto de mutirão pelo executor (trilha na mesma transação)')
  vincularAih(
    @Req() req: RequisicaoAutorizada,
    @Param('projeto', ParseIntPipe) projeto: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.vincular(c, projeto, 'aih', corpo));
  }

  @Post(':projeto/apac')
  @HttpCode(200)
  @Permissao(PERMISSOES_MUTIRAO_CIRURGICO.apac)
  @AuditadoNoHandler('APAC marcada com o projeto de mutirão pelo executor (trilha na mesma transação)')
  vincularApac(
    @Req() req: RequisicaoAutorizada,
    @Param('projeto', ParseIntPipe) projeto: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.vincular(c, projeto, 'apac', corpo));
  }

  @Post(':projeto/vinculos/:vinculo/retirar')
  @HttpCode(200)
  @Permissao(PERMISSOES_MUTIRAO_CIRURGICO.editar)
  @AuditadoNoHandler('AIH ou APAC retirada do projeto de mutirão pelo executor (trilha na mesma transação)')
  retirarVinculo(
    @Req() req: RequisicaoAutorizada,
    @Param('projeto', ParseIntPipe) projeto: number,
    @Param('vinculo', ParseIntPipe) vinculo: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.retirarVinculo(c, projeto, vinculo, corpo));
  }
}
