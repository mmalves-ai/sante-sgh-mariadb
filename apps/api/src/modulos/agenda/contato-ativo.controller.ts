// Rotas do contato ativo com o paciente antes da consulta (02-REC linha 39). Ler a fila e o histórico: quem lê as
// marcações (agenda.marcacao.ler). Registrar, programar e cancelar o programado: quem confirma a consulta e registra a
// tentativa de confirmação (agenda.marcacao.confirmar); o resultado de desistência só cancela a consulta com a
// permissão de cancelar (agenda.marcacao.cancelar), conferida no domínio. Sem banco próprio, 503.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe, type SessaoCadastro } from '../cadastro/comum.js';
import { contextoGravacao } from './apoio.js';
import type { ContatoAtivoPropria } from './contato-ativo.js';

export const CONTATO_ATIVO = Symbol('CONTATO_ATIVO');

@Controller('agenda/contato-ativo')
export class ContatoAtivoController {
  constructor(@Optional() @Inject(CONTATO_ATIVO) private readonly porta: ContatoAtivoPropria | null = null) {}

  private exigirBanco(): ContatoAtivoPropria {
    if (!this.porta)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'O contato ativo fica no banco do estabelecimento, que não está configurado.',
      );
    return this.porta;
  }

  private gravacao(s: SessaoCadastro, rotulo: string) {
    const g = contextoGravacao(s, rotulo, true);
    return {
      hospital: s.hospital,
      login: s.login,
      correlacao: g.correlacao,
      chaveIdempotencia: g.chaveIdempotencia,
      podeCancelar: s.pode('agenda.marcacao.cancelar'),
      ...(g.enderecoIp ? { enderecoIp: g.enderecoIp } : {}),
    };
  }

  @Get('fila')
  @Permissao('agenda.marcacao.ler')
  fila(@Query('dias') dias: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = Number(dias ?? 3);
    return this.exigirBanco().fila({ hospital: s.hospital, login: s.login }, Number.isInteger(n) ? n : 3);
  }

  @Get('resultados')
  @Permissao('agenda.marcacao.ler')
  resultados(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.exigirBanco().resultados({ hospital: s.hospital, login: s.login });
  }

  @Get('pacientes/:id')
  @Permissao('agenda.marcacao.ler')
  historico(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.exigirBanco().historico({ hospital: s.hospital, login: s.login }, idDaRota(id));
  }

  @Post()
  @HttpCode(200)
  @Permissao('agenda.marcacao.confirmar')
  @AuditadoNoHandler('agenda.contato_ativo_registrar pelo executor (trilha na mesma transação)')
  async registrar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const r = await this.exigirBanco().registrar(this.gravacao(sessaoDe(req), 'agenda.contatoAtivo'), b);
    return { ok: true, ...r, mensagem: 'Contato registrado.' };
  }

  @Post('programar')
  @HttpCode(200)
  @Permissao('agenda.marcacao.confirmar')
  @AuditadoNoHandler('agenda.contato_ativo_programar pelo executor (trilha na mesma transação)')
  async programar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const r = await this.exigirBanco().programar(this.gravacao(sessaoDe(req), 'agenda.contatoAtivo'), b);
    return { ok: true, ...r, mensagem: 'Contato programado.' };
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @Permissao('agenda.marcacao.confirmar')
  @AuditadoNoHandler('agenda.contato_ativo_cancelar pelo executor (trilha na mesma transação)')
  async cancelar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const r = await this.exigirBanco().cancelar(this.gravacao(sessaoDe(req), 'agenda.contatoAtivo'), {
      ...(b as object),
      id: idDaRota(id),
    });
    return { ok: true, ...r, mensagem: 'Contato programado cancelado.' };
  }
}
