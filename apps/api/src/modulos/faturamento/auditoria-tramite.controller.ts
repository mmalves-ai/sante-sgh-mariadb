// Auditoria da conta item a item, protocolo entre setores e acompanhamento da guia (F3.7, 06-FAT linhas 21, 22 e 24),
// só com o banco próprio do cliente. As gravações levam Idempotency-Key e passam pelo executor (trilha e autoria).
//   GET  /api/faturamento/contas/:id/auditoria-itens           faturamento.auditoria.ler
//   POST /api/faturamento/contas/:id/auditorias                faturamento.auditoria.ajustar (abrir)
//   POST /api/faturamento/auditorias/:id/pareceres             faturamento.auditoria.ajustar (parecer do item)
//   POST /api/faturamento/auditorias/:id/conclusao             faturamento.auditoria.ajustar
//   POST /api/faturamento/auditorias/:id/cancelamento          faturamento.auditoria.ajustar
//   GET  /api/faturamento/empresas-auditoria                   faturamento.auditoria.ler
//   POST /api/faturamento/empresas-auditoria                   faturamento.regra.editar
//   POST /api/faturamento/empresas-auditoria/:id/ativo         faturamento.regra.editar
//   GET  /api/faturamento/protocolos-tramite?setor=            faturamento.conta.ler
//   POST /api/faturamento/protocolos-tramite                   faturamento.protocolo.registrar (emitir)
//   POST /api/faturamento/protocolos-tramite/:id/envio         faturamento.protocolo.registrar
//   POST /api/faturamento/protocolos-tramite/:id/conferencia   faturamento.protocolo.registrar
//   POST /api/faturamento/protocolos-tramite/:id/cancelamento  faturamento.protocolo.registrar
//   GET  /api/faturamento/guias/:id/acompanhamento             faturamento.guia.ler
//   POST /api/faturamento/guias/:id/resposta                   faturamento.pendencia.editar
//   POST /api/faturamento/guias/:id/pendencias                 faturamento.pendencia.editar
//   POST /api/faturamento/guias/pendencias/:id/resolucao       faturamento.pendencia.editar
//   POST /api/faturamento/guias/:id/responsavel                faturamento.pendencia.editar
//   POST /api/faturamento/guias/:id/anexos                     faturamento.pendencia.editar (conteúdo em base64)
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { validarAnexoGuia } from '@sgh/dominio-faturamento';
import type { ContextoNucleo, Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { recusa } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ArquivosDoModulo } from '../arquivos-locais.js';
import { contextoOperacao, ctxDe, inteiro, problemaDoPreco, sessaoDe } from '../precos/base.js';
import {
  auditoriaItensPropria,
  empresasAuditoria,
  gravarAuditoriaTramite,
  guiaAcompanhamentoPropria,
  type NomeOperacaoAuditoriaTramite,
  protocolosPropria,
} from './auditoria-tramite-propria.js';

export const SERVICO_AUDITORIA_TRAMITE = Symbol('SERVICO_AUDITORIA_TRAMITE');
const EXECUTOR = 'executor: trilha e autoria na mesma transação';
const ORIGEM = 'auditoria-tramite';

export class ServicoAuditoriaTramite {
  private readonly executor: Executor;
  constructor(
    private readonly nucleo: NucleoProprio,
    readonly arquivos: ArquivosDoModulo | null,
  ) {
    this.executor = nucleo.criarExecutor({});
  }
  ler<T>(ctx: ContextoNucleo, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = ctx.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(
      { cliente: ctx.cliente, estabelecimento: est, correlacao: ctx.correlacao },
      (l) => fn(l, est),
    );
  }
  gravar(nome: NomeOperacaoAuditoriaTramite, ctx: Parameters<typeof gravarAuditoriaTramite>[2], e: unknown) {
    return gravarAuditoriaTramite(this.executor, nome, ctx, e);
  }
}

const objeto = (c: unknown): Record<string, unknown> =>
  c !== null && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {};

@Controller()
export class AuditoriaTramiteController {
  constructor(@Inject(SERVICO_AUDITORIA_TRAMITE) private readonly servico: ServicoAuditoriaTramite | null) {}

