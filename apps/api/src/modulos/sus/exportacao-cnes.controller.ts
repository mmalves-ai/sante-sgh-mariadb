// Exportação dos profissionais para o cadastro nacional de estabelecimentos (C3-011, item 3).
// Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/sus/estabelecimento/cnes/exportacoes                 exportações (remessa_cnes tipo 'exportacao')
//   POST /api/sus/estabelecimento/cnes/exportacoes                 { competencia } gera, guarda e grava a remessa
//   GET  /api/sus/estabelecimento/cnes/exportacoes/:id/arquivo     { nomeArquivo, conteudo } do arquivo guardado
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
import { PERMISSOES_ESTABELECIMENTO_SUS } from './estabelecimento-sus.controller.js';
import { PORTA_EXPORTACAO_CNES, type PortaExportacaoCnesPropria } from './exportacao-cnes-propria.js';

@Controller('sus/estabelecimento/cnes/exportacoes')
export class ExportacaoCnesController {
  constructor(
    @Optional()
    @Inject(PORTA_EXPORTACAO_CNES)
    private readonly porta: PortaExportacaoCnesPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaExportacaoCnesPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao(PERMISSOES_ESTABELECIMENTO_SUS.ler)
  listar(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.exportacoes(c));
  }

  @Post()
  @HttpCode(201)
  @Permissao(PERMISSOES_ESTABELECIMENTO_SUS.editar)
  @AuditadoNoHandler(
    'exportação dos profissionais ao cadastro nacional pelo executor (trilha na mesma transação)',
  )
  exportar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.exportar(c, corpo));
  }

  @Get(':id/arquivo')
  @Permissao(PERMISSOES_ESTABELECIMENTO_SUS.ler)
  arquivo(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.arquivo(c, id));
  }
}
