// Favorecidos do repasse e prestadores terceiros (F3.7, 06-FAT linha 46). Rotas (porta própria; na fonte sintética, a em
// memória; sem as duas, 503):
//   GET  /api/repasse/favorecidos?profissional=        favorecidos (vigentes e encerrados) do profissional ou de todos
//   GET  /api/repasse/favorecidos/alvos?tipo=&busca=   empresas, cooperativas, profissionais ou fontes pagadoras
//   GET  /api/repasse/favorecidos/contas?tipo=&id=     contas ativas do credor do tipo (documento só com o final)
//   POST /api/repasse/favorecidos                      inclui; o anterior do mesmo tipo e fonte termina no dia de antes
//   POST /api/repasse/favorecidos/:id/encerrar         { versao, fim } encerra a vigência (nada apagado)
//   GET  /api/repasse/favorecidos/tributos              tributos ativos (para o enquadramento do fornecedor)
//   GET  /api/repasse/favorecidos/processos-judiciais   processos judiciais ativos (enquadramento por decisão judicial)
//   POST /api/repasse/favorecidos/fornecedores/:id/enquadramentos  enquadramento tributário do fornecedor (o mesmo
//        cadastro do contas a pagar); o anterior aberto do mesmo tributo termina no dia de antes
//   GET  /api/repasse/prestadores-terceiros?busca=     prestadores terceiros (ativos primeiro)
//   POST /api/repasse/prestadores-terceiros            inclui o prestador (documento, CNES, percentual, base)
//   POST /api/repasse/prestadores-terceiros/:id        { versao, ativo?, percentualRepasse?, baseRepasse?, ... }
//   GET  /api/repasse/prestadores-terceiros/:id/contas contas de crédito do prestador
//   POST /api/repasse/prestadores-terceiros/:id/contas inclui a conta (titular: o próprio prestador)
// O acesso é o do cargo que mantém cooperativas e credenciamentos do repasse; nada depende de chave de liberação.
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
import { PORTA_FAVORECIDOS_REPASSE, type PortaFavorecidosRepasse } from './favorecidos-propria.js';

export const PERMISSOES_FAVORECIDOS_REPASSE = {
  ler: 'repasse.cooperativa.ler',
  editar: 'repasse.cooperativa.editar',
} as const;

const TIPOS_CREDOR = [
  'proprio_profissional',
  'pessoa_juridica',
  'cooperativa',
  'terceiro_profissional',
  'prestador_terceiro',
] as const;

const idOuNulo = (v: string | undefined): number | null => {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ErroProblema('entrada-invalida', 400, 'Parâmetro inválido');
  return n;
};

@Controller('repasse')
export class FavorecidosRepasseController {
  constructor(
    @Optional()
    @Inject(PORTA_FAVORECIDOS_REPASSE)
    private readonly porta: PortaFavorecidosRepasse | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaFavorecidosRepasse, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('favorecidos')
  @Permissao(PERMISSOES_FAVORECIDOS_REPASSE.ler)
  favorecidos(@Req() req: RequisicaoAutorizada, @Query('profissional') profissional?: string) {
    return this.com(req, async (p, c) => ({ itens: await p.listarFavorecidos(c, idOuNulo(profissional)) }));
  }

  @Get('favorecidos/alvos')
  @Permissao(PERMISSOES_FAVORECIDOS_REPASSE.ler)
  alvos(@Req() req: RequisicaoAutorizada, @Query('tipo') tipo?: string, @Query('busca') busca?: string) {
    if (
      tipo !== 'pessoa_juridica' &&
      tipo !== 'cooperativa' &&
      tipo !== 'terceiro_profissional' &&
      tipo !== 'fonte_pagadora'
    )
      throw new ErroProblema('entrada-invalida', 400, 'Tipo de favorecido inválido');
    return this.com(req, async (p, c) => ({ itens: await p.listarAlvos(c, tipo, busca ?? '') }));
  }

  @Get('favorecidos/contas')
  @Permissao(PERMISSOES_FAVORECIDOS_REPASSE.ler)
  contas(
    @Req() req: RequisicaoAutorizada,
    @Query('tipo') tipo?: string,
    @Query('id') credor?: string,
    @Query('profissional') profissional?: string,
  ) {
    const t = tipo ?? 'proprio_profissional';
    if (!TIPOS_CREDOR.includes(t as never))
      throw new ErroProblema('entrada-invalida', 400, 'Tipo de credor inválido');
    const id = idOuNulo(credor ?? profissional);
    if (id === null) throw new ErroProblema('entrada-invalida', 400, 'Informe o credor');
    return this.com(req, async (p, c) => ({
      itens: await p.listarContas(c, { tipo: t as (typeof TIPOS_CREDOR)[number], id }),
    }));
  }

  @Post('favorecidos')
  @AuditadoNoHandler('executor: trilha na mesma transação do cadastro de favorecidos')
  @HttpCode(201)
  @Permissao(PERMISSOES_FAVORECIDOS_REPASSE.editar)
  incluirFavorecido(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirFavorecido(c, corpo));
  }