  private s(): ServicoAuditoriaTramite {
    if (!this.servico)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'A auditoria, o protocolo e o acompanhamento da guia exigem o banco próprio.',
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
  private gravar(
    nome: NomeOperacaoAuditoriaTramite,
    req: RequisicaoAutorizada,
    corpo: Record<string, unknown>,
  ) {
    return this.rodar(() => this.s().gravar(nome, contextoOperacao(req, ORIGEM), corpo));
  }

  // ── Auditoria da conta ──
  @Get('faturamento/contas/:id/auditoria-itens')
  @Permissao('faturamento.auditoria.ler')
  auditoriaItens(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const c = inteiro(id, 'id');
    return this.rodar(() => this.s().ler(ctxDe(req, ORIGEM), (l, est) => auditoriaItensPropria(l, est, c)));
  }

  @Post('faturamento/contas/:id/auditorias')
  @HttpCode(201)
  @Permissao('faturamento.auditoria.ajustar')
  @AuditadoNoHandler(EXECUTOR)
  abrir(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('auditoria.abrir', req, { ...objeto(corpo), contaId: inteiro(id, 'id') });
  }

  @Post('faturamento/auditorias/:id/pareceres')
  @HttpCode(200)
  @Permissao('faturamento.auditoria.ajustar')
  @AuditadoNoHandler(EXECUTOR)
  parecer(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('auditoria.parecer', req, { ...objeto(corpo), auditoriaId: inteiro(id, 'id') });
  }

  @Post('faturamento/auditorias/:id/conclusao')
  @HttpCode(200)
  @Permissao('faturamento.auditoria.ajustar')
  @AuditadoNoHandler(EXECUTOR)
  concluir(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('auditoria.concluir', req, { ...objeto(corpo), auditoriaId: inteiro(id, 'id') });
  }

  @Post('faturamento/auditorias/:id/cancelamento')
  @HttpCode(200)
  @Permissao('faturamento.auditoria.ajustar')
  @AuditadoNoHandler(EXECUTOR)
  cancelar(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('auditoria.cancelar', req, { ...objeto(corpo), auditoriaId: inteiro(id, 'id') });
  }

  @Get('faturamento/empresas-auditoria')
  @Permissao('faturamento.auditoria.ler')
  empresas(@Req() req: RequisicaoAutorizada) {
    return this.rodar(() => this.s().ler(ctxDe(req, ORIGEM), (l) => empresasAuditoria(l)));
  }

  @Post('faturamento/empresas-auditoria')
  @HttpCode(201)
  @Permissao('faturamento.regra.editar')
  @AuditadoNoHandler(EXECUTOR)
  cadastrarEmpresa(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('empresa.cadastrar', req, objeto(corpo));
  }

  @Post('faturamento/empresas-auditoria/:id/ativo')
  @HttpCode(200)
  @Permissao('faturamento.regra.editar')
  @AuditadoNoHandler(EXECUTOR)
  ativarEmpresa(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('empresa.ativo', req, { ...objeto(corpo), empresaId: inteiro(id, 'id') });
  }

  // ── Protocolo entre setores ──
  @Get('faturamento/protocolos-tramite')
  @Permissao('faturamento.conta.ler')
  protocolos(@Query('setor') setor: string | undefined, @Req() req: RequisicaoAutorizada) {
    const st = setor ? inteiro(setor, 'setor') : null;
    return this.rodar(() => this.s().ler(ctxDe(req, ORIGEM), (l, est) => protocolosPropria(l, est, st)));
  }

  @Post('faturamento/protocolos-tramite')
  @HttpCode(201)
  @Permissao('faturamento.protocolo.registrar')
  @AuditadoNoHandler(EXECUTOR)
  emitir(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('protocolo.emitir', req, objeto(corpo));
  }

  @Post('faturamento/protocolos-tramite/:id/envio')
  @HttpCode(200)
  @Permissao('faturamento.protocolo.registrar')
  @AuditadoNoHandler(EXECUTOR)
  enviar(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    return this.gravar('protocolo.enviar', req, { protocoloId: inteiro(id, 'id') });
  }

  @Post('faturamento/protocolos-tramite/:id/conferencia')
  @HttpCode(200)
  @Permissao('faturamento.protocolo.registrar')
  @AuditadoNoHandler(EXECUTOR)
  conferir(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('protocolo.conferir', req, { ...objeto(corpo), protocoloId: inteiro(id, 'id') });
  }

  @Post('faturamento/protocolos-tramite/:id/cancelamento')
  @HttpCode(200)
  @Permissao('faturamento.protocolo.registrar')
  @AuditadoNoHandler(EXECUTOR)
  cancelarProtocolo(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('protocolo.cancelar', req, { ...objeto(corpo), protocoloId: inteiro(id, 'id') });
  }

  // ── Guia do convênio ──
  @Get('faturamento/guias/:id/acompanhamento')
  @Permissao('faturamento.guia.ler')
  guia(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const g = inteiro(id, 'id');
    return this.rodar(() =>
      this.s().ler(ctxDe(req, ORIGEM), (l, est) => guiaAcompanhamentoPropria(l, est, g)),
    );
  }

  @Post('faturamento/guias/:id/resposta')
  @HttpCode(200)
  @Permissao('faturamento.pendencia.editar')
  @AuditadoNoHandler(EXECUTOR)
  responder(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('guia.responder', req, { ...objeto(corpo), guiaId: inteiro(id, 'id') });
  }

  @Post('faturamento/guias/:id/pendencias')
  @HttpCode(201)
  @Permissao('faturamento.pendencia.editar')
  @AuditadoNoHandler(EXECUTOR)
  abrirPendencia(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('guia.pendencia.abrir', req, { ...objeto(corpo), guiaId: inteiro(id, 'id') });
  }

  @Post('faturamento/guias/pendencias/:id/resolucao')
  @HttpCode(200)
  @Permissao('faturamento.pendencia.editar')
  @AuditadoNoHandler(EXECUTOR)
  resolverPendencia(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('guia.pendencia.resolver', req, { ...objeto(corpo), pendenciaId: inteiro(id, 'id') });
  }

  @Post('faturamento/guias/:id/responsavel')
  @HttpCode(200)
  @Permissao('faturamento.pendencia.editar')
  @AuditadoNoHandler(EXECUTOR)
  responsavel(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('guia.responsavel', req, {
      responsavelId: null,
      ...objeto(corpo),
      guiaId: inteiro(id, 'id'),
    });
  }

  /** O binário vai ao disco da instalação (porta de arquivos) e o metadado à guia, nessa ordem. */
  @Post('faturamento/guias/:id/anexos')
  @HttpCode(201)
  @Permissao('faturamento.pendencia.editar')
  @AuditadoNoHandler(EXECUTOR)
  anexar(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const guiaId = inteiro(id, 'id');
    const c = objeto(corpo);
    return this.rodar(async () => {
      const arquivos = this.s().arquivos;
      if (!arquivos)
        throw new ErroProblema(
          'indisponivel',
          503,
          'Indisponível',
          'O armazenamento de arquivos não está ligado.',
        );
      const conteudo = Buffer.from(typeof c['conteudo'] === 'string' ? c['conteudo'] : '', 'base64');
      const tipoMime = typeof c['tipoMime'] === 'string' ? c['tipoMime'] : '';
      const tipoDocumento = typeof c['tipoDocumento'] === 'string' ? c['tipoDocumento'] : '';
      const erros = validarAnexoGuia({
        situacaoGuia: 'solicitada',
        tipoDocumento,
        tipoMime,
        tamanhoBytes: conteudo.length,
      });
      const campos = Object.keys(erros);
      if (campos.length) throw recusa('entrada-invalida', Object.values(erros).join(' '), { campos, erros });
      const nome = (typeof c['nomeOriginal'] === 'string' ? c['nomeOriginal'] : 'anexo').slice(0, 255);
      const g = await arquivos.guardar(sessaoDe(req).hospital, {
        conteudo,
        nomeOriginal: nome,
        tipoMime,
        finalidade: 'anexo',
        entidade: 'guia_fonte_pagadora',
        entidadeId: guiaId,
      });
      return this.s().gravar('guia.anexo', contextoOperacao(req, ORIGEM), {
        guiaId,
        arquivoId: g.id,
        tipoDocumento,
        descricao: typeof c['descricao'] === 'string' && c['descricao'].trim() ? c['descricao'] : null,
      });
    });
  }
}
