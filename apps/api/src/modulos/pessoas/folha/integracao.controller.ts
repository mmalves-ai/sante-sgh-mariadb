// Integração da folha com o financeiro e o contábil, fatia F8 (M53.9; ficha do M53, seção 7; `Gestão de pessoas >
// Integração da folha com financeiro e contábil`):
//   GET  /api/pessoas/folha/integracao/apoio?empresa          empresas, cadastro de rotinas, destinos, sugestão, vigente
//   GET  /api/pessoas/folha/integracao/de-para?empresa        as vigências do de-para da empresa
//   POST /api/pessoas/folha/integracao/de-para                nova vigência do de-para (pessoas.integracao.configurar)
//   POST /api/pessoas/folha/integracao/previa                 prévia dos títulos de uma origem (não grava)
//   POST /api/pessoas/folha/integracao/lancamentos            lança os títulos (pessoas.integracao.lancar)
//   GET  /api/pessoas/folha/integracao/lancamentos?empresa&ano os lançamentos do ano
//   GET  /api/pessoas/folha/integracao/lancamentos/:id        um lançamento, com a situação de cada título
//   GET  /api/pessoas/folha/integracao/custo?empresa&periodo  custo de pessoal por centro de custo (regra 11)
// Toda gravação leva a Idempotency-Key (guarda) e a trilha; o estabelecimento vem da sessão. Nenhum CPF nem nome.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type ApoioIntegracaoFolha,
  type CustoPessoalPeriodo,
  esquemaFiltroCustoPessoal,
  esquemaFiltroLancamentosFolha,
  esquemaFiltroOrigensFolha,
  esquemaGravarIntegracaoFolha,
  esquemaLancarTitulosFolha,
  esquemaPreviaTitulosFolha,
  type IntegracaoFolhaLida,
  type LancamentoFolha,
  type ListaLancamentosFolha,
  type ListaOrigensFolha,
  type ListaCredoresFolha,
  esquemaBuscaCredoresFolha,
  type PreviaTitulosFolha,
  type ResultadoLancamentoFolha,
} from '@sgh/contratos';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { idDaRota, sessaoDe } from '../../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../../config/public-api.js';
import { corpo } from '../../exames/public-api.js';
import { PORTA_CALCULO_FOLHA, type PortaCalculoFolha } from './porta-calculo.js';
import { PORTA_FOLHA, type PortaFolha } from './porta-folha.js';
import { PORTA_INTEGRACAO_FOLHA, type PortaIntegracaoFolha } from './porta-integracao.js';
import { PERMISSOES_INTEGRACAO_FOLHA as P, ServicoIntegracaoFolha } from './servico-integracao.js';

const esquemaEmpresa = z.object({ empresa: z.coerce.number().int().min(0).max(32_767) }).strict();
const esquemaEmpresaOpcional = z
  .object({ empresa: z.coerce.number().int().min(0).max(32_767).optional() })
  .strict();

@Controller('pessoas/folha/integracao')
export class IntegracaoFolhaController {
  readonly servico: ServicoIntegracaoFolha;

  constructor(
    @Inject(PORTA_INTEGRACAO_FOLHA) porta: PortaIntegracaoFolha,
    @Inject(PORTA_CALCULO_FOLHA) calculo: PortaCalculoFolha,
    @Inject(PORTA_FOLHA) folha: PortaFolha,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.servico = new ServicoIntegracaoFolha(porta, calculo, folha, trilha, configuracao, cache);
  }

  @Get('apoio')
  @Permissao(P.ler)
  apoio(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<ApoioIntegracaoFolha> {
    return this.servico.apoioTela(sessaoDe(req), corpo(esquemaEmpresaOpcional, q).empresa ?? null);
  }

  @Get('de-para')
  @Permissao(P.ler)
  dePara(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<IntegracaoFolhaLida[]> {
    return this.servico.integracoes(sessaoDe(req), corpo(esquemaEmpresa, q).empresa);
  }

  @Post('de-para')
  @HttpCode(200)
  @Permissao(P.configurar)
  @AuditadoNoHandler('SGH_PES_FOLHA_INTEGRACAO com a SGH_TRILHA na mesma transação')
  gravarDePara(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<IntegracaoFolhaLida> {
    return this.servico.gravarIntegracao(sessaoDe(req), corpo(esquemaGravarIntegracaoFolha, b));
  }

  @Post('previa')
  @HttpCode(200)
  @Permissao(P.ler)
  @AuditadoNoHandler('prévia: só leitura, nada é gravado (a mesma montagem do lançamento)')
  previa(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<PreviaTitulosFolha> {
    return this.servico.previa(sessaoDe(req), corpo(esquemaPreviaTitulosFolha, b));
  }

  @Post('lancamentos')
  @HttpCode(200)
  @Permissao(P.lancar)
  @AuditadoNoHandler(
    'executor: financeiro.criarTituloPagar (incluir-folha: MFCONPAG, MFLANGSI; SGH_PES_FOLHA_LANCAMENTO, _TITULO, _FATO e SGH_OUTBOX com a SGH_TRILHA)',
  )
  lancar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoLancamentoFolha> {
    return this.servico.lancar(sessaoDe(req), corpo(esquemaLancarTitulosFolha, b));
  }

  @Get('lancamentos')
  @Permissao(P.ler)
  listar(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaLancamentosFolha> {
    return this.servico.listar(sessaoDe(req), corpo(esquemaFiltroLancamentosFolha, q));
  }

  @Get('credores')
  @Permissao(P.ler)
  credores(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaCredoresFolha> {
    return this.servico.credores(sessaoDe(req), corpo(esquemaBuscaCredoresFolha, q));
  }

  @Get('origens')
  @Permissao(P.ler)
  origens(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<ListaOrigensFolha> {
    return this.servico.origens(sessaoDe(req), corpo(esquemaFiltroOrigensFolha, q));
  }

  @Get('lancamentos/:id')
  @Permissao(P.ler)
  detalhe(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<LancamentoFolha> {
    return this.servico.detalhe(sessaoDe(req), idDaRota(id));
  }

  @Get('custo')
  @Permissao(P.ler)
  custo(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<CustoPessoalPeriodo> {
    return this.servico.custo(sessaoDe(req), corpo(esquemaFiltroCustoPessoal, q));
  }
}
