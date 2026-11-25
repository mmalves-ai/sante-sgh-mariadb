// F8, 07-FIN linha 127 (C2-101): rotas da consolidação gerencial de várias empresas.
//   GET  /api/contabil/consolidacao/apoio                                  estabelecimentos, grupos, métodos e naturezas
//   GET  /api/contabil/consolidacao/grupos/:id?exercicio=                  membros, plano gerencial, de-para e rodadas
//   GET  /api/contabil/consolidacao/grupos/:id/previa?competencia=         totais, eliminações e pendências (sem gravar)
//   GET  /api/contabil/consolidacao/grupos/:id/demonstracoes?competencia=  DRE e balanço consolidados
//   POST /api/contabil/consolidacao/grupos                                  criar ou alterar o grupo e os membros
//   POST /api/contabil/consolidacao/contas-gerenciais                      conta do plano gerencial comum
//   POST /api/contabil/consolidacao/grupos/:id/depara                      de-para das contas dos membros
//   POST /api/contabil/consolidacao/grupos/:id/apurar                      { competencia } apuração com eliminação
//   POST /api/contabil/consolidacao/apuracoes/:id/liberar                  { versao } libera a rodada (não se refaz)
// A gravação vai pelo executor do núcleo (trilha, outbox e idempotência na mesma transação); sem núcleo: 503.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import type { Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  apoioConsolidacao,
  demonstracoesDoGrupo,
  detalheGrupoConsolidacao,
  OPERACOES_CONSOLIDACAO,
  previaConsolidacao,
} from './consolidacao-propria.js';

export const NUCLEO_CONSOLIDACAO = Symbol('NUCLEO_CONSOLIDACAO');

const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;
const positivo = (v: unknown, campo: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ErroProblema('entrada-invalida', 400, `${campo} inválido`);
  return n;
};
const competencia = (v: string | undefined): string => {
  if (!COMPETENCIA.test(v ?? ''))
    throw new ErroProblema('entrada-invalida', 400, 'Informe a competência (AAAA-MM)');
  return v!;
};
const corpo = (b: unknown): Record<string, unknown> =>
  b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
const reais = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

@Controller('contabil/consolidacao')
export class ConsolidacaoController {
  private readonly executor: Executor | null;

  constructor(@Optional() @Inject(NUCLEO_CONSOLIDACAO) private readonly nucleo: NucleoProprio | null = null) {
    this.executor = nucleo ? nucleo.criarExecutor() : null;
  }

  private ler<T>(req: RequisicaoAutorizada, fn: (l: Leitor) => Promise<T>): Promise<T> {
    const s = sessaoDe(req);
    if (!this.nucleo) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    return this.nucleo
      .lerSomente({ ...s.porta, correlacao: (s.porta.correlacao || 'contabil').slice(0, 64) }, fn)
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
  }

  private async gravar(
    req: RequisicaoAutorizada,
    op: keyof typeof OPERACOES_CONSOLIDACAO,
    entrada: unknown,
    mensagem: (r: Record<string, unknown>) => string,
  ) {
    if (!this.executor) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    const s = sessaoDe(req);
    const r = await this.executor
      .executar(OPERACOES_CONSOLIDACAO[op] as never, s.porta.cliente, entrada, contextoOperacao(s, op))
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
    const res = r.resultado as Record<string, unknown>;
    return { mensagem: mensagem(res), repetida: r.repetida, resultado: res };
  }

  @Get('apoio')
  @Permissao('contabil.consolidacao.ler')
  apoio(@Req() req: RequisicaoAutorizada) {
    return this.ler(req, (l) => apoioConsolidacao(l));
  }

  @Get('grupos/:id')
  @Permissao('contabil.consolidacao.ler')
  async detalhe(
    @Param('id') id: string,
    @Query('exercicio') exercicio: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const ano = exercicio ? positivo(exercicio, 'Exercício') : new Date().getFullYear();
    const d = await this.ler(req, (l) => detalheGrupoConsolidacao(l, positivo(id, 'Grupo'), ano));
    if (!d) throw new ErroProblema('nao-encontrado', 404, 'Grupo não encontrado');
    return d;
  }

  @Get('grupos/:id/previa')
  @Permissao('contabil.consolidacao.ler')
  async previa(
    @Param('id') id: string,
    @Query('competencia') comp: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const c = competencia(comp);
    const d = await this.ler(req, (l) => previaConsolidacao(l, positivo(id, 'Grupo'), c));
    if (!d) throw new ErroProblema('nao-encontrado', 404, 'Grupo não encontrado');
    return d;
  }

  @Get('grupos/:id/demonstracoes')
  @Permissao('contabil.consolidacao.ler')
  async demonstracoes(
    @Param('id') id: string,
    @Query('competencia') comp: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const c = competencia(comp);
    const d = await this.ler(req, (l) => demonstracoesDoGrupo(l, positivo(id, 'Grupo'), c));
    if (!d) throw new ErroProblema('nao-encontrado', 404, 'Grupo não encontrado');
    return d;
  }

  @Post('grupos')
  @HttpCode(200)
  @Permissao('contabil.consolidacao.editar')
  @AuditadoNoHandler('contabil.consolidacao_grupo_salvar pelo executor (trilha na mesma transação)')
  salvarGrupo(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar(
      req,
      'salvarGrupo',
      b,
      (r) =>
        `Grupo salvo com ${String(r['membros'])} estabelecimento(s); ${String(r['saiu'])} saiu(saíram) do grupo.`,
    );
  }

  @Post('contas-gerenciais')
  @HttpCode(200)
  @Permissao('contabil.consolidacao.editar')
  @AuditadoNoHandler(
    'contabil.consolidacao_conta_gerencial_incluir pelo executor (trilha na mesma transação)',
  )
  incluirConta(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar(req, 'incluirConta', b, () => 'Conta gerencial incluída no plano comum.');
  }

  @Post('grupos/:id/depara')
  @HttpCode(200)
  @Permissao('contabil.consolidacao.editar')
  @AuditadoNoHandler('contabil.consolidacao_depara_salvar pelo executor (trilha na mesma transação)')
  salvarDePara(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar(
      req,
      'salvarDePara',
      { grupo: positivo(id, 'Grupo'), itens: corpo(b)['itens'] },
      (r) =>
        `De-para salvo: ${String(r['ligadas'])} ligada(s), ${String(r['desligadas'])} trocada(s) ou desligada(s).`,
    );
  }

  @Post('grupos/:id/apurar')
  @HttpCode(200)
  @Permissao('contabil.consolidacao.apurar')
  @AuditadoNoHandler('contabil.consolidacao_apurar pelo executor (trilha na mesma transação)')
  apurar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar(
      req,
      'apurar',
      { grupo: positivo(id, 'Grupo'), competencia: corpo(b)['competencia'] },
      (r) =>
        `Consolidação apurada: ${String(r['eliminacoes'])} eliminação(ões) somando ${reais(Number(r['totalEliminado']))}.`,
    );
  }

  @Post('apuracoes/:id/liberar')
  @HttpCode(200)
  @Permissao('contabil.consolidacao.apurar')
  @AuditadoNoHandler('contabil.consolidacao_liberar pelo executor (trilha na mesma transação)')
  liberar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar(
      req,
      'liberar',
      { apuracao: positivo(id, 'Apuração'), versao: corpo(b)['versao'] },
      () => 'Consolidação liberada; a competência não se refaz mais.',
    );
  }
}
