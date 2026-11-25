// Auditoria das checagens de enfermagem (09-AREA linha 86), no banco próprio do cliente:
//   GET  /api/enfermagem/auditoria-checagem[?situacao]           as auditorias, das mais novas, com o andamento
//   GET  /api/enfermagem/auditoria-checagem/apoio                 unidades, motivos de não conformidade e usuários
//   GET  /api/enfermagem/auditoria-checagem/:id                   a auditoria com os auditores e a amostra
//   POST /api/enfermagem/auditoria-checagem                       abre e sorteia a amostra
//   POST /api/enfermagem/auditoria-checagem/:id/itens/:item       avalia uma checagem da amostra
//   POST /api/enfermagem/auditoria-checagem/:id/conclusao         conclui com os totais e o resultado
//   POST /api/enfermagem/auditoria-checagem/:id/cancelamento      cancela com o motivo (fica no histórico)
// Ler pede enfermagem.auditoriaChecagem.ler; gravar, enfermagem.auditoriaChecagem.auditar (por perfil: qualidade,
// auditoria e enfermagem com conselho). A trilha vai na mesma transação da gravação (Executor), e a mesma
// Idempotency-Key não grava duas vezes.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { EVENTOS_AUDITAVEIS, PERMISSOES_ENFERMAGEM } from '@sgh/contratos';
import { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  type AberturaFeita,
  abrirAuditoriaTx,
  apoioAuditoria,
  avaliarItemTx,
  cancelarAuditoriaTx,
  concluirAuditoriaTx,
  lerAuditoria,
  listarAuditorias,
  TABELAS_AUDITORIA_CHECAGEM,
} from './auditoria-checagem-propria.js';
import { sessaoComAto } from './gravacao-direta.js';
import { PORTA_ENFERMAGEM, type PortaEnfermagem } from './porta.js';
import { PortaEnfermagemPropria } from './porta-propria.js';

const P = PERMISSOES_ENFERMAGEM;
const DATA_HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const SITUACOES = ['aberta', 'em_andamento', 'concluida', 'cancelada'] as const;

export const esquemaAberturaAuditoria = z
  .object({
    inicio: z.string().regex(DATA_HORA),
    fim: z.string().regex(DATA_HORA),
    unidade: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9 ._-]{1,20}$/)
      .nullable()
      .default(null),
    atendimento: z.number().int().positive().nullable().default(null),
    tamanho: z.number().int().min(1).max(200),
    semente: z.string().trim().max(60).nullable().default(null),
    criterio: z.string().trim().max(300).nullable().default(null),
    auditores: z
      .array(
        z.object({ usuario: z.number().int().positive(), papel: z.enum(['auditor', 'observador']) }).strict(),
      )
      .max(20)
      .default([]),
    observacao: z.string().trim().max(2000).nullable().default(null),
  })
  .strict();

export const esquemaAvaliacaoAuditoria = z
  .object({
    resultado: z.enum(['conforme', 'nao_conforme', 'nao_aplicavel']),
    motivo: z.number().int().positive().nullable().default(null),
    justificativa: z.string().trim().max(2000).nullable().default(null),
  })
  .strict();

export const esquemaCancelamentoAuditoria = z.object({ motivo: z.string().trim().min(1).max(500) }).strict();

@Controller('enfermagem/auditoria-checagem')
export class AuditoriaChecagemController {
  constructor(@Inject(PORTA_ENFERMAGEM) private readonly porta: PortaEnfermagem) {}

  private propria(): PortaEnfermagemPropria {
    if (!(this.porta instanceof PortaEnfermagemPropria))
      throw new ErroProblema(
        'recurso-desligado',
        501,
        'Auditoria das checagens',
        'A auditoria das checagens grava só no banco próprio do cliente.',
        { codigo: 'pendente-modelo-proprio' },
      );
    return this.porta;
  }

  @Get()
  @Permissao(P.auditoriaChecagemLer)
  @Auditar(EVENTOS_AUDITAVEIS.enfermagemHorarioLido.codigo)
  async listar(@Query('situacao') situacao: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const filtro = SITUACOES.find((x) => x === situacao) ?? null;
    const itens = await this.propria().lerNoBanco(s.porta, (l, est) => listarAuditorias(l, est, filtro));
    req.sghAlvo = { tabelaAlvo: 'auditoria_checagem', chaveNaturalAlvo: `lista:${filtro ?? 'todas'}` };
    return { itens };
  }

  @Get('apoio')
  @Permissao(P.auditoriaChecagemLer)
  async apoio(@Req() req: RequisicaoAutorizada) {
    return this.propria().lerNoBanco(sessaoDe(req).porta, (l, est) => apoioAuditoria(l, est));
  }