  @Post('favorecidos/:id/encerrar')
  @AuditadoNoHandler('executor: trilha na mesma transação do cadastro de favorecidos')
  @HttpCode(200)
  @Permissao(PERMISSOES_FAVORECIDOS_REPASSE.editar)
  encerrarFavorecido(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.encerrarFavorecido(c, id, corpo));
  }

  @Get('favorecidos/tributos')
  @Permissao(PERMISSOES_FAVORECIDOS_REPASSE.ler)
  tributos(@Req() req: RequisicaoAutorizada) {
    return this.com(req, async (p, c) => ({ itens: await p.listarTributos(c) }));
  }

  @Get('favorecidos/processos-judiciais')
  @Permissao(PERMISSOES_FAVORECIDOS_REPASSE.ler)
  processosJudiciais(@Req() req: RequisicaoAutorizada) {
    return this.com(req, async (p, c) => ({ itens: await p.listarProcessosJudiciais(c) }));
  }

  @Post('favorecidos/fornecedores/:id/enquadramentos')
  @AuditadoNoHandler('executor: trilha na mesma transação do cadastro de favorecidos')
  @HttpCode(201)
  @Permissao(PERMISSOES_FAVORECIDOS_REPASSE.editar)
  incluirEnquadramento(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.incluirEnquadramento(c, id, corpo));
  }

  @Get('prestadores-terceiros')
  @Permissao(PERMISSOES_FAVORECIDOS_REPASSE.ler)
  prestadores(@Req() req: RequisicaoAutorizada, @Query('busca') busca?: string) {
    return this.com(req, async (p, c) => ({ itens: await p.listarPrestadores(c, busca ?? null) }));
  }

  @Post('prestadores-terceiros')
  @AuditadoNoHandler('executor: trilha na mesma transação do cadastro de favorecidos')
  @HttpCode(201)
  @Permissao(PERMISSOES_FAVORECIDOS_REPASSE.editar)
  incluirPrestador(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirPrestador(c, corpo));
  }

  @Post('prestadores-terceiros/:id')
  @AuditadoNoHandler('executor: trilha na mesma transação do cadastro de favorecidos')
  @HttpCode(200)
  @Permissao(PERMISSOES_FAVORECIDOS_REPASSE.editar)
  alterarPrestador(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.alterarPrestador(c, id, corpo));
  }

  @Get('prestadores-terceiros/:id/contas')
  @Permissao(PERMISSOES_FAVORECIDOS_REPASSE.ler)
  contasPrestador(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, async (p, c) => ({
      itens: await p.listarContas(c, { tipo: 'prestador_terceiro', id }),
    }));
  }

  @Post('prestadores-terceiros/:id/contas')
  @AuditadoNoHandler('executor: trilha na mesma transação do cadastro de favorecidos')
  @HttpCode(201)
  @Permissao(PERMISSOES_FAVORECIDOS_REPASSE.editar)
  incluirContaPrestador(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.incluirContaPrestador(c, id, corpo));
  }
}
