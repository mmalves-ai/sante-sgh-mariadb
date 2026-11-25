// Cabeçalho da impressão por tipo de documento (F3, 03-PEP L131). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/pep/cabecalhos-impressao                      regras e opções da tela
//   GET  /api/pep/cabecalhos-impressao/previa?tipoDocumento= a regra que vale e as linhas impressas
//   POST /api/pep/cabecalhos-impressao                      { tipoDocumento, todosEstabelecimentos, fonte, ... }
//   POST /api/pep/cabecalhos-impressao/:regra               { versao, fonte, cabecalho, rodape, ... }
//   POST /api/pep/cabecalhos-impressao/:regra/ativo         { versao, ativo } (nada apagado)
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
import {
  PORTA_CABECALHO_IMPRESSAO,
  type PortaCabecalhoImpressaoPropria,
} from './cabecalho-impressao-propria.js';

/** A administração do PEP mantém os cabeçalhos (como os modelos de impressão). */
export const PERMISSOES_CABECALHO_IMPRESSAO = { ler: 'pep.admin.ler', editar: 'pep.admin.editar' } as const;

@Controller('pep/cabecalhos-impressao')
export class CabecalhoImpressaoController {
  constructor(
    @Optional()
    @Inject(PORTA_CABECALHO_IMPRESSAO)
    private readonly porta: PortaCabecalhoImpressaoPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaCabecalhoImpressaoPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    return fn(this.porta, sessaoDe(req).porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao(PERMISSOES_CABECALHO_IMPRESSAO.ler)
  regras(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.regras(c));
  }

  @Get('previa')
  @Permissao(PERMISSOES_CABECALHO_IMPRESSAO.ler)
  previa(@Req() req: RequisicaoAutorizada, @Query() consulta: unknown) {
    return this.com(req, (p, c) => p.previa(c, consulta));
  }

  @Post()
  @HttpCode(200)
  @Permissao(PERMISSOES_CABECALHO_IMPRESSAO.editar)
  @AuditadoNoHandler('regra de cabeçalho incluída pelo executor (trilha na mesma transação)')
  incluir(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluir(c, corpo));
  }

  @Post(':regra')
  @HttpCode(200)
  @Permissao(PERMISSOES_CABECALHO_IMPRESSAO.editar)
  @AuditadoNoHandler('regra de cabeçalho alterada pelo executor (trilha na mesma transação)')
  alterar(
    @Req() req: RequisicaoAutorizada,
    @Param('regra', ParseIntPipe) regra: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.alterar(c, regra, corpo));
  }

  @Post(':regra/ativo')
  @HttpCode(200)
  @Permissao(PERMISSOES_CABECALHO_IMPRESSAO.editar)
  @AuditadoNoHandler('regra de cabeçalho ativada ou desativada pelo executor (trilha na mesma transação)')
  ativo(
    @Req() req: RequisicaoAutorizada,
    @Param('regra', ParseIntPipe) regra: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.ativar(c, regra, corpo));
  }
}
