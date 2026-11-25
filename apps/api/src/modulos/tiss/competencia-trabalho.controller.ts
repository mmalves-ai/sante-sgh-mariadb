// Competência de trabalho do faturista (F3.7, 06-FAT linha 32): cada usuário lê e escolhe a sua, por módulo.
//   GET  /api/tiss/competencia-trabalho?modulo   faturamento.competencia.ler (a do usuário da sessão e o padrão dos filtros)
//   POST /api/tiss/competencia-trabalho          faturamento.competencia.ler (grava só a do próprio usuário; Idempotency-Key)
// A gravação passa pelo executor (trilha e autoria na mesma transação). Sem o banco próprio, 503.
import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req } from '@nestjs/common';
import type { ContextoNucleo, Executor, NucleoProprio } from '@sgh/nucleo';
import { recusa } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, ctxDe, problemaDoPreco } from '../precos/base.js';
import {
  type CompetenciaTrabalhoLida,
  definirCompetenciaTrabalho,
  lerCompetenciaTrabalho,
} from './competencia-trabalho-propria.js';

export const SERVICO_COMPETENCIA_TRABALHO = Symbol('SERVICO_COMPETENCIA_TRABALHO');

/** Leitura e gravação da competência de trabalho sobre o banco próprio. */
export class ServicoCompetenciaTrabalho {
  private readonly executor: Executor;
  constructor(private readonly nucleo: NucleoProprio) {
    this.executor = nucleo.criarExecutor({});
  }
  ler(ctx: ContextoNucleo & { usuario: number | null }, modulo: string): Promise<CompetenciaTrabalhoLida> {
    const est = ctx.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(
      { cliente: ctx.cliente, estabelecimento: est, correlacao: ctx.correlacao },
      (l) => lerCompetenciaTrabalho(l, est, ctx.usuario, modulo),
    );
  }
  gravar(ctx: Parameters<typeof definirCompetenciaTrabalho>[1], entrada: unknown) {
    return definirCompetenciaTrabalho(this.executor, ctx, entrada);
  }
}

@Controller('tiss/competencia-trabalho')
export class CompetenciaTrabalhoController {
  constructor(
    @Inject(SERVICO_COMPETENCIA_TRABALHO) private readonly servico: ServicoCompetenciaTrabalho | null,
  ) {}

  private s(): ServicoCompetenciaTrabalho {
    if (!this.servico)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'A competência de trabalho exige o banco próprio do cliente.',
      );
    return this.servico;
  }

  private async rodar<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw problemaDoPreco(e);
    }
  }

  @Get()
  @Permissao('faturamento.competencia.ler')
  ler(@Query('modulo') modulo: string | undefined, @Req() req: RequisicaoAutorizada) {
    const m = modulo?.trim() || 'fonte_pagadora';
    return this.rodar(() => this.s().ler(ctxDe(req, 'competencia-trabalho'), m));
  }

  @Post()
  @HttpCode(200)
  @Permissao('faturamento.competencia.ler')
  @AuditadoNoHandler(
    'faturamento.definir-competencia-trabalho pelo executor (trilha e autoria na mesma transação)',
  )
  gravar(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() => this.s().gravar(contextoOperacao(req, 'competencia-trabalho'), corpo));
  }
}
