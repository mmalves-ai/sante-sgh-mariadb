// Rotas da contabilidade, etapa 2 (M54-F2; ficha, seções 2, 6, 7 e regras 3 e 5):
//   GET  /api/contabil/lancamentos/apoio?empresa=            situação da chave, permissões, hoje, tipos e contas analíticas
//   GET  /api/contabil/lancamentos?empresa=&competencia=&tipo=&conta=&pagina=&tamanho=   a lista paginada (≤ 200)
//   GET  /api/contabil/lancamentos/detalhe?empresa=&id=      o lançamento com as partidas, o fato de origem e a regra
//   GET  /api/contabil/razao?empresa=&conta=&de=&ate=&centroCusto=   saldo anterior, movimentos e a conferência
//   POST /api/contabil/lancamentos/manual                     contabil.incluirLancamento (só período aberto)
//   POST /api/contabil/lancamentos/contabilizar               os fatos pendentes (ou recusados) viram lançamentos
//   POST /api/contabil/lancamentos/estornar                   contabil.estornarLancamento (outro lançamento)
//   GET  /api/contabil/conciliacao/pendentes?empresa=&conta=&ate=    as partidas ainda não conciliadas da conta
//   GET  /api/contabil/conciliacao?empresa=&conta=           as conciliações da conta (ativas e desfeitas)
//   POST /api/contabil/conciliacao/registrar                 contabil.conciliar (débitos = créditos)
//   POST /api/contabil/conciliacao/desfazer                  contabil.desfazerConciliacao (com justificativa)
//   GET  /api/contabil/periodos?empresa=                     os períodos com movimento e a situação
//   GET  /api/contabil/periodos/situacao?empresa=&competencia=       totais com as parcelas e os impedimentos
//   POST /api/contabil/periodos/encerrar                     contabil.encerrarPeriodo (crítica: senha de novo)
//   POST /api/contabil/periodos/reabrir                      contabil.reabrirPeriodo (crítica: senha de novo)
// Tudo exige a chave `contabil`, menos o apoio. Cada gravação vai com a SGH_TRILHA na mesma transação; nenhuma tabela do
// banco anterior é escrita (regra 1).
import { Body, Controller, Get, HttpCode, Inject, Optional, Post, Query, Req } from '@nestjs/common';
import {
  type ApoioLancamentos,
  CHAVE_CONTABIL,
  type ConciliacaoListada,
  type DetalheLancamento,
  esquemaConciliarContabil,
  esquemaContabilizar,
  esquemaDesfazerConciliacao,
  esquemaEncerrarPeriodoContabil,
  esquemaEstornarLancamento,
  esquemaFiltroConciliacao,
  esquemaFiltroLancamentos,
  esquemaFiltroRazao,
  esquemaLancamentoManual,
  esquemaPeriodoContabil,
  esquemaReabrirPeriodoContabil,
  esquemaSenhaReautenticacao,
  EVENTOS_AUDITAVEIS,
  type LancamentosContabeis,
  type PendentesConciliacao,
  type PeriodosContabeis,
  type RazaoConta,
  type ResultadoConciliacao,
  type ResultadoContabilizacaoLote,
  type ResultadoLancamento,
  type ResultadoPeriodo,
  ROTAS_CONTABIL_F2 as R,
  type SituacaoDoPeriodo,
} from '@sgh/contratos';
import { competenciaBr, problemasDaConciliacao } from '@sgh/dominio-contabil';
import type { LinhaTrilha } from '@sgh/legado';
import { z } from 'zod';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { linhaTrilha, problemaDoCadastro, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  chaveDeRecursoNaSessao,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { corpo } from '../exames/public-api.js';
import { motivoContabilDesligada } from './contabil.controller.js';
import { type GravadorContabil, PORTA_CONTABIL, type PortaContabil } from './porta.js';
import { ServicoLancamentos } from './servico-lancamentos.js';

const E = EVENTOS_AUDITAVEIS;

function filtro<T>(esquema: z.ZodType<T>, q: unknown): T {
  const r = esquema.safeParse(q ?? {});
  if (!r.success) throw new ErroProblema('entrada-invalida', 400, 'Parâmetros inválidos', 'Filtro inválido.');
  return r.data;
}

const inteiro = z.coerce.number().int();
const opcional = (v: string | undefined) => (v === undefined || v === '' ? undefined : v);
const esquemaEmpresa = z.object({ empresa: inteiro.positive().default(1) });
const esquemaConsultaLancamentos = z.object({
  empresa: inteiro.positive().default(1),
  competencia: z.string().optional(),
  tipo: z.string().optional(),
  conta: z.string().optional(),
  pagina: inteiro.optional(),
  tamanho: inteiro.optional(),
});
const esquemaConsultaDetalhe = z.object({ empresa: inteiro.positive().default(1), id: inteiro.positive() });
const esquemaConsultaRazao = z.object({
  empresa: inteiro.positive().default(1),
  conta: z.string(),
  de: z.string(),
  ate: z.string(),
  centroCusto: inteiro.positive().optional(),
  pagina: inteiro.min(1).optional(),
});
const esquemaConsultaConciliacao = z.object({
  empresa: inteiro.positive().default(1),
  conta: z.string(),
  ate: z.string().optional(),
});
const esquemaConsultaPeriodo = z.object({ empresa: inteiro.positive().default(1), competencia: z.string() });
const esquemaEncerrarComSenha = esquemaEncerrarPeriodoContabil.extend(esquemaSenhaReautenticacao.shape);
const esquemaReabrirComSenha = esquemaReabrirPeriodoContabil.extend(esquemaSenhaReautenticacao.shape);

const dataBr = (d: string) => d.split('-').reverse().join('/');

@Controller()
export class LancamentosContabilController {
  readonly servico: ServicoLancamentos;

  constructor(
    @Inject(PORTA_CONTABIL) private readonly porta: PortaContabil,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) private readonly fonte: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) private readonly cache: CacheConfig | null = null,
  ) {
    this.servico = new ServicoLancamentos(porta);
  }

  private async ligada(req: RequisicaoAutorizada): Promise<boolean> {
    return (await chaveDeRecursoNaSessao(this.fonte, this.cache, req, CHAVE_CONTABIL)).ligada;
  }

  private async exigirChave(req: RequisicaoAutorizada): Promise<SessaoCadastro> {
    const s = sessaoDe(req);
    if (!(await this.ligada(req)))
      throw new ErroProblema('recurso-desligado', 403, 'Contabilidade desligada', motivoContabilDesligada(), {
        codigo: 'recurso-desligado',
      });
    return s;
  }

  private async reautenticar(req: RequisicaoAutorizada, senha: string | undefined): Promise<void> {
    if (this.porta.destino === 'memoria' && !req.sgh?.real) return;
    await reautenticar(this.sessoes, this.resolvedor, req, senha);
  }

  /** Gravação SGH_ com a trilha na mesma transação (na memória, a trilha pelo registrador da API). */
  private async gravar<T>(
    s: SessaoCadastro,
    evento: string,
    operacao: string,
    alvo: (r: T) => { tabela: string; id?: string | null; chave?: string | null; diferenca?: string | null },
    fn: (g: GravadorContabil) => Promise<T>,
  ): Promise<T> {
    const linha = (r: T): LinhaTrilha => {
      const a = alvo(r);
      return {
        ...linhaTrilha(s, evento, 'contabil', operacao, a),
        ...(a.diferenca ? { diferenca: a.diferenca.slice(0, 400) } : {}),
      };
    };
    const r = await this.porta.gravarSgh(s.porta, linha, fn).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
    if (this.porta.destino === 'memoria') {
      const a = alvo(r);
      await this.trilha.registrar({
        evento,
        rede: s.rede,
        hospital: s.hospital,
        usuario: s.login,
        estacao: estacaoDaRequisicao(s.req).slice(0, 80),
        correlacao: correlacaoDaRequisicao(s.req, evento).slice(0, 64),
        recurso: 'contabil',
        resultado: 'sucesso',
        tabelaAlvo: 'MEMORIA',
        idAlvo: a.id ?? a.chave ?? '',
      });
    }
    return r;
  }

  // ── Consultas ──────────────────────────────────────────────────────────────────────────────────

  @Get(R.apoio.caminho)
  @Permissao(R.apoio.permissao)
  async apoio(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ApoioLancamentos> {
    const { empresa } = filtro(esquemaEmpresa, q);
    const s = sessaoDe(req);
    const ligada = await this.ligada(req);
    return this.servico.apoio(
      s.porta,
      {
        ligada,
        motivo: ligada ? null : motivoContabilDesligada(),
        podeVerFatos: s.pode('contabil.fato.ler'),
        podeLancar: s.pode(R.incluir.permissao),
        podeEstornar: s.pode(R.estornar.permissao),
        podeConciliar: s.pode(R.conciliar.permissao),
        podeEncerrar: s.pode(R.encerrar.permissao),
        podeReabrir: s.pode(R.reabrir.permissao),
      },
      empresa,
    );
  }

  @Get(R.lancamentos.caminho)
  @Permissao(R.lancamentos.permissao)
  async lancamentos(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<LancamentosContabeis> {
    const bruto = filtro(esquemaConsultaLancamentos, q);
    const f = filtro(esquemaFiltroLancamentos, {
      empresa: bruto.empresa,
      competencia: opcional(bruto.competencia),
      tipo: opcional(bruto.tipo),
      conta: opcional(bruto.conta),
      pagina: bruto.pagina,
      tamanho: bruto.tamanho,
    });
    const s = await this.exigirChave(req);
    return this.servico.lancamentos(
      s.porta,
      {
        empresa: f.empresa,
        ...(f.competencia !== undefined ? { competencia: f.competencia } : {}),
        ...(f.tipo !== undefined ? { tipo: f.tipo } : {}),
        ...(f.conta !== undefined ? { conta: f.conta } : {}),
      },
      f.pagina,
      f.tamanho,
    );
  }

  @Get(R.detalhe.caminho)
  @Permissao(R.detalhe.permissao)
  async detalhe(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DetalheLancamento> {
    const f = filtro(esquemaConsultaDetalhe, q);
    const s = await this.exigirChave(req);
    return this.servico.detalhe(s.porta, f.empresa, f.id);
  }

  @Get(R.razao.caminho)
  @Permissao(R.razao.permissao)
  async razao(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<RazaoConta> {
    const bruto = filtro(esquemaConsultaRazao, q);
    const f = corpo(esquemaFiltroRazao, bruto);
    const s = await this.exigirChave(req);
    return this.servico.razao(
      s.porta,
      {
        empresa: f.empresa,
        conta: f.conta,
        de: f.de,
        ate: f.ate,
        ...(f.centroCusto !== undefined ? { centroCusto: f.centroCusto } : {}),
      },
      f.pagina,
    );
  }

  @Get(R.pendentesConciliacao.caminho)
  @Permissao(R.pendentesConciliacao.permissao)
  async pendentes(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PendentesConciliacao> {
    const bruto = filtro(esquemaConsultaConciliacao, q);
    const f = filtro(esquemaFiltroConciliacao, { ...bruto, ate: opcional(bruto.ate) });
    const s = await this.exigirChave(req);
    return this.servico.pendentesConciliacao(s.porta, f.empresa, f.conta, f.ate ?? null);
  }

  @Get(R.conciliacoes.caminho)
  @Permissao(R.conciliacoes.permissao)
  async conciliacoes(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ConciliacaoListada[]> {
    const f = filtro(esquemaFiltroConciliacao, filtro(esquemaConsultaConciliacao, q));
    const s = await this.exigirChave(req);
    return this.servico.conciliacoes(s.porta, f.empresa, f.conta);
  }

  @Get(R.periodos.caminho)
  @Permissao(R.periodos.permissao)
  async periodos(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PeriodosContabeis> {
    const { empresa } = filtro(esquemaEmpresa, q);
    const s = await this.exigirChave(req);
    return this.servico.periodos(s.porta, empresa);
  }

  @Get(R.situacaoPeriodo.caminho)
  @Permissao(R.situacaoPeriodo.permissao)
  async situacaoPeriodo(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<SituacaoDoPeriodo> {
    const f = filtro(esquemaPeriodoContabil, filtro(esquemaConsultaPeriodo, q));
    const s = await this.exigirChave(req);
    return this.servico.situacaoPeriodo(s.porta, f.empresa, f.competencia);
  }

  // ── Gravações ──────────────────────────────────────────────────────────────────────────────────

  @Post(R.incluir.caminho)
  @HttpCode(200)
  @Permissao(R.incluir.permissao)
  @AuditadoNoHandler(
    'contabil.incluirLancamento (SGH_CTB_LANCAMENTO e SGH_CTB_PARTIDA) com a SGH_TRILHA na mesma transação',
  )
  async incluir(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoLancamento> {
    const e = corpo(esquemaLancamentoManual, b);
    const s = await this.exigirChave(req);
    const l = await this.servico.planoManual(s.porta, e);
    const r = await this.gravar(
      s,
      E.contabilLancamentoIncluido.codigo,
      'contabil.incluirLancamento',
      (x: { id: number; repetido: boolean }) => ({
        tabela: 'SGH_CTB_LANCAMENTO',
        id: String(x.id),
        diferenca: `empresa=${l.empresa};competencia=${l.competencia};partidas=${l.partidas.length};repetido=${x.repetido ? 'S' : 'N'}`,
      }),
      (g) => g.gravarLancamento(l, s.login),
    );
    return {
      ok: true,
      id: r.id,
      competencia: l.competencia,
      mensagem: r.repetido
        ? `Este lançamento já estava gravado (número ${r.id}).`
        : `Lançamento ${r.id} gravado em ${dataBr(l.data)}.`,
    };
  }

  @Post(R.estornar.caminho)
  @HttpCode(200)
  @Permissao(R.estornar.permissao)
  @AuditadoNoHandler(
    'contabil.estornarLancamento (outro lançamento em SGH_CTB_LANCAMENTO; o original fica) com a SGH_TRILHA',
  )
  async estornar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoLancamento> {
    const e = corpo(esquemaEstornarLancamento, b);
    const s = await this.exigirChave(req);
    const l = await this.servico.planoEstorno(s.porta, e.empresa, e.id, e.justificativa, e.data);
    const r = await this.gravar(
      s,
      E.contabilLancamentoEstornado.codigo,
      'contabil.estornarLancamento',
      (x: { id: number; repetido: boolean }) => ({
        tabela: 'SGH_CTB_LANCAMENTO',
        id: String(x.id),
        diferenca: `estorna=${e.id};competencia=${l.competencia}`,
      }),
      (g) => g.gravarLancamento(l, s.login),
    );
    return {
      ok: true,
      id: r.id,
      competencia: l.competencia,
      mensagem: `Lançamento ${e.id} estornado pelo lançamento ${r.id}, em ${dataBr(l.data)}.`,
    };
  }

  @Post(R.contabilizar.caminho)
  @HttpCode(200)
  @Permissao(R.contabilizar.permissao)
  @AuditadoNoHandler(
    'contabil.contabilizarFatos (SGH_CTB_LANCAMENTO, SGH_CTB_PARTIDA e a situação em SGH_CTB_FATO) com a SGH_TRILHA; sem fato, nada grava',
  )
  async contabilizar(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoContabilizacaoLote> {
    const e = corpo(esquemaContabilizar, b);
    const s = await this.exigirChave(req);
    const { acoes, restam, fatos } = await this.servico.planoContabilizacao(
      s.porta,
      e.empresa,
      e.competencia ?? null,
      e.incluirRecusados,
    );
    const r = this.servico.resumo(acoes);
    let mudaram = 0;
    let naoLancados = 0;
    if (acoes.length > 0)
      await this.gravar(
        s,
        E.contabilFatosContabilizados.codigo,
        'contabil.contabilizarFatos',
        () => ({
          tabela: 'SGH_CTB_LANCAMENTO',
          chave: `${e.empresa}:${e.competencia ?? 'todas'}`,
          diferenca: `fatos=${fatos};lancamentos=${r.lancamentos};movidos=${r.movidos};semRegra=${r.porSituacao.semRegra};semConta=${r.porSituacao.semConta};debitos=${r.debitos};creditos=${r.creditos}`,
        }),
        async (g) => {
          // D-CORRIDA-542: a situação primeiro, condicionada à lida; o fato que outra gravação mudou (o worker, outro
          // Contabilizar) fica como está, sem lançamento, e volta na próxima leitura.
          for (const a of acoes) {
            const marcada = await g.marcarSituacao({
              idFato: a.idFato,
              situacao: a.situacao,
              motivo: a.acao === 'marcar' ? a.motivo : null,
              regraId: a.regraId,
              situacaoLida: a.situacaoLida,
            });
            if (!marcada) {
              mudaram++;
              if (a.acao === 'lancar') naoLancados++;
              continue;
            }
            if (a.acao === 'lancar') await g.gravarLancamento(a.lancamento, s.login);
          }
          return true;
        },
      );
    const quando = e.competencia ? ` de ${competenciaBr(e.competencia)}` : '';
    return {
      empresa: e.empresa,
      competencia: e.competencia ?? null,
      fatos,
      porSituacao: r.porSituacao,
      lancamentos: r.lancamentos - naoLancados,
      movidosDePeriodo: r.movidos,
      totais: { debitos: r.debitos, creditos: r.creditos },
      restam: restam || mudaram > 0,
      mudaramDurante: mudaram,
      mensagem:
        fatos === 0
          ? `Nenhum fato${quando} aguardando contabilização.`
          : `${r.lancamentos - naoLancados} lançamento(s) gravado(s) de ${fatos} fato(s)${quando}; ${r.porSituacao.semRegra} sem regra e ${r.porSituacao.semConta} sem conta.${r.movidos ? ` ${r.movidos} foram ao primeiro período aberto (o do fato está encerrado).` : ''}${mudaram ? ` ${mudaram} fato(s) mudaram durante a contabilização e ficaram como estavam: contabilize de novo.` : restam ? ' Ainda há fatos: contabilize de novo.' : ''}`,
    };
  }

  @Post(R.conciliar.caminho)
  @HttpCode(200)
  @Permissao(R.conciliar.permissao)
  @AuditadoNoHandler(
    'contabil.conciliar (SGH_CTB_CONCILIACAO e as partidas) com a SGH_TRILHA na mesma transação',
  )
  async conciliar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoConciliacao> {
    const e = corpo(esquemaConciliarContabil, b);
    const s = await this.exigirChave(req);
    const r = await this.gravar(
      s,
      E.contabilConciliacaoRegistrada.codigo,
      'contabil.conciliar',
      (x: { id: number; valor: number }) => ({
        tabela: 'SGH_CTB_CONCILIACAO',
        id: String(x.id),
        diferenca: `conta=${e.conta};partidas=${e.partidas.length};valor=${x.valor}`,
      }),
      (g) =>
        g.conciliar({
          empresa: e.empresa,
          conta: e.conta,
          partidas: e.partidas,
          observacao: e.observacao,
          usuario: s.login,
          conferir: (achadas) => problemasDaConciliacao(e.partidas, achadas, e.empresa, e.conta),
        }),
    );
    return { ok: true, id: r.id, mensagem: `${e.partidas.length} partidas conciliadas na conta ${e.conta}.` };
  }

  @Post(R.desfazerConciliacao.caminho)
  @HttpCode(200)
  @Permissao(R.desfazerConciliacao.permissao)
  @AuditadoNoHandler(
    'contabil.desfazerConciliacao (SGH_CTB_CONCILIACAO, sem apagar) com a SGH_TRILHA na mesma transação',
  )
  async desfazer(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoConciliacao> {
    const e = corpo(esquemaDesfazerConciliacao, b);
    const s = await this.exigirChave(req);
    await this.gravar(
      s,
      E.contabilConciliacaoDesfeita.codigo,
      'contabil.desfazerConciliacao',
      () => ({ tabela: 'SGH_CTB_CONCILIACAO', id: String(e.id) }),
      (g) =>
        g.desfazerConciliacao({
          empresa: e.empresa,
          id: e.id,
          justificativa: e.justificativa,
          usuario: s.login,
        }),
    );
    return { ok: true, id: e.id, mensagem: 'Conciliação desfeita: as partidas voltaram a pendentes.' };
  }

  @Post(R.encerrar.caminho)
  @HttpCode(200)
  @Permissao(R.encerrar.permissao)
  @AuditadoNoHandler(
    'contabil.encerrarPeriodo (SGH_CTB_PERIODO, com a linha travada) com a SGH_TRILHA na mesma transação',
  )
  async encerrar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoPeriodo> {
    const e = corpo(esquemaEncerrarComSenha, b);
    const s = await this.exigirChave(req);
    await this.reautenticar(req, e.senha);
    const hoje = await this.porta.hoje(s.porta);
    await this.gravar(
      s,
      E.contabilPeriodoEncerrado.codigo,
      'contabil.encerrarPeriodo',
      (d: { lancamentos: number; debitos: number; creditos: number }) => ({
        tabela: 'SGH_CTB_PERIODO',
        chave: `${e.empresa}:${e.competencia}`,
        diferenca: `lancamentos=${d.lancamentos};debitos=${d.debitos};creditos=${d.creditos}`,
      }),
      (g) =>
        g.encerrarPeriodo({
          empresa: e.empresa,
          competencia: e.competencia,
          observacao: e.observacao,
          usuario: s.login,
          conferir: this.servico.conferirEncerramento(e.competencia, hoje),
        }),
    );
    return {
      ok: true,
      competencia: e.competencia,
      situacao: 'encerrado',
      mensagem: `Período ${competenciaBr(e.competencia)} encerrado: nenhum lançamento entra mais nele.`,
    };
  }

  @Post(R.reabrir.caminho)
  @HttpCode(200)
  @Permissao(R.reabrir.permissao)
  @AuditadoNoHandler(
    'contabil.reabrirPeriodo (SGH_CTB_PERIODO, com a justificativa) com a SGH_TRILHA na mesma transação',
  )
  async reabrir(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoPeriodo> {
    const e = corpo(esquemaReabrirComSenha, b);
    const s = await this.exigirChave(req);
    await this.reautenticar(req, e.senha);
    await this.gravar(
      s,
      E.contabilPeriodoReaberto.codigo,
      'contabil.reabrirPeriodo',
      () => ({ tabela: 'SGH_CTB_PERIODO', chave: `${e.empresa}:${e.competencia}` }),
      (g) =>
        g.reabrirPeriodo({
          empresa: e.empresa,
          competencia: e.competencia,
          justificativa: e.justificativa,
          usuario: s.login,
          conferir: this.servico.conferirReabertura(e.empresa, e.competencia),
        }),
    );
    return {
      ok: true,
      competencia: e.competencia,
      situacao: 'aberto',
      mensagem: `Período ${competenciaBr(e.competencia)} reaberto.`,
    };
  }
}
