// Valor do índice de cobrança e do porte por vigência (06-FAT linha 5), na tela do contrato:
//   GET  /api/cadastros/convenios/:cod/indices/opcoes   convenio.contrato.ler: índices ativos, portes de honorário e
//                                                       tabelas de honorários do acordo (para o formulário)
//   POST /api/cadastros/convenios/:cod/indices/:tipo    convenio.contrato.editar: registra a vigência nova (tipo:
//                                                       indice, porte, porte-anestesico); nada se altera nem se apaga
// A gravação leva Idempotency-Key e passa pelo executor (trilha e autoria na mesma transação). Sem o banco próprio,
// 503 (falha fechada). O convênio fora do escopo da sessão é recusado sem vazar.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { type Leitor, type NucleoProprio, recusa } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, ctxDe, exigirNoEscopo, inteiro, problemaDoPreco } from './base.js';
import { FONTE_PRECOS, type CtxPrecos, type FontePrecos } from './fonte.js';
import type { GravadorIndices, TipoGravacaoIndice } from './indices-gravacao.js';

export const GRAVADOR_INDICES = Symbol('GRAVADOR_INDICES');
export const LEITOR_INDICES = Symbol('LEITOR_INDICES');
const EXECUTOR = 'executor: trilha e autoria na mesma transação';
const TIPOS: readonly TipoGravacaoIndice[] = ['indice', 'porte', 'porte-anestesico'];

export interface OpcoesIndices {
  readonly indices: { id: number; codigo: string; descricao: string; tipo: string }[];
  readonly portes: { codigo: string; descricao: string }[];
  readonly tabelas: { id: number; codigo: string; descricao: string; regime: string }[];
}

/** As opções do formulário: catálogos da rede e as tabelas de honorários do acordo deste estabelecimento. */
export async function opcoesIndicesPropria(l: Leitor, est: number, conv: number): Promise<OpcoesIndices> {
  const indices = await l.consultar(
    `SELECT id, codigo, descricao, tipo_indice FROM indice_cobranca
      WHERE ativo = TRUE AND tipo_indice IN ('coeficiente_honorario', 'custo_operacional', 'filme')
      ORDER BY tipo_indice, codigo`,
    [],
    { teto: 200 },
  );
  const portes = await l.consultar(
    "SELECT codigo, descricao FROM porte_procedimento WHERE tipo_porte = 'honorario' ORDER BY ordem, codigo",
    [],
    { teto: 500 },
  );
  const tabelas = await l.consultar(
    `SELECT DISTINCT t.id, t.codigo, t.descricao, ctv.tipo_item FROM contrato_tabela_vigencia ctv
       JOIN contrato_fonte_pagadora k ON k.id = ctv.contrato_fonte_pagadora_id
       JOIN tabela_preco t ON t.id = ctv.tabela_preco_id AND t.estabelecimento_id = k.estabelecimento_id
      WHERE k.fonte_pagadora_id = ? AND k.estabelecimento_id = ? AND k.excluido_em IS NULL
        AND ctv.tipo_item IN ('honorario_internacao', 'honorario_ambulatorial')
      ORDER BY t.codigo, ctv.tipo_item`,
    [conv, est],
    { teto: 200 },
  );
  return {
    indices: indices.map((r) => ({
      id: Number(r['id']),
      codigo: String(r['codigo']),
      descricao: String(r['descricao']),
      tipo: String(r['tipo_indice']),
    })),
    portes: portes.map((r) => ({ codigo: String(r['codigo']), descricao: String(r['descricao']) })),
    tabelas: tabelas.map((r) => ({
      id: Number(r['id']),
      codigo: String(r['codigo']),
      descricao: String(r['descricao']),
      regime: String(r['tipo_item']) === 'honorario_internacao' ? 'internacao' : 'ambulatorial',
    })),
  };
}

export class LeitorIndices {
  constructor(private readonly nucleo: Pick<NucleoProprio, 'lerSomente'>) {}
  opcoes(c: CtxPrecos, conv: number): Promise<OpcoesIndices> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    const ctx = {
      cliente: c.cliente,
      estabelecimento: est,
      usuario: c.usuario,
      correlacao: (c.correlacao || c.traceId || 'precos').slice(0, 64),
    };
    return this.nucleo.lerSomente(ctx, (l) => opcoesIndicesPropria(l, est, conv));
  }
}

const objeto = (c: unknown): Record<string, unknown> =>
  c !== null && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {};

@Controller('cadastros/convenios')
export class IndicesController {
  constructor(
    @Inject(FONTE_PRECOS) private readonly fonte: FontePrecos,
    @Inject(GRAVADOR_INDICES) private readonly gravador: GravadorIndices | null,
    @Inject(LEITOR_INDICES) private readonly leitor: LeitorIndices | null,
  ) {}

  @Get(':cod/indices/opcoes')
  @Permissao('convenio.contrato.ler')
  async opcoes(@Param('cod') cod: string, @Req() req: RequisicaoAutorizada): Promise<OpcoesIndices> {
    if (!this.leitor) throw new ErroProblema('indisponivel', 503, 'Os índices exigem o banco próprio.');
    const c = inteiro(cod, 'convênio');
    exigirNoEscopo(req, c);
    const ctx = ctxDe(req, 'indices');
    if (!(await this.fonte.convenio(ctx, c)))
      throw new ErroProblema('nao-encontrado', 404, 'Convênio não encontrado');
    try {
      return await this.leitor.opcoes(ctx, c);
    } catch (e) {
      throw problemaDoPreco(e);
    }
  }

  @Post(':cod/indices/:tipo')
  @HttpCode(201)
  @Permissao('convenio.contrato.editar')
  @AuditadoNoHandler(EXECUTOR)
  async registrar(
    @Param('cod') cod: string,
    @Param('tipo') tipo: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: number }> {
    if (!(TIPOS as readonly string[]).includes(tipo))
      throw new ErroProblema('nao-encontrado', 404, 'Tipo de valor desconhecido');
    if (!this.gravador) throw new ErroProblema('indisponivel', 503, 'Os índices exigem o banco próprio.');
    const c = inteiro(cod, 'convênio');
    exigirNoEscopo(req, c);
    const ctx = contextoOperacao(req, 'indices');
    if (!(await this.fonte.convenio(ctx, c)))
      throw new ErroProblema('nao-encontrado', 404, 'Convênio não encontrado');
    try {
      return await this.gravador.gravar(tipo as TipoGravacaoIndice, ctx, { ...objeto(corpo), fonteId: c });
    } catch (e) {
      throw problemaDoPreco(e);
    }
  }
}
