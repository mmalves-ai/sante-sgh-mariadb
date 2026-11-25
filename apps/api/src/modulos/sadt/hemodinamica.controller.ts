// Registro do exame de hemodinâmica (F8, 04-CC linha 107). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/sadt/hemodinamica/fila?de=&ate=                 exames pedidos ao setor no período, com o registro
//   GET  /api/sadt/hemodinamica/itens/:item                   o exame pedido, o registro, os achados e as opções
//   POST /api/sadt/hemodinamica/itens/:item/iniciar           { inicioEm, viaAcesso, primeiroOperador, ... }
//   POST /api/sadt/hemodinamica/registros/:registro           { versao, ..., achados } (achado mudado fica no histórico)
//   POST /api/sadt/hemodinamica/registros/:registro/concluir  { versao } (conclusão com os indicadores de dose)
//   POST /api/sadt/hemodinamica/registros/:registro/cancelar  { versao, motivo }
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
import { PORTA_HEMODINAMICA, type PortaHemodinamicaPropria } from './hemodinamica-propria.js';

/** Quem lauda o exame registra o procedimento; a conclusão do laudo estruturado é de quem assina laudo. */
export const PERMISSOES_HEMODINAMICA = {
  ler: 'sadt.laudo.ler',
  registrar: 'sadt.laudo.criar',
  concluir: 'sadt.laudo.assinar',
} as const;

@Controller('sadt/hemodinamica')
export class HemodinamicaController {
  constructor(
    @Optional()
    @Inject(PORTA_HEMODINAMICA)
    private readonly porta: PortaHemodinamicaPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaHemodinamicaPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    return fn(this.porta, sessaoDe(req).porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('fila')
  @Permissao(PERMISSOES_HEMODINAMICA.ler)
  fila(@Req() req: RequisicaoAutorizada, @Query('de') de: unknown, @Query('ate') ate: unknown) {
    return this.com(req, (p, c) => p.fila(c, { de, ate }));
  }

  @Get('itens/:item')
  @Permissao(PERMISSOES_HEMODINAMICA.ler)
  abrir(@Req() req: RequisicaoAutorizada, @Param('item', ParseIntPipe) item: number) {
    return this.com(req, (p, c) => p.abrir(c, item));
  }

  @Post('itens/:item/iniciar')
  @HttpCode(200)
  @Permissao(PERMISSOES_HEMODINAMICA.registrar)
  @AuditadoNoHandler('registro de hemodinâmica aberto pelo executor (trilha na mesma transação)')
  iniciar(
    @Req() req: RequisicaoAutorizada,
    @Param('item', ParseIntPipe) item: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.iniciar(c, item, corpo));
  }

  @Post('registros/:registro')
  @HttpCode(200)
  @Permissao(PERMISSOES_HEMODINAMICA.registrar)
  @AuditadoNoHandler('registro de hemodinâmica e achados gravados pelo executor (trilha na mesma transação)')
  salvar(
    @Req() req: RequisicaoAutorizada,
    @Param('registro', ParseIntPipe) registro: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.salvar(c, registro, corpo));
  }

  @Post('registros/:registro/concluir')
  @HttpCode(200)
  @Permissao(PERMISSOES_HEMODINAMICA.concluir)
  @AuditadoNoHandler('registro de hemodinâmica concluído pelo executor (trilha na mesma transação)')
  concluir(
    @Req() req: RequisicaoAutorizada,
    @Param('registro', ParseIntPipe) registro: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.concluir(c, registro, corpo));
  }

  @Post('registros/:registro/cancelar')
  @HttpCode(200)
  @Permissao(PERMISSOES_HEMODINAMICA.registrar)
  @AuditadoNoHandler('registro de hemodinâmica cancelado pelo executor (trilha na mesma transação)')
  cancelar(
    @Req() req: RequisicaoAutorizada,
    @Param('registro', ParseIntPipe) registro: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.cancelar(c, registro, corpo));
  }
}
