// Competência de trabalho do faturista (F3.7, 06-FAT linha 32): cada usuário lê e escolhe a sua, por módulo.
//   GET  /api/tiss/competencia-trabalho?modulo   a do usuário da sessão e o padrão dos filtros
//   POST /api/tiss/competencia-trabalho          grava só a do próprio usuário; Idempotency-Key
// A permissão é a de leitura da tela do módulo (PERMISSAO_POR_MODULO): o faturista do SUS ou do repasse escolhe a
// competência das telas dele sem precisar da permissão das competências do convênio, e não escolhe a de outro módulo.
// A gravação passa pelo executor (trilha e autoria na mesma transação). Sem o banco próprio, 503.
import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req } from '@nestjs/common';
import type { ContextoNucleo, Executor, NucleoProprio } from '@sgh/nucleo';
import { pode } from '@sgh/dominio-acesso';
import { MODULOS_COMPETENCIA_TRABALHO, type ModuloCompetenciaTrabalho } from '@sgh/dominio-faturamento';
import { recusa } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao, PermissaoOu } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, ctxDe, problemaDoPreco } from '../precos/base.js';
import {
  type CompetenciaTrabalhoLida,
  definirCompetenciaTrabalho,
  lerCompetenciaTrabalho,
} from './competencia-trabalho-propria.js';

/** A permissão de leitura da tela de cada módulo: quem a tem escolhe a própria competência de trabalho nele. */
export const PERMISSAO_POR_MODULO: Readonly<Record<ModuloCompetenciaTrabalho, string>> = {
  fonte_pagadora: 'faturamento.competencia.ler',
  sus_ambulatorial: 'faturamento.sus.ler',
  sus_internacao: 'faturamento.sus.ler',
  repasse: 'repasse.lancamento.ler',
  rpa: 'repasse.rpa.ler',
};

/** O módulo pedido, conferido contra a permissão da sessão (400 fora da lista; 403 sem a permissão do módulo). */
export function moduloPermitido(valor: unknown, req: RequisicaoAutorizada): ModuloCompetenciaTrabalho {
  const m = typeof valor === 'string' && valor.trim() ? valor.trim() : 'fonte_pagadora';
  if (!(MODULOS_COMPETENCIA_TRABALHO as readonly string[]).includes(m))
    throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Módulo de competência desconhecido.');
  const modulo = m as ModuloCompetenciaTrabalho;
  const ability = req.sgh?.ability;
  if (!ability || !pode(ability, PERMISSAO_POR_MODULO[modulo]))
    throw new ErroProblema('sem-permissao', 403, 'Sem permissão', 'Seu perfil não permite esta ação.');
  return modulo;
}

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
  @PermissaoOu('faturamento.sus.ler', 'repasse.lancamento.ler', 'repasse.rpa.ler')
  ler(@Query('modulo') modulo: string | undefined, @Req() req: RequisicaoAutorizada) {
    const m = moduloPermitido(modulo, req);
    return this.rodar(() => this.s().ler(ctxDe(req, 'competencia-trabalho'), m));
  }

  @Post()
  @HttpCode(200)
  @Permissao('faturamento.competencia.ler')
  @PermissaoOu('faturamento.sus.ler', 'repasse.lancamento.ler', 'repasse.rpa.ler')
  @AuditadoNoHandler(
    'faturamento.definir-competencia-trabalho pelo executor (trilha e autoria na mesma transação)',
  )
  gravar(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    moduloPermitido((corpo as { modulo?: unknown } | null)?.modulo, req);
    return this.rodar(() => this.s().gravar(contextoOperacao(req, 'competencia-trabalho'), corpo));
  }
}
