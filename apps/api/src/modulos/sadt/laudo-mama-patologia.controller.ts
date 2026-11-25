// Laudos estruturados de mamografia e de anatomia patológica (F7, 05-SADT linha 18). Rotas (porta própria; sem banco
// do cliente, 503):
//   GET  /api/sadt/laudos-especializados/fila?tipo=mama|anatomopatologico&de=&ate=
//   GET  /api/sadt/laudos-especializados/mama/itens/:item            exame, laudo, achados, laudos anteriores, opções
//   POST /api/sadt/laudos-especializados/mama/itens/:item            rascunho (cria ou altera pela versão)
//   POST /api/sadt/laudos-especializados/mama/laudos/:laudo/liberar  { versao }
//   GET  /api/sadt/laudos-especializados/anatomopatologico/itens/:item
//   POST /api/sadt/laudos-especializados/anatomopatologico/itens/:item
//   POST /api/sadt/laudos-especializados/anatomopatologico/laudos/:laudo/liberar  { versao }
//   GET  /api/sadt/laudos-especializados/pecas-enviadas?de=&ate=     peças da cirurgia ainda sem laudo
//   POST /api/sadt/laudos-especializados/pecas-enviadas/:descricao/receber  { item }
//   GET  /api/sadt/laudos-especializados/siscan/mamografia?de=&ate=  fichas do resultado de mamografia
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
  PORTA_LAUDO_MAMA_PATOLOGIA,
  type PortaLaudoMamaPatologiaPropria,
} from './laudo-mama-patologia-propria.js';

/** Quem lauda redige o rascunho e recebe a peça; a liberação é de quem assina laudo. */
export const PERMISSOES_LAUDO_MAMA_PATOLOGIA = {
  ler: 'sadt.laudo.ler',
  redigir: 'sadt.laudo.criar',
  liberar: 'sadt.laudo.assinar',
} as const;

@Controller('sadt/laudos-especializados')
export class LaudoMamaPatologiaController {
  constructor(
    @Optional()
    @Inject(PORTA_LAUDO_MAMA_PATOLOGIA)
    private readonly porta: PortaLaudoMamaPatologiaPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaLaudoMamaPatologiaPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    return fn(this.porta, sessaoDe(req).porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('fila')
  @Permissao(PERMISSOES_LAUDO_MAMA_PATOLOGIA.ler)
  fila(
    @Req() req: RequisicaoAutorizada,
    @Query('tipo') tipo: unknown,
    @Query('de') de: unknown,
    @Query('ate') ate: unknown,
  ) {
    return this.com(req, (p, c) => p.fila(c, { tipo, de, ate }));
  }

  @Get('mama/itens/:item')
  @Permissao(PERMISSOES_LAUDO_MAMA_PATOLOGIA.ler)
  abrirMama(@Req() req: RequisicaoAutorizada, @Param('item', ParseIntPipe) item: number) {
    return this.com(req, (p, c) => p.abrirMama(c, item));
  }

  @Post('mama/itens/:item')
  @HttpCode(200)
  @Permissao(PERMISSOES_LAUDO_MAMA_PATOLOGIA.redigir)
  @AuditadoNoHandler('laudo de mamografia e achados gravados pelo executor (trilha na mesma transação)')
  salvarMama(
    @Req() req: RequisicaoAutorizada,
    @Param('item', ParseIntPipe) item: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.salvarMama(c, item, corpo));
  }

  @Post('mama/laudos/:laudo/liberar')
  @HttpCode(200)
  @Permissao(PERMISSOES_LAUDO_MAMA_PATOLOGIA.liberar)
  @AuditadoNoHandler('laudo de mamografia liberado pelo executor (trilha na mesma transação)')
  liberarMama(
    @Req() req: RequisicaoAutorizada,
    @Param('laudo', ParseIntPipe) laudo: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.liberarMama(c, laudo, corpo));
  }

  @Get('anatomopatologico/itens/:item')
  @Permissao(PERMISSOES_LAUDO_MAMA_PATOLOGIA.ler)
  abrirAnatomopatologico(@Req() req: RequisicaoAutorizada, @Param('item', ParseIntPipe) item: number) {
    return this.com(req, (p, c) => p.abrirAnatomopatologico(c, item));
  }

  @Post('anatomopatologico/itens/:item')
  @HttpCode(200)
  @Permissao(PERMISSOES_LAUDO_MAMA_PATOLOGIA.redigir)
  @AuditadoNoHandler('laudo anatomopatológico e amostras gravados pelo executor (trilha na mesma transação)')
  salvarAnatomopatologico(
    @Req() req: RequisicaoAutorizada,
    @Param('item', ParseIntPipe) item: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.salvarAnatomopatologico(c, item, corpo));
  }

  @Post('anatomopatologico/laudos/:laudo/liberar')
  @HttpCode(200)
  @Permissao(PERMISSOES_LAUDO_MAMA_PATOLOGIA.liberar)
  @AuditadoNoHandler('laudo anatomopatológico liberado pelo executor (trilha na mesma transação)')
  liberarAnatomopatologico(
    @Req() req: RequisicaoAutorizada,
    @Param('laudo', ParseIntPipe) laudo: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.liberarAnatomopatologico(c, laudo, corpo));
  }

  @Get('pecas-enviadas')
  @Permissao(PERMISSOES_LAUDO_MAMA_PATOLOGIA.ler)
  pecas(@Req() req: RequisicaoAutorizada, @Query('de') de: unknown, @Query('ate') ate: unknown) {
    return this.com(req, (p, c) => p.pecasEnviadas(c, { de, ate }));
  }

  @Post('pecas-enviadas/:descricao/receber')
  @HttpCode(200)
  @Permissao(PERMISSOES_LAUDO_MAMA_PATOLOGIA.redigir)
  @AuditadoNoHandler(
    'peça da cirurgia recebida e laudo anatomopatológico aberto pelo executor (trilha na mesma transação)',
  )
  receber(
    @Req() req: RequisicaoAutorizada,
    @Param('descricao', ParseIntPipe) descricao: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.receberPeca(c, descricao, corpo));
  }

  @Get('siscan/mamografia')
  @Permissao(PERMISSOES_LAUDO_MAMA_PATOLOGIA.ler)
  siscan(@Req() req: RequisicaoAutorizada, @Query('de') de: unknown, @Query('ate') ate: unknown) {
    return this.com(req, (p, c) => p.siscanMamografia(c, { de, ate }));
  }
}
