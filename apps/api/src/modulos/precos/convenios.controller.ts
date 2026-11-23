// Convênios e contratos (ficha do M12, seção 7):
//   GET  /api/cadastros/convenios?busca&situacao                         lista com busca por palavra e situação
//   GET  /api/cadastros/convenios/codigos-prestador?convenio&pagina      códigos de prestador e portais (consulta)
//   GET  /api/cadastros/convenios/:cod                                   contrato em abas (constantes ocultas)
//   GET  /api/cadastros/convenios/:cod/modificadores?tipo&pagina          modificadores paginados no servidor
//   GET  /api/cadastros/convenios/:cod/situacao/impacto?operacao          impacto e alertas de suspender/reativar
//   POST /api/cadastros/convenios/:cod/situacao                          convenio.alterarSituacao (crítica)
//   PUT  /api/cadastros/convenios/:cod/contrato                          convenio.alterarContrato (crítica)
//   POST /api/cadastros/convenios/:cod/planos                            plano e vigência do contrato
//   PATCH /api/cadastros/convenios/:cod/planos/:id                       corrigir, encerrar ou desativar o plano
//   GET  /api/cadastros/convenios/:cod/aceita-atendimento                public-api para a agenda (M17)
// As gravações passam pelo EXECUTOR (Idempotency-Key; reautenticação; trilha e autoria na mesma
// transação). Com a fonte em memória, a trilha vai ao registrador da API.
import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import {
  type ContratoConvenio,
  esquemaAlterarContratoConvenio,
  esquemaJustificativa,
  EVENTOS_AUDITAVEIS,
  type ImpactoSituacao,
  type ListaConvenios,
  type PaginaGenerica,
  type PaginaModificadores,
  type ResultadoGravacaoPreco,
  textoCp1252,
} from '@sgh/contratos';
import { convenioAceitaAtendimento } from '@sgh/dominio-preco';