  @Get(':id')
  @Permissao(P.auditoriaChecagemLer)
  @Auditar(EVENTOS_AUDITAVEIS.enfermagemHorarioLido.codigo)
  async ler(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(id);
    const r = await this.propria().lerNoBanco(sessaoDe(req).porta, (l, est) => lerAuditoria(l, est, n));
    req.sghAlvo = { tabelaAlvo: 'auditoria_checagem', chaveNaturalAlvo: `auditoria:${n}` };
    return r;
  }

  @Post()
  @HttpCode(201)
  @Permissao(P.auditoriaChecagemAuditar)
  @AuditadoNoHandler('a abertura em auditoria_checagem com a trilha_auditoria na mesma transação')
  async abrir(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaAberturaAuditoria, b);
    const s = sessaoComAto(sessaoDe(req), e, null, ':auditoria-checagem');
    const r = await this.propria().gravarNaTransacao<AberturaFeita>(
      s.porta,
      'enfermagem.abrir-auditoria-checagem',
      TABELAS_AUDITORIA_CHECAGEM,
      (f) => ({
        estabelecimento: null,
        usuario: null,
        correlacao: null,
        acao: 'inclusao',
        entidade: 'auditoria_checagem',
        entidadeId: f.id,
        dadosDepois: { inicio: e.inicio, fim: e.fim, unidade: e.unidade, atendimento: e.atendimento },
      }),
      (tx, est, an) => abrirAuditoriaTx(tx, est, an, e),
    );
    return {
      ok: true,
      ...r,
      mensagem: `Auditoria aberta: ${r.amostra.length} checagem(ns) sorteada(s) entre ${r.candidatas} feita(s) no período.`,
    };
  }

  @Post(':id/itens/:item')
  @HttpCode(200)
  @Permissao(P.auditoriaChecagemAuditar)
  @AuditadoNoHandler('a avaliação em auditoria_checagem_item com a trilha_auditoria na mesma transação')
  async avaliar(
    @Param('id') id: string,
    @Param('item') item: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const n = idDaRota(id);
    const i = idDaRota(item);
    const e = corpo(esquemaAvaliacaoAuditoria, b);
    const s = sessaoComAto(sessaoDe(req), { id: n, item: i, ...e }, null, ':avaliacao-auditoria');
    const r = await this.propria().gravarNaTransacao(
      s.porta,
      'enfermagem.avaliar-auditoria-checagem',
      TABELAS_AUDITORIA_CHECAGEM,
      {
        estabelecimento: null,
        usuario: null,
        correlacao: null,
        acao: 'alteracao',
        entidade: 'auditoria_checagem_item',
        entidadeId: i,
        dadosDepois: { resultado: e.resultado, motivo: e.motivo },
      },
      (tx, est, an) => avaliarItemTx(tx, est, an, n, i, e),
    );
    return { ok: true, ...r, mensagem: 'Avaliação registrada.' };
  }

  @Post(':id/conclusao')
  @HttpCode(200)
  @Permissao(P.auditoriaChecagemAuditar)
  @AuditadoNoHandler('a conclusão em auditoria_checagem com a trilha_auditoria na mesma transação')
  async concluir(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(id);
    const s = sessaoComAto(sessaoDe(req), { id: n }, null, ':conclusao-auditoria');
    const r = await this.propria().gravarNaTransacao(
      s.porta,
      'enfermagem.concluir-auditoria-checagem',
      TABELAS_AUDITORIA_CHECAGEM,
      {
        estabelecimento: null,
        usuario: null,
        correlacao: null,
        acao: 'alteracao',
        entidade: 'auditoria_checagem',
        entidadeId: n,
      },
      (tx, est, an) => concluirAuditoriaTx(tx, est, an, n),
    );
    return {
      ok: true,
      ...r,
      mensagem: `Auditoria concluída: ${r.totalConforme} de ${r.totalAuditado} checagem(ns) conforme(s).`,
    };
  }

  @Post(':id/cancelamento')
  @HttpCode(200)
  @Permissao(P.auditoriaChecagemAuditar)
  @AuditadoNoHandler('o cancelamento em auditoria_checagem com a trilha_auditoria na mesma transação')
  async cancelar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(id);
    const e = corpo(esquemaCancelamentoAuditoria, b);
    const s = sessaoComAto(sessaoDe(req), { id: n, ...e }, null, ':cancelamento-auditoria');
    const r = await this.propria().gravarNaTransacao(
      s.porta,
      'enfermagem.cancelar-auditoria-checagem',
      TABELAS_AUDITORIA_CHECAGEM,
      {
        estabelecimento: null,
        usuario: null,
        correlacao: null,
        acao: 'alteracao',
        entidade: 'auditoria_checagem',
        entidadeId: n,
        motivo: e.motivo,
      },
      (tx, est, an) => cancelarAuditoriaTx(tx, est, an, n, e.motivo),
    );
    return { ok: true, ...r, mensagem: 'Auditoria cancelada: ela fica no histórico com o motivo.' };
  }
}
