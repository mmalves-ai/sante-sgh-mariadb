// F3.8, 07-FIN linhas 98 e 99: rotas da reclassificação gerencial e das permissões do financeiro.
//   GET  /api/financeiro/gestao/classificacao?alvo=&id=   a classificação atual do lançamento e as reclassificações
//   GET  /api/financeiro/gestao/centros                   os centros de custo ativos (para o rateio)
//   POST /api/financeiro/gestao/reclassificar             { alvo, id, classificacao, rateio, motivo }
//   GET  /api/financeiro/gestao/usuarios                  os usuários com perfil no estabelecimento
//   GET  /api/financeiro/gestao/escopo-contas?usuario=    as contas com o escopo do usuário
//   POST /api/financeiro/gestao/escopo-contas             { usuario, conta, consultar, movimentar, vigencia... }
//   GET  /api/financeiro/gestao/perfis                    os perfis de acesso do estabelecimento
//   GET  /api/financeiro/gestao/tipos-lancamento?perfil=  os tipos de lançamento com a marca do perfil
//   POST /api/financeiro/gestao/tipos-lancamento          { perfil, tipo, liberado }
//   POST /api/financeiro/gestao/tipos-lancamento/restricao { perfil, restrito } (restrito sem tipo: nada passa)
//   GET  /api/financeiro/gestao/lancamentos?alvo=&termo=  busca pelo número do título ou documento do movimento
// A gravação vai pelo apoio da tesouraria (liberação, permissão da operação, trilha e idempotência no executor); a
// leitura, direto no banco do cliente (sem núcleo: 503, falha fechada).
import { Body, Controller, Get, HttpCode, Inject, Optional, Post, Query, Req } from '@nestjs/common';
import type { ResultadoFinanceiro } from '@sgh/contratos';
import type { Leitor, NucleoProprio } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { NOMES_OPERACAO_TIPO_LANCAMENTO, type OperacaoTipoLancamento } from '@sgh/dominio-financeiro';
import { corpo, inteiroOuNulo } from '../exames/public-api.js';
import { ApoiosFinanceiro } from './apoios.js';
import {
  ALVOS_RECLASSIFICACAO,
  type AlvoReclassificacao,
  buscarLancamentos,
  centrosDoEstabelecimento,
  classificacaoAtual,
  type ClassificacaoAtualResposta,
  escopoDoUsuario,
  esquemaEscopoConta,
  esquemaReclassificar,
  esquemaRestricaoTipoLancamento,
  esquemaTipoLancamentoPerfil,
  perfisDoEstabelecimento,
  tiposDoPerfil,
  usuariosDoEstabelecimento,
} from './gestao-propria.js';
import {
  escopoMemoria,
  manterEscopoMemoria,
  manterRestricaoMemoria,
  manterTipoMemoria,
  perfisMemoria,
  tiposMemoria,
  usuariosMemoria,
} from './gestao-permissoes-memoria.js';
import { NUCLEO_PERIODO_FINANCEIRO } from './periodo.controller.js';
import { type ContextoFinanceiro, PORTA_FINANCEIRO, type PortaFinanceiro } from './porta.js';
import { resultadoFin } from './servico.js';

const idDe = (v: string | undefined, oQue: string): number => {
  const n = inteiroOuNulo(v);
  if (!n)
    throw new ErroProblema('entrada-invalida', 400, `${oQue} inválido`, `Escolha ${oQue.toLowerCase()}.`);
  return n;
};

/** As leituras da reclassificação que a porta em memória (sessão sintética) oferece. */
interface LeituraGestaoMemoria {
  gestaoLancamentos(c: ContextoFinanceiro, alvo: string, termo: string): Promise<unknown[]>;
  gestaoClassificacao(c: ContextoFinanceiro, alvo: string, id: number): Promise<unknown>;
}

@Controller('financeiro/gestao')
export class GestaoFinanceiroController {
  private readonly apoios: ApoiosFinanceiro;

