// Rotas dos filtros salvos do painel de pacientes (F3.3, linha 03-PEP L90): listar, incluir, alterar (renomear e trocar
// recortes), escolher o padrão e as colunas com largura por filtro. Ler com pep.painel.ler; gravar com
// pep.painel.configurar. A trilha vai na mesma transação, pelo executor (como as rotas vizinhas do painel).
import { Body, Controller, Get, Inject, Optional, Param, ParseIntPipe, Post, Put, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe, type SessaoCadastro } from '../cadastro/comum.js';
import { PERMISSOES_EQUIPE_PAINEL } from './equipe-painel.controller.js';
import { PORTA_PAINEL_FILTROS, type PortaPainelFiltrosPropria } from './painel-filtros-propria.js';

const AUDITORIA = 'executor: trilha na mesma transação dos filtros do painel';

@Controller('pep/painel/filtros')
export class PainelFiltrosController {
  constructor(
    @Optional() @Inject(PORTA_PAINEL_FILTROS) private readonly porta: PortaPainelFiltrosPropria | null = null,
  ) {}

  private com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaPainelFiltrosPropria, c: SessaoCadastro['porta']) => Promise<T>,
  ): Promise<T> {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      if (e instanceof ErroProblema) throw e;
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao(PERMISSOES_EQUIPE_PAINEL.painelLer)
  listar(@Req() req: RequisicaoAutorizada) {
    return this.com(req, async (p, c) => ({ filtros: await p.filtros(c) }));
  }

  @Get('opcoes')
  @Permissao(PERMISSOES_EQUIPE_PAINEL.painelLer)
  opcoes(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.opcoes(c));
  }

  @Post()
  @AuditadoNoHandler(AUDITORIA)
  @Permissao(PERMISSOES_EQUIPE_PAINEL.painelConfigurar)
  incluir(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirFiltro(c, corpo));
  }

  @Put(':filtro')
  @AuditadoNoHandler(AUDITORIA)
  @Permissao(PERMISSOES_EQUIPE_PAINEL.painelConfigurar)
  alterar(
    @Req() req: RequisicaoAutorizada,
    @Param('filtro', ParseIntPipe) filtro: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.alterarFiltro(c, filtro, corpo));
  }

  @Post(':filtro/padrao')
  @AuditadoNoHandler(AUDITORIA)
  @Permissao(PERMISSOES_EQUIPE_PAINEL.painelConfigurar)
  escolherPadrao(@Req() req: RequisicaoAutorizada, @Param('filtro', ParseIntPipe) filtro: number) {
    return this.com(req, (p, c) => p.escolherPadrao(c, filtro));
  }

  @Get(':filtro/colunas')
  @Permissao(PERMISSOES_EQUIPE_PAINEL.painelLer)
  colunas(@Req() req: RequisicaoAutorizada, @Param('filtro', ParseIntPipe) filtro: number) {
    return this.com(req, async (p, c) => ({ colunas: await p.colunas(c, filtro) }));
  }

  @Put(':filtro/colunas')
  @AuditadoNoHandler(AUDITORIA)
  @Permissao(PERMISSOES_EQUIPE_PAINEL.painelConfigurar)
  gravarColunas(
    @Req() req: RequisicaoAutorizada,
    @Param('filtro', ParseIntPipe) filtro: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.gravarColunas(c, filtro, corpo));
  }
}