import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import { estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { destinoDoContrato } from '../exames/public-api.js';
import { MODIFICADORES, type TipoModificador } from './tipos.js';
import {
  chaveDoPedido,
  contextoOperacao,
  ctxDe,
  escopoConvenio,
  exigir,
  exigirNoEscopo,
  filtroConvenioDaSessao,
  inteiro,
  inteiroOuNulo,
  paginaDe,
  podeNa,
  problemaDoPreco,
  sessaoDe,
} from './base.js';
import { FONTE_PRECOS, type FontePrecos } from './fonte.js';
import { SERVICO_PRECOS } from './simbolos.js';
import type { ServicoPrecos } from './servico.js';

const esquemaSituacao = z
  .object({
    operacao: z.enum(['suspender', 'reativar']),
    justificativa: esquemaJustificativa,
    senha: z.string(),
  })
  .strict();
const esquemaContrato = z
  .object({
    aba: z.enum(['cadastro', 'faturabilidade', 'financeiro']),
    valores: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
    lidos: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
    justificativa: esquemaJustificativa,
    senha: z.string(),
  })
  .strict();
const esquemaPlano = z
  .object({
    nome: textoCp1252(60).pipe(z.string().min(2)),
    planoLegado: z.number().int().min(1).nullable(),
    inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    fim: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    justificativa: esquemaJustificativa,
    senha: z.string(),
  })
  .strict()
  .refine((p) => p.fim === null || p.fim >= p.inicio, { message: 'Fim antes do início.' });
/** Correção ou encerramento do plano: só os campos informados mudam (encerrar = fim; nunca apagar). */
const esquemaAlterarPlano = z
  .object({
    versao: z.number().int().min(1),
    nome: textoCp1252(60).pipe(z.string().min(2)).optional(),
    fim: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    ativo: z.boolean().optional(),
    justificativa: esquemaJustificativa,
    senha: z.string(),
  })
  .strict()
  .refine((p) => p.nome !== undefined || p.fim !== undefined || p.ativo !== undefined, {
    message: 'Nada a alterar.',
  });

@Controller('cadastros/convenios')
export class ConveniosController {
  constructor(
    @Inject(SERVICO_PRECOS) private readonly servico: ServicoPrecos,
    @Inject(FONTE_PRECOS) private readonly fonte: FontePrecos,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
  ) {}

  @Get()
  @Permissao('convenio.operadora.ler')
  async lista(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<ListaConvenios> {
    const situacao = q['situacao'] === 'ativos' || q['situacao'] === 'suspensos' ? q['situacao'] : 'todos';
    const itens = await this.servico.listarConvenios(
      ctxDe(req, 'convenios'),
      { busca: (q['busca'] ?? '').slice(0, 60), situacao },
      escopoConvenio(req),
    );
    return { itens, total: itens.length, destino: destinoDoContrato(this.fonte.destino) };
  }

  @Get('codigos-prestador')
  @Permissao('convenio.codigoPrestador.ler')
  async codigos(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PaginaGenerica> {
    const p = paginaDe(q);
    // Escopo da sessão: fora dele, lista vazia; sem convênio pedido, só os do escopo.
    const conv = filtroConvenioDaSessao(req, inteiroOuNulo(q['convenio'], 'convenio'));
    const r =
      conv === 'fora'
        ? { colunas: [], itens: [], total: 0 }
        : await this.fonte.codigosPrestador(ctxDe(req, 'codigos-prestador'), conv, p.pagina, p.porPagina);
    return {
      ...r,
      colunas: [...r.colunas],
      itens: [...r.itens],
      ...p,
      avisos: ['Login e senha de portal não aparecem no sistema novo.'],
    };
  }

  @Get(':cod')
  @Permissao('convenio.contrato.ler')
  async contrato(@Param('cod') cod: string, @Req() req: RequisicaoAutorizada): Promise<ContratoConvenio> {
    const c = inteiro(cod, 'convênio');
    exigirNoEscopo(req, c);
    const r = await this.servico.contrato(ctxDe(req, 'contrato'), c, {
      alterarSituacao: podeNa(req, 'convenio.situacao.alterar'),
      editarContrato: podeNa(req, 'convenio.contrato.editar'),
    });
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Convênio não encontrado');
    return r;
  }

  @Get(':cod/modificadores')
  @Permissao('convenio.contrato.ler')
  async modificadores(
    @Param('cod') cod: string,
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PaginaModificadores> {
    const c = inteiro(cod, 'convênio');
    exigirNoEscopo(req, c);
    const tipo = (q['tipo'] ?? 'honorarios') as TipoModificador;
    const def = MODIFICADORES[tipo];
    if (!def) throw new ErroProblema('nao-encontrado', 404, 'Modificador desconhecido');
    const p = paginaDe(q);
    const r = await this.fonte.modificadores(ctxDe(req, 'modificadores'), tipo, c, p.pagina, p.porPagina);
    // Regra 7 (DP-33): o percentual da tabela 625 tem significado a confirmar.
    const aConfirmar = tipo === 'honorarios' && r.itens.some((i) => i['tabela'] === 625);
    return {
      tipo,
      colunas: def.colunas.map(([campo, rotulo]) => ({
        campo,
        rotulo,
        ...(aConfirmar && campo.startsWith('perc') ? { aConfirmar: true } : {}),
      })),
      itens: [...r.itens],
      total: r.total,
      ...p,
    };
  }

  @Get(':cod/situacao/impacto')
  @Permissao('convenio.operadora.ler')
  async impacto(
    @Param('cod') cod: string,
    @Query('operacao') op: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ImpactoSituacao> {
    const c = inteiro(cod, 'convênio');
    exigirNoEscopo(req, c);
    const r = await this.servico.impactoSituacao(
      ctxDe(req, 'impacto'),
      c,
      op === 'reativar' ? 'reativar' : 'suspender',
    );
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Convênio não encontrado');
    return r;
  }

  @Get(':cod/aceita-atendimento')
  @Permissao('convenio.operadora.ler')
  async aceita(@Param('cod') cod: string, @Req() req: RequisicaoAutorizada) {
    const c = inteiro(cod, 'convênio');
    exigirNoEscopo(req, c);
    const conv = await this.fonte.convenio(ctxDe(req, 'aceita'), c);
    return convenioAceitaAtendimento(conv ? { codigo: conv.codigo, situacao: conv.situacao } : null);
  }

  private semGravacao(): void {
    if (!this.fonte.gravacao.permitida)
      throw new ErroProblema(
        'operacao-bloqueada',
        409,
        'Gravação desligada nesta fonte',
        this.fonte.gravacao.motivo ?? 'A gravação está desligada.',
        { codigo: 'gravacao-desligada' },
      );
  }

  private async trilhaMemoria(
    req: RequisicaoAutorizada,
    evento: string,
    recurso: string,
    id: string,
  ): Promise<void> {
    if (this.fonte.destino !== 'memoria') return;
    const { rede, hospital, login } = sessaoDe(req);
    await this.trilha.registrar({
      evento,
      rede,
      hospital,
      usuario: login,
      estacao: estacaoDaRequisicao(req),
      correlacao: ctxDe(req, recurso).traceId,
      recurso,
      resultado: 'sucesso',
      tabelaAlvo: 'MEMORIA',
      idAlvo: id,
    });
  }

  @Post(':cod/situacao')
  @HttpCode(200)
  @Permissao('convenio.situacao.alterar')
  @AuditadoNoHandler('executor: trilha e autoria na mesma transação (memória: registrador da API)')
  async situacao(
    @Param('cod') cod: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoGravacaoPreco> {
    const c = inteiro(cod, 'convênio');
    exigirNoEscopo(req, c);
    const p = esquemaSituacao.safeParse(corpo);
    if (!p.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'Escolha a operação e justifique (5 caracteres ou mais).',
      );
    this.semGravacao();
    const em = await reautenticar(this.sessoes, this.resolvedor, req, p.data.senha);
    const ctx = contextoOperacao(req, 'convenio-situacao', em);
    try {
      await this.fonte.executar(
        'convenio.alterarSituacao',
        ctx,
        { convenio: c, operacao: p.data.operacao, justificativa: p.data.justificativa },
        ctx,
      );
    } catch (e) {
      throw problemaDoPreco(e);
    }
    await this.trilhaMemoria(
      req,
      EVENTOS_AUDITAVEIS.convenioSituacaoAlterada.codigo,
      'convenio.situacao',
      String(c),
    );
    await this.servico.invalidarConvenios(ctxDe(req, 'convenios'), Date.now());
    return {
      operacao: 'convenio.alterarSituacao',
      destino: destinoDoContrato(this.fonte.destino),
      lote: null,
      linhas: 1,
      partes: 1,
      mensagem: p.data.operacao === 'suspender' ? `Convênio ${c} suspenso.` : `Convênio ${c} reativado.`,
    };
  }

  @Put(':cod/contrato')
  @HttpCode(200)
  @Permissao('convenio.contrato.editar')
  @AuditadoNoHandler('executor: trilha e autoria na mesma transação (memória: registrador da API)')
  async alterarContrato(
    @Param('cod') cod: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoGravacaoPreco> {
    const c = inteiro(cod, 'convênio');
    exigirNoEscopo(req, c);
    const p = esquemaContrato.safeParse(corpo);
    if (!p.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'Confira os campos e a justificativa.',
      );
    const entrada = {
      convenio: c,
      aba: p.data.aba,
      valores: p.data.valores,
      lidos: p.data.lidos,
      justificativa: p.data.justificativa,
    };
    const v = esquemaAlterarContratoConvenio.safeParse(entrada);
    if (!v.success)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Confira os campos indicados.', {
        campos: [...new Set(v.error.issues.map((i) => String(i.path[1] ?? i.path[0] ?? '')))],
      });
    this.semGravacao();
    const em = await reautenticar(this.sessoes, this.resolvedor, req, p.data.senha);
    const ctx = contextoOperacao(req, 'convenio-contrato', em);
    try {
      await this.fonte.executar('convenio.alterarContrato', ctx, entrada, ctx);
    } catch (e) {
      throw problemaDoPreco(e);
    }
    await this.trilhaMemoria(
      req,
      EVENTOS_AUDITAVEIS.convenioContratoAlterado.codigo,
      'convenio.contrato',
      String(c),
    );
    await this.servico.invalidarConvenios(ctxDe(req, 'convenios'), Date.now());
    return {
      operacao: 'convenio.alterarContrato',
      destino: destinoDoContrato(this.fonte.destino),
      lote: null,
      linhas: 1,
      partes: 1,
      mensagem: `Contrato do convênio ${c} alterado (${Object.keys(p.data.valores).length} campo(s)).`,
    };
  }

  @Post(':cod/planos')
  @HttpCode(201)
  @Permissao('convenio.contrato.editar')
  @AuditadoNoHandler('gravação do plano com a trilha junto (memória: registrador da API)')
  async plano(@Param('cod') cod: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const c = inteiro(cod, 'convênio');
    exigirNoEscopo(req, c);
    await exigir(req, 'convenio.contrato.editar', this.trilha);
    const p = esquemaPlano.safeParse(corpo);
    if (!p.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'Confira nome, início, fim e justificativa.',
      );
    this.semGravacao();
    await reautenticar(this.sessoes, this.resolvedor, req, p.data.senha);
    const ctx = ctxDe(req, 'convenio-plano');
    const { rede, hospital, login } = sessaoDe(req);
    const conv = await this.fonte.convenio(ctx, c);
    if (!conv) throw new ErroProblema('nao-encontrado', 404, 'Convênio não encontrado');
    try {
      const r = await this.fonte.gravarPlano(
        ctx,
        {
          hospital,
          convenio: c,
          nome: p.data.nome,
          planoLegado: p.data.planoLegado,
          inicio: p.data.inicio,
          fim: p.data.fim,
          justificativa: p.data.justificativa,
          autor: login,
        },
        {
          rede,
          hospital,
          usuario: login,
          evento: EVENTOS_AUDITAVEIS.convenioPlanoGravado.codigo,
          recurso: 'convenio.plano',
          operacao: 'convenio.registrarPlano',
          chaveNaturalAlvo: `CONVENIO:${c}`,
          resultado: 'sucesso',
          estacao: estacaoDaRequisicao(req).slice(0, 80),
          correlacao: ctx.traceId,
          chaveIdempotencia: chaveDoPedido(req),
        },
      );
      await this.trilhaMemoria(
        req,
        EVENTOS_AUDITAVEIS.convenioPlanoGravado.codigo,
        'convenio.plano',
        String(r.id),
      );
      return { id: r.id, destino: destinoDoContrato(this.fonte.destino) };
    } catch (e) {
      throw problemaDoPreco(e);
    }
  }
  @Patch(':cod/planos/:id')
  @HttpCode(200)
  @Permissao('convenio.contrato.editar')
  @AuditadoNoHandler('gravação do plano com a trilha junto (memória: registrador da API)')
  async alterarPlano(
    @Param('cod') cod: string,
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const c = inteiro(cod, 'convênio');
    const idPlano = inteiro(id, 'plano');
    exigirNoEscopo(req, c);
    await exigir(req, 'convenio.contrato.editar', this.trilha);
    const p = esquemaAlterarPlano.safeParse(corpo);
    if (!p.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'Informe o que muda (nome, fim ou situação), a versão lida e a justificativa.',
      );
    this.semGravacao();
    await reautenticar(this.sessoes, this.resolvedor, req, p.data.senha);
    const ctx = ctxDe(req, 'convenio-plano');
    const { rede, hospital, login } = sessaoDe(req);
    try {
      const r = await this.fonte.alterarPlano(
        ctx,
        {
          hospital,
          convenio: c,
          id: idPlano,
          versao: p.data.versao,
          ...(p.data.nome !== undefined ? { nome: p.data.nome } : {}),
          ...(p.data.fim !== undefined ? { fim: p.data.fim } : {}),
          ...(p.data.ativo !== undefined ? { ativo: p.data.ativo } : {}),
          justificativa: p.data.justificativa,
          autor: login,
        },
        {
          rede,
          hospital,
          usuario: login,
          evento: EVENTOS_AUDITAVEIS.convenioPlanoAlterado.codigo,
          recurso: 'convenio.plano',
          operacao: 'convenio.alterarPlano',
          chaveNaturalAlvo: `CONVENIO:${c}`,
          resultado: 'sucesso',
          estacao: estacaoDaRequisicao(req).slice(0, 80),
          correlacao: ctx.traceId,
          chaveIdempotencia: chaveDoPedido(req),
        },
      );
      await this.trilhaMemoria(
        req,
        EVENTOS_AUDITAVEIS.convenioPlanoAlterado.codigo,
        'convenio.plano',
        String(r.id),
      );
      return { id: r.id, versao: r.versao, destino: destinoDoContrato(this.fonte.destino) };
    } catch (e) {
      throw problemaDoPreco(e);
    }
  }
}