  constructor(
    @Inject(PORTA_FINANCEIRO) private readonly porta: PortaFinanceiro,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(NUCLEO_PERIODO_FINANCEIRO) private readonly nucleo: NucleoProprio | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) fonteConfiguracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    const ambiente = (process.env['AMBIENTE'] ?? 'dev').trim() || 'dev';
    this.apoios = new ApoiosFinanceiro(porta, trilha, fonteConfiguracao, cache, ambiente);
  }

  /** Sem núcleo, a porta em memória da sessão sintética (E2E) responde às leituras da reclassificação. */
  private memoria(): LeituraGestaoMemoria | null {
    if (this.nucleo) return null;
    const p = this.porta as PortaFinanceiro & Partial<LeituraGestaoMemoria>;
    return p.gestaoLancamentos && p.gestaoClassificacao ? (p as LeituraGestaoMemoria) : null;
  }

  /**
   * F3.8, 07-FIN linha 99: o estabelecimento das permissões em memória, só na sessão sintética (porta em memória, sem
   * banco do cliente). Com o banco, devolve nulo e vale o caminho do executor.
   */
  private estMemoria(req: RequisicaoAutorizada): number | null {
    return this.memoria() ? (sessaoDe(req).porta.estabelecimento ?? 0) : null;
  }

  private ler<T>(req: RequisicaoAutorizada, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const s = sessaoDe(req);
    const est = s.porta.estabelecimento;
    if (!this.nucleo) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    if (est === null) throw new ErroProblema('entrada-invalida', 409, 'Escolha o estabelecimento da sessão');
    return this.nucleo.lerSomente(
      { ...s.porta, correlacao: (s.porta.correlacao || 'financeiro').slice(0, 64) },
      (l) => fn(l, est),
    );
  }

  private async gravar(
    req: RequisicaoAutorizada,
    op: string,
    entrada: unknown,
    mensagem: string,
  ): Promise<ResultadoFinanceiro> {
    const r = await this.apoios.daOperacao(op).executar(sessaoDe(req), op, entrada, mensagem);
    return resultadoFin(r.mensagem, r.repetida, r.resultado);
  }

  @Get('classificacao')
  @Permissao('financeiro.classificacao.ler')
  async classificacao(
    @Query('alvo') alvo: string | undefined,
    @Query('id') id: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ClassificacaoAtualResposta> {
    if (!ALVOS_RECLASSIFICACAO.includes(alvo as AlvoReclassificacao))
      throw new ErroProblema('entrada-invalida', 400, 'Lançamento inválido', 'Escolha o tipo do lançamento.');
    const n = idDe(id, 'Lançamento');
    const memoria = this.memoria();
    const r = memoria
      ? ((await memoria.gestaoClassificacao(
          sessaoDe(req).porta,
          alvo as string,
          n,
        )) as ClassificacaoAtualResposta | null)
      : await this.ler(req, (l, est) => classificacaoAtual(l, est, alvo as AlvoReclassificacao, n));
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Lançamento não encontrado');
    return r;
  }

  @Get('centros')
  @Permissao('financeiro.classificacao.ler')
  centros(@Req() req: RequisicaoAutorizada) {
    return this.ler(req, (l, est) => centrosDoEstabelecimento(l, est));
  }

  @Post('reclassificar')
  @HttpCode(200)
  @Permissao('financeiro.classificacao.editar')
  @AuditadoNoHandler('financeiro.reclassificarLancamento pelo executor (trilha na mesma transação)')
  reclassificar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.reclassificarLancamento',
      corpo(esquemaReclassificar, b),
      'Lançamento reclassificado; a classificação anterior fica no histórico.',
    );
  }

  @Get('usuarios')
  @Permissao('financeiro.parametro.ler')
  usuarios(@Req() req: RequisicaoAutorizada) {
    if (this.estMemoria(req) !== null) return usuariosMemoria();
    return this.ler(req, (l, est) => usuariosDoEstabelecimento(l, est));
  }

  @Get('escopo-contas')
  @Permissao('financeiro.parametro.ler')
  escopo(@Query('usuario') usuario: string | undefined, @Req() req: RequisicaoAutorizada) {
    const n = idDe(usuario, 'Usuário');
    const mem = this.estMemoria(req);
    if (mem !== null) return escopoMemoria(mem, n);
    return this.ler(req, (l, est) => escopoDoUsuario(l, est, n));
  }

  @Post('escopo-contas')
  @HttpCode(200)
  @Permissao('financeiro.parametro.editar')
  @AuditadoNoHandler('financeiro.manterEscopoConta pelo executor (trilha na mesma transação)')
  async manterEscopo(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    const e = corpo(esquemaEscopoConta, b);
    const mensagem = 'Escopo de contas do usuário gravado.';
    const mem = this.estMemoria(req);
    if (mem !== null) return resultadoFin(mensagem, false, manterEscopoMemoria(mem, sessaoDe(req).login, e));
    return this.gravar(req, 'financeiro.manterEscopoConta', e, mensagem);
  }

  @Get('perfis')
  @Permissao('financeiro.parametro.ler')
  perfis(@Req() req: RequisicaoAutorizada) {
    if (this.estMemoria(req) !== null) return perfisMemoria();
    return this.ler(req, (l, est) => perfisDoEstabelecimento(l, est));
  }

  @Get('tipos-lancamento')
  @Permissao('financeiro.parametro.ler')
  tipos(
    @Query('perfil') perfil: string | undefined,
    @Query('operacao') operacao: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const n = idDe(perfil, 'Perfil');
    const o = (operacao?.trim() || 'banco') as OperacaoTipoLancamento;
    if (!NOMES_OPERACAO_TIPO_LANCAMENTO.includes(o))
      throw new ErroProblema('entrada-invalida', 400, 'Operação inválida', 'Escolha a operação.');
    const mem = this.estMemoria(req);
    if (mem !== null) return tiposMemoria(mem, n, o);
    return this.ler(req, (l, est) => tiposDoPerfil(l, est, n, o));
  }

  @Post('tipos-lancamento')
  @HttpCode(200)
  @Permissao('financeiro.parametro.editar')
  @AuditadoNoHandler('financeiro.manterTipoLancamento pelo executor (trilha na mesma transação)')
  async manterTipo(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    const e = corpo(esquemaTipoLancamentoPerfil, b);
    const mensagem = 'Tipo do perfil gravado.';
    const mem = this.estMemoria(req);
    if (mem !== null) return resultadoFin(mensagem, false, manterTipoMemoria(mem, e));
    return this.gravar(req, 'financeiro.manterTipoLancamento', e, mensagem);
  }

  @Post('tipos-lancamento/restricao')
  @HttpCode(200)
  @Permissao('financeiro.parametro.editar')
  @AuditadoNoHandler('financeiro.manterRestricaoTipoLancamento pelo executor (trilha na mesma transação)')
  async manterRestricao(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    const e = corpo(esquemaRestricaoTipoLancamento, b);
    const mensagem = 'Restrição de tipos do perfil gravada.';
    const mem = this.estMemoria(req);
    if (mem !== null) return resultadoFin(mensagem, false, manterRestricaoMemoria(mem, e));
    return this.gravar(req, 'financeiro.manterRestricaoTipoLancamento', e, mensagem);
  }

  @Get('lancamentos')
  @Permissao('financeiro.classificacao.ler')
  lancamentos(
    @Query('alvo') alvo: string | undefined,
    @Query('termo') termo: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    if (!ALVOS_RECLASSIFICACAO.includes(alvo as AlvoReclassificacao))
      throw new ErroProblema('entrada-invalida', 400, 'Lançamento inválido', 'Escolha o tipo do lançamento.');
    const memoria = this.memoria();
    if (memoria) return memoria.gestaoLancamentos(sessaoDe(req).porta, alvo as string, termo ?? '');
    return this.ler(req, (l, est) => buscarLancamentos(l, est, alvo as AlvoReclassificacao, termo ?? ''));
  }
}
