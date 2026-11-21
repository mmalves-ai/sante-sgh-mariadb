// W0-04 (programa CRUD completo, M5 do mercado): a comissão de revisão de prontuários (CFM 1.638/2002) sobre a comissão
// do tipo 'prontuario' da gestão da qualidade. Só tabelas SGH_QUA_REV_* (script 1025); a alta, a clínica e o médico
// assistente são lidos do outro sistema, nunca gravados.
//   GET  /api/qualidade/revisao-prontuarios/comissoes                 as comissões de revisão de prontuários
//   GET  /api/qualidade/revisao-prontuarios/checklists?comissao=      as revisões do checklist (a vigente e as anteriores)
//   POST /api/qualidade/revisao-prontuarios/checklists                publicar (a seguinte substitui a vigente, com motivo)
//   POST /api/qualidade/revisao-prontuarios/checklists/:id/inativacao inativar com motivo
//   GET  /api/qualidade/revisao-prontuarios/altas?competencia=        o universo do sorteio e a amostra sugerida
//   GET  /api/qualidade/revisao-prontuarios/sorteios?comissao=        os sorteios
//   POST /api/qualidade/revisao-prontuarios/sorteios                  sortear (a semente fica registrada)
//   GET  /api/qualidade/revisao-prontuarios/sorteios/:id              o sorteio com os prontuários e as pendências
//   GET  /api/qualidade/revisao-prontuarios/sorteios/:id/conferencia  refazer o sorteio com a semente e comparar
//   POST /api/qualidade/revisao-prontuarios/sorteios/:id/cancelamento cancelar (crítico; só sem revisão)
//   POST /api/qualidade/revisao-prontuarios/prontuarios/:id/revisao   revisar ou corrigir (antes do aval)
//   POST /api/qualidade/revisao-prontuarios/prontuarios/:id/aval      aval da comissão (crítico)
//   GET  /api/qualidade/revisao-prontuarios/indicador?comissao=&competencia=  % conforme por clínica
//   GET  /api/qualidade/revisao-prontuarios/minhas-pendencias        as pendências do profissional da sessão
//   POST /api/qualidade/revisao-prontuarios/pendencias/:id/resposta   o profissional responde a própria
//   POST /api/qualidade/revisao-prontuarios/pendencias/:id/cancelamento a comissão cancela com motivo
//   GET  /api/qualidade/revisao-prontuarios/versoes/:registro/:id     as versões anteriores (inativas)
//   GET  /api/qualidade/revisao-prontuarios/aval?reg=                 o aval lido pelo SAME
import { TABELA_DO_REGISTRO } from './tipos.js';
import { createHash, randomInt } from 'node:crypto';
import { Body, Controller, Get, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type AvalRevisaoProntuario,
  type ChecklistRevisaoLido,
  CHECKLIST_REVISAO_SUGERIDO,
  esquemaAvalRevisao,
  esquemaCancelarPendenciaRevisao,
  esquemaCancelarSorteioRevisao,
  esquemaConsultaAvalRevisao,
  esquemaFiltroCompetenciaQualidade,
  esquemaFiltroIndicadorRevisao,
  esquemaFiltroSorteiosRevisao,
  esquemaInativarChecklistRevisao,
  esquemaItemChecklistRevisao,
  esquemaPublicarChecklistRevisao,
  esquemaRespostaItemRevisao,
  esquemaResponderPendenciaRevisao,
  esquemaRevisarProntuario,
  esquemaSortearRevisao,
  EVENTOS_AUDITAVEIS,
  type IndicadorRevisaoProntuario,
  type ItemChecklistRevisao,
  MENSAGENS_RECUSA_REVISAO,
  PARAMETRO_PRAZO_PENDENCIA_REVISAO,
  type PendenciaRevisaoLida,
  PERMISSOES_QUALIDADE as P,
  PRAZO_PENDENCIA_REVISAO_DIAS,
  type RegistroVersionadoQualidade,
  type ProntuarioRevisaoLido,
  type RecusaRevisaoProntuario,
  type RespostaItemRevisao,
  type SituacaoChecklistRevisao,
  type SituacaoPendenciaRevisao,
  type SituacaoRevisaoProntuario,
  type SorteioRevisaoLido,
  TETO_AMOSTRA_REVISAO,
} from '@sgh/contratos';
import {
  amostraSugerida,
  avaliarRevisao,
  competenciaFechada,
  conformidadePorClinica,
  descricaoPendencia,
  diasDaCompetenciaQualidade,
  recusaAval,
  recusaCancelamentoSorteio,
  recusaPublicacaoChecklist,
  recusaRespostaPendencia,
  recusaRevisao,
  sementeGerada,
  somarDiasData,
  sortearAmostra,
  textoDoAval,
  universoCanonico,
} from '@sgh/dominio-qualidade';
import type { ChecklistRevisaoRegistrado, PendenciaRevisaoRegistrada, ProntuarioRevisaoRegistrado } from './tipos.js';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ApoioGravacao, corpo } from '../exames/public-api.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import {
  avisarPendenciaNaCentral,
  CENTRAL_AVISOS_QUALIDADE,
  type CentralAvisosQualidade,
} from './central-pendencias.js';
import { CHAVE_QUALIDADE_GESTAO } from './gestao.controller.js';
import { type GravadorGestao, PORTA_GESTAO, type PortaGestao } from './porta-gestao.js';

const E = EVENTOS_AUDITAVEIS;
const B = '/qualidade/revisao-prontuarios';

const CONFLITO: ReadonlySet<RecusaRevisaoProntuario> = new Set([
  'checklist-vigente-desatualizado',
  'sorteio-cancelado',
  'sorteio-com-revisao',
  'revisao-com-aval',
  'pendencia-aberta',
  'pendencia-encerrada',
  'aval-ja-registrado',
  'comissao-inativa',
]);
const recusaRevisaoHttp = (m: RecusaRevisaoProntuario, avisos: readonly string[] = []) =>
  new ErroProblema(
    CONFLITO.has(m) ? 'recusa-de-negocio' : 'entrada-invalida',
    m === 'pendencia-nao-e-sua' ? 403 : CONFLITO.has(m) ? 409 : 422,
    'Revisão de prontuários',
    [MENSAGENS_RECUSA_REVISAO[m], ...avisos].join(' '),
    { codigo: m, bloqueios: [m], ...(avisos.length ? { avisos } : {}) },
  );
const recusar = (m: RecusaRevisaoProntuario | null): void => {
  if (m) throw recusaRevisaoHttp(m);
};
const naoEncontrado = (o: string) => new ErroProblema('nao-encontrado', 404, `${o} não encontrado`);

/** JSON gravado lido pelo esquema (linha corrompida vira lista vazia, nunca erro na tela). */
function lista<T>(texto: string | null, item: z.ZodType<T>): T[] {
  if (!texto) return [];
  try {
    const r = z.array(item).safeParse(JSON.parse(texto));
    return r.success ? r.data : [];
  } catch {
    return [];
  }
}
const itensDe = (t: string | null): ItemChecklistRevisao[] => lista(t, esquemaItemChecklistRevisao);
const respostasDe = (t: string | null): RespostaItemRevisao[] => lista(t, esquemaRespostaItemRevisao);
const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

function checklistLido(c: ChecklistRevisaoRegistrado): ChecklistRevisaoLido {
  return { ...c, itens: itensDe(c.itens), situacao: c.situacao as SituacaoChecklistRevisao };
}
function pendenciaLida(p: PendenciaRevisaoRegistrada, hoje: string): PendenciaRevisaoLida {
  const situacao = p.situacao as SituacaoPendenciaRevisao;
  return {
    id: p.id,
    prontuario: p.prontuario,
    reg: p.reg,
    item: p.item,
    descricao: p.descricao,
    profissionalNome: p.profissionalNome,
    profissionalLogin: p.profissionalLogin,
    prazo: p.prazo,
    situacao,
    vencida: situacao === 'aberta' && p.prazo < hoje,
    resposta: p.resposta,
    resolvidaPor: p.resolvidaPor,
    resolvidaEm: p.resolvidaEm,
    canceladaPor: p.canceladaPor,
    canceladaEm: p.canceladaEm,
    motivoCancelamento: p.motivoCancelamento,
    criadaEm: p.criadaEm,
    versao: p.versao,
  };
}
function prontuarioLido(
  p: ProntuarioRevisaoRegistrado,
  pendencias: readonly PendenciaRevisaoRegistrada[],
  hoje: string,
): ProntuarioRevisaoLido {
  const situacao = p.situacao as SituacaoRevisaoProntuario;
  const minhas = pendencias.filter((x) => x.prontuario === p.id).map((x) => pendenciaLida(x, hoje));
  return {
    id: p.id,
    ordem: p.ordem,
    reg: p.reg,
    alta: p.alta,
    clinica: p.clinica,
    medico: p.medicoNome,
    situacao,
    respostas: respostasDe(p.respostas),
    observacao: p.observacao,
    revisadoPor: p.revisadoPor,
    revisadoEm: p.revisadoEm,
    avalPor: p.avalPor,
    avalEm: p.avalEm,
    podeAval:
      recusaAval({
        situacao,
        avalEm: p.avalEm,
        pendenciasAbertas: minhas.filter((x) => x.situacao === 'aberta').length,
      }) === null,
    pendencias: minhas,
    versao: p.versao,
  };
}

@Controller()
export class RevisaoProntuarioController {
  private readonly apoio: ApoioGravacao<GravadorGestao>;

  constructor(
    @Inject(PORTA_GESTAO) private readonly porta: PortaGestao,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
    @Optional()
    @Inject(CENTRAL_AVISOS_QUALIDADE)
    private readonly central: CentralAvisosQualidade | null = null,
  ) {
    this.apoio = new ApoioGravacao(
      { chave: CHAVE_QUALIDADE_GESTAO, nome: 'a gestão da qualidade', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  private agora(s: SessaoCadastro): Promise<string> {
    return this.porta.relogio(s.porta);
  }

  private async reautenticado(req: RequisicaoAutorizada, b: unknown): Promise<unknown> {
    const { senha, ...resto } = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
    if (!this.resolvedor)
      throw new ErroProblema(
        'reautenticacao-necessaria',
        401,
        'Confirme a senha',
        'Entre com o seu usuário.',
      );
    await reautenticar(this.sessoes, this.resolvedor, req, typeof senha === 'string' ? senha : undefined);
    return { ...resto, senha: '-' };
  }

  /** A comissão do tipo 'prontuario' e ativa (a revisão só existe sobre ela). */
  private async comissaoDeProntuario(s: SessaoCadastro, id: number) {
    const c = await this.porta.comissao(s.porta, id);
    if (!c) throw naoEncontrado('Comissão');
    if (c.tipo !== 'prontuario') throw recusaRevisaoHttp('comissao-nao-e-de-prontuario');
    if (!c.ativa) throw recusaRevisaoHttp('comissao-inativa');
    return c;
  }

  private async prazoPendencia(s: SessaoCadastro): Promise<number> {
    const ler = await this.apoio.resolvedorParametros(s);
    const n = Number(ler(PARAMETRO_PRAZO_PENDENCIA_REVISAO, null));
    return Number.isInteger(n) && n >= 1 ? n : PRAZO_PENDENCIA_REVISAO_DIAS;
  }

  // ── Comissões e checklist ─────────────────────────────────────────────────────────────────────────────────────

  @Get(`${B}/comissoes`)
  @Permissao(P.revisaoProntuarioLer)
  async comissoes(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const [cs, l] = await Promise.all([this.porta.comissoes(s.porta), this.apoio.liberacao(s)]);
    return {
      itens: cs
        .filter((c) => c.tipo === 'prontuario')
        .map((c) => ({ id: c.id, nome: c.nome, ativa: c.ativa })),
      sugerido: CHECKLIST_REVISAO_SUGERIDO,
      tetoAmostra: TETO_AMOSTRA_REVISAO,
      ligada: l.ligada,
      motivo: l.motivo,
      podeRegistrar: l.ligada && s.pode(P.revisaoProntuarioRegistrar),
    };
  }

  @Get(`${B}/checklists`)
  @Permissao(P.revisaoProntuarioLer)
  async checklists(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const f = corpo(esquemaFiltroSorteiosRevisao, q);
    return { itens: (await this.porta.checklistsRevisao(s.porta, f.comissao)).map(checklistLido) };
  }

  @Post(`${B}/checklists`)
  @Permissao(P.revisaoProntuarioRegistrar)
  @AuditadoNoHandler(
    'qualidade.publicarChecklistRevisao: modelo_checklist_qualidade_versao (a vigente vira substituída) e a trilha_auditoria',
  )
  async publicarChecklist(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaPublicarChecklistRevisao, b);
    await this.apoio.exigirLiberacao(s);
    await this.comissaoDeProntuario(s, e.comissao);
    const vig = (await this.porta.checklistsRevisao(s.porta, e.comissao)).find(
      (c) => c.situacao === 'vigente',
    );
    recusar(
      recusaPublicacaoChecklist({
        vigente: vig ? { id: vig.id, versao: vig.versao } : null,
        lido: e.vigente,
        motivo: e.motivo,
      }),
    );
    const agora = await this.agora(s);
    return this.apoio.sgh(
      s,
      E.qualidadeRevisaoChecklistPublicado.codigo,
      P.revisaoProntuarioRegistrar,
      (r: { id: number }) => ({ tabela: 'modelo_checklist_qualidade_versao', id: String(r.id) }),
      (g) =>
        g.publicarChecklistRevisao({
          comissao: e.comissao,
          itens: JSON.stringify(e.itens),
          motivo: e.motivo,
          vigente: e.vigente,
          agora,
          usuario: s.login,
        }),
    );
  }

  @Post(`${B}/checklists/:id/inativacao`)
  @Permissao(P.revisaoProntuarioRegistrar)
  @AuditadoNoHandler(
    'qualidade.inativarChecklistRevisao: modelo_checklist_qualidade_versao (inativação com motivo) e a trilha_auditoria',
  )
  async inativarChecklist(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaInativarChecklistRevisao, b);
    await this.apoio.exigirLiberacao(s);
    const c = await this.porta.checklistRevisao(s.porta, idDaRota(id));
    if (!c) throw naoEncontrado('Checklist');
    const agora = await this.agora(s);
    return this.apoio.sgh(
      s,
      E.qualidadeRegistroCancelado.codigo,
      P.revisaoProntuarioRegistrar,
      { tabela: 'modelo_checklist_qualidade_versao', id: String(c.id) },
      (g) =>
        g.inativarChecklistRevisao({
          id: c.id,
          versao: e.versao,
          motivo: e.justificativa,
          agora,
          usuario: s.login,
        }),
    );
  }

  // ── Sorteio ──────────────────────────────────────────────────────────────────────────────────────────────────

  private async universo(s: SessaoCadastro, competencia: string) {
    const { de, ate } = diasDaCompetenciaQualidade(competencia);
    return this.porta.altasParaRevisao(s.porta, de, somarDiasData(ate, 1));
  }

  @Get(`${B}/altas`)
  @Permissao(P.revisaoProntuarioLer)
  async altas(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const f = corpo(esquemaFiltroCompetenciaQualidade, q);
    const u = await this.universo(s, f.competencia);
    const porClinica = new Map<string, number>();
    for (const a of u.itens) porClinica.set(a.clinica, (porClinica.get(a.clinica) ?? 0) + 1);
    return {
      competencia: f.competencia,
      universo: u.itens.length,
      cortada: u.cortada,
      sugerida: amostraSugerida(u.itens.length, TETO_AMOSTRA_REVISAO),
      porClinica: [...porClinica].map(([clinica, altas]) => ({ clinica, altas })),
    };
  }

  @Get(`${B}/sorteios`)
  @Permissao(P.revisaoProntuarioLer)
  async sorteios(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ itens: SorteioRevisaoLido[] }> {
    const s = sessaoDe(req);
    const f = corpo(esquemaFiltroSorteiosRevisao, q);
    return { itens: await this.porta.sorteiosRevisao(s.porta, f.comissao) };
  }

  @Post(`${B}/sorteios`)
  @Permissao(P.revisaoProntuarioRegistrar)
  @AuditadoNoHandler(
    'qualidade.sortearRevisao: sorteio_revisao_prontuario (semente e resumo do universo) e revisao_prontuario, e a trilha_auditoria',
  )
  async sortear(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaSortearRevisao, b);
    await this.apoio.exigirLiberacao(s);
    await this.comissaoDeProntuario(s, e.comissao);
    const agora = await this.agora(s);
    if (!competenciaFechada(e.competencia, agora)) throw recusaRevisaoHttp('competencia-aberta');
    const vig = (await this.porta.checklistsRevisao(s.porta, e.comissao)).find(
      (c) => c.situacao === 'vigente',
    );
    if (!vig) throw recusaRevisaoHttp('checklist-ausente');
    const u = await this.universo(s, e.competencia);
    // Revisão do W0-04: o universo cortado pelo teto da leitura deixaria altas de fora da amostra sem aviso.
    if (u.cortada) throw recusaRevisaoHttp('universo-cortado');
    if (!u.itens.length) throw recusaRevisaoHttp('sem-altas');
    if (e.quantidade > u.itens.length) throw recusaRevisaoHttp('amostra-maior-que-universo');
    const semente = e.semente ?? sementeGerada(e.competencia, randomInt(1, 2 ** 40) / 2 ** 40);
    const amostra = sortearAmostra(u.itens, semente, e.quantidade);
    const r = await this.apoio.sgh(
      s,
      E.qualidadeRevisaoSorteada.codigo,
      P.revisaoProntuarioRegistrar,
      (x: { id: number }) => ({ tabela: 'sorteio_revisao_prontuario', id: String(x.id) }),
      (g) =>
        g.sortearRevisao({
          comissao: e.comissao,
          checklist: vig.id,
          competencia: e.competencia,
          semente,
          universo: u.itens.length,
          resumoUniverso: sha256(universoCanonico(u.itens.map((a) => a.reg))),
          amostra,
          agora,
          usuario: s.login,
        }),
    );
    return { ...r, semente, quantidade: amostra.length, universo: u.itens.length };
  }

  @Get(`${B}/sorteios/:id`)
  @Permissao(P.revisaoProntuarioLer)
  async sorteio(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const so = await this.porta.sorteioRevisao(s.porta, idDaRota(id));
    if (!so) throw naoEncontrado('Sorteio');
    const [ps, chk, agora, l] = await Promise.all([
      this.porta.prontuariosDoSorteio(s.porta, so.id),
      this.porta.checklistRevisao(s.porta, so.checklist),
      this.agora(s),
      this.apoio.liberacao(s),
    ]);
    const pend = await this.porta.pendenciasDosProntuarios(
      s.porta,
      ps.map((p) => p.id),
    );
    const hoje = agora.slice(0, 10);
    return {
      sorteio: so,
      checklist: chk ? checklistLido(chk) : null,
      prontuarios: ps.map((p) => prontuarioLido(p, pend, hoje)),
      podeRegistrar: l.ligada && s.pode(P.revisaoProntuarioRegistrar),
    };
  }

  /** Refaz o sorteio com a semente registrada sobre as altas de hoje e compara (a prova da reprodução). */
  @Get(`${B}/sorteios/:id/conferencia`)
  @Permissao(P.revisaoProntuarioLer)
  async conferir(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const so = await this.porta.sorteioRevisao(s.porta, idDaRota(id));
    if (!so) throw naoEncontrado('Sorteio');
    const [u, ps] = await Promise.all([
      this.universo(s, so.competencia),
      this.porta.prontuariosDoSorteio(s.porta, so.id),
    ]);
    const resumo = sha256(universoCanonico(u.itens.map((a) => a.reg)));
    const refeito = sortearAmostra(u.itens, so.semente, so.quantidade).map((a) => a.reg);
    const gravado = ps.map((p) => p.reg);
    return {
      semente: so.semente,
      universoIgual: resumo === so.resumoUniverso,
      amostraIgual: refeito.length === gravado.length && refeito.every((r, i) => r === gravado[i]),
      universo: u.itens.length,
      universoNoSorteio: so.universo,
      // Revisão do W0-04: a leitura de hoje cortada pelo teto não prova a reprodução (a tela avisa).
      cortada: u.cortada,
    };
  }

  @Post(`${B}/sorteios/:id/cancelamento`)
  @Permissao(P.revisaoProntuarioRegistrar)
  @AuditadoNoHandler(
    'qualidade.cancelarSorteioRevisao: sorteio_revisao_prontuario (cancelamento lógico; retrato na trilha_auditoria) e a trilha_auditoria',
  )
  async cancelarSorteio(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaCancelarSorteioRevisao, await this.reautenticado(req, b));
    await this.apoio.exigirLiberacao(s);
    const so = await this.porta.sorteioRevisao(s.porta, idDaRota(id));
    if (!so) throw naoEncontrado('Sorteio');
    const problema = recusaCancelamentoSorteio(so);
    if (problema === 'sorteio-com-revisao') {
      const ds = await this.porta.dependentes(s.porta, 'sorteio_revisao_prontuario', so.id);
      throw recusaRevisaoHttp(
        problema,
        ds.map((d) => `${d.grupo} (${String(d.quantidade)}): nº ${d.ids.join(', nº ')}.`),
      );
    }
    recusar(problema);
    const agora = await this.agora(s);
    return this.apoio.sgh(
      s,
      E.qualidadeRegistroCancelado.codigo,
      P.revisaoProntuarioRegistrar,
      { tabela: 'sorteio_revisao_prontuario', id: String(so.id) },
      (g) =>
        g.cancelarSorteioRevisao({
          id: so.id,
          versao: e.versao,
          motivo: e.justificativa,
          agora,
          usuario: s.login,
        }),
    );
  }

  // ── Revisão, aval e indicador ─────────────────────────────────────────────────────────────────────────────────

  @Post(`${B}/prontuarios/:id/revisao`)
  @Permissao(P.revisaoProntuarioRegistrar)
  @AuditadoNoHandler(
    'qualidade.revisarProntuario: revisao_prontuario (correção com retrato na trilha_auditoria) e pendencia_prontuario, e a trilha_auditoria',
  )
  async revisar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRevisarProntuario, b);
    await this.apoio.exigirLiberacao(s);
    const p = await this.porta.prontuarioRevisao(s.porta, idDaRota(id));
    if (!p) throw naoEncontrado('Prontuário da revisão');
    const so = await this.porta.sorteioRevisao(s.porta, p.sorteio);
    if (!so) throw naoEncontrado('Sorteio');
    recusar(
      recusaRevisao({
        situacaoAtual: p.situacao as SituacaoRevisaoProntuario,
        avalEm: p.avalEm,
        justificativa: e.justificativa,
        sorteioCancelado: so.canceladoEm !== null,
      }),
    );
    const chk = await this.porta.checklistRevisao(s.porta, so.checklist);
    const av = avaliarRevisao(chk ? itensDe(chk.itens) : [], e.respostas);
    if (!av.ok) throw recusaRevisaoHttp(av.motivo);
    const [agora, prazoDias, logins] = await Promise.all([
      this.agora(s),
      this.prazoPendencia(s),
      p.medicoRegistro
        ? this.porta.loginsDosMedicos(s.porta, [p.medicoRegistro])
        : Promise.resolve(new Map()),
    ]);
    const prazo = somarDiasData(agora.slice(0, 10), prazoDias);
    const corrigindo = p.situacao !== 'aRevisar';
    const login = (p.medicoRegistro && (logins.get(p.medicoRegistro) as string | undefined)) || null;
    const r = await this.apoio.sgh(
      s,
      corrigindo ? E.qualidadeRegistroCorrigido.codigo : E.qualidadeRevisaoRegistrada.codigo,
      P.revisaoProntuarioRegistrar,
      { tabela: 'revisao_prontuario', id: String(p.id) },
      (g) =>
        g.revisarProntuario({
          id: p.id,
          versao: e.versao,
          situacao: av.avaliacao.situacao,
          respostas: JSON.stringify(e.respostas),
          observacao: e.observacao,
          justificativa: corrigindo ? e.justificativa : null,
          pendencias: av.avaliacao.naoConformes.map((n) => ({
            item: n.item,
            descricao: descricaoPendencia(n.titulo, n.observacao),
            prazo,
          })),
          profissional: { registro: p.medicoRegistro, login, nome: p.medicoNome },
          agora,
          usuario: s.login,
        }),
    );
    // Revisão do W0-04: a pendência aberta (ou reaberta) chega ao médico pela central de avisos, com o link para
    // "Minhas pendências de prontuário". O médico sem usuário não recebe: a resposta e a tela da comissão sinalizam a
    // pendência sem destinatário.
    const comPendencia = av.avaliacao.naoConformes.length > 0;
    const avisado =
      comPendencia &&
      (await avisarPendenciaNaCentral(
        this.central,
        s.porta,
        {
          login: s.login,
          estacao: estacaoDaRequisicao(s.req).slice(0, 80),
          correlacao: correlacaoDaRequisicao(s.req, 'qualidade.pendenciaProntuario'),
        },
        { login, prontuario: p.id, versao: r.versao },
      ));
    return { ...r, avisado, semDestinatario: comPendencia && login === null };
  }

  @Post(`${B}/prontuarios/:id/aval`)
  @Permissao(P.revisaoProntuarioRegistrar)
  @AuditadoNoHandler('qualidade.avalRevisao: revisao_prontuario (aval da comissão) e a trilha_auditoria')
  async aval(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaAvalRevisao, await this.reautenticado(req, b));
    await this.apoio.exigirLiberacao(s);
    const p = await this.porta.prontuarioRevisao(s.porta, idDaRota(id));
    if (!p) throw naoEncontrado('Prontuário da revisão');
    const pend = await this.porta.pendenciasDosProntuarios(s.porta, [p.id]);
    const abertas = pend.filter((x) => x.situacao === 'aberta');
    const problema = recusaAval({
      situacao: p.situacao as SituacaoRevisaoProntuario,
      avalEm: p.avalEm,
      pendenciasAbertas: abertas.length,
    });
    if (problema === 'pendencia-aberta')
      throw recusaRevisaoHttp(problema, [
        `Pendências abertas (${String(abertas.length)}): nº ${abertas.map((x) => x.id).join(', nº ')}.`,
      ]);
    recusar(problema);
    const agora = await this.agora(s);
    return this.apoio.sgh(
      s,
      E.qualidadeRevisaoAval.codigo,
      P.revisaoProntuarioRegistrar,
      { tabela: 'revisao_prontuario', id: String(p.id) },
      (g) => g.avalRevisao({ id: p.id, versao: e.versao, agora, usuario: s.login }),
    );
  }

  @Get(`${B}/indicador`)
  @Permissao(P.revisaoProntuarioLer)
  async indicador(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<IndicadorRevisaoProntuario> {
    const s = sessaoDe(req);
    const f = corpo(esquemaFiltroIndicadorRevisao, q);
    const [rs, agora] = await Promise.all([
      this.porta.revisoesDaCompetencia(s.porta, f.comissao, f.competencia),
      this.agora(s),
    ]);
    const pend = await this.porta.pendenciasDosProntuarios(
      s.porta,
      rs.map((r) => r.id),
    );
    const hoje = agora.slice(0, 10);
    const abertas = pend.filter((p) => p.situacao === 'aberta');
    return {
      competencia: f.competencia,
      ...conformidadePorClinica(
        rs.map((r) => ({ clinica: r.clinica, situacao: r.situacao as SituacaoRevisaoProntuario })),
      ),
      pendenciasAbertas: abertas.length,
      pendenciasVencidas: abertas.filter((p) => p.prazo < hoje).length,
    };
  }

  // ── Pendências do profissional ────────────────────────────────────────────────────────────────────────────────

  @Get(`${B}/minhas-pendencias`)
  @Permissao(P.revisaoPendenciaResponder)
  async minhasPendencias(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const [ps, agora] = await Promise.all([this.porta.pendenciasDoLogin(s.porta, s.login), this.agora(s)]);
    return { itens: ps.map((p) => pendenciaLida(p, agora.slice(0, 10))) };
  }

  @Post(`${B}/pendencias/:id/resposta`)
  @Permissao(P.revisaoPendenciaResponder)
  @AuditadoNoHandler('qualidade.responderPendenciaRevisao: pendencia_prontuario (resposta) e a trilha_auditoria')
  async responder(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaResponderPendenciaRevisao, b);
    await this.apoio.exigirLiberacao(s);
    const p = await this.porta.pendenciaRevisao(s.porta, idDaRota(id));
    if (!p) throw naoEncontrado('Pendência');
    recusar(
      recusaRespostaPendencia({
        situacao: p.situacao,
        profissionalLogin: p.profissionalLogin,
        login: s.login,
      }),
    );
    const agora = await this.agora(s);
    return this.apoio.sgh(
      s,
      E.qualidadeRevisaoPendenciaRespondida.codigo,
      P.revisaoPendenciaResponder,
      { tabela: 'pendencia_prontuario', id: String(p.id) },
      (g) =>
        g.responderPendenciaRevisao({
          id: p.id,
          versao: e.versao,
          resposta: e.resposta,
          agora,
          usuario: s.login,
        }),
    );
  }

  @Post(`${B}/pendencias/:id/cancelamento`)
  @Permissao(P.revisaoProntuarioRegistrar)
  @AuditadoNoHandler(
    'qualidade.cancelarPendenciaRevisao: pendencia_prontuario (cancelamento lógico; retrato na trilha_auditoria) e a trilha_auditoria',
  )
  async cancelarPendencia(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaCancelarPendenciaRevisao, b);
    await this.apoio.exigirLiberacao(s);
    const p = await this.porta.pendenciaRevisao(s.porta, idDaRota(id));
    if (!p) throw naoEncontrado('Pendência');
    if (p.situacao !== 'aberta') throw recusaRevisaoHttp('pendencia-encerrada');
    const agora = await this.agora(s);
    return this.apoio.sgh(
      s,
      E.qualidadeRegistroCancelado.codigo,
      P.revisaoProntuarioRegistrar,
      { tabela: 'pendencia_prontuario', id: String(p.id) },
      (g) =>
        g.cancelarPendenciaRevisao({
          id: p.id,
          versao: e.versao,
          motivo: e.justificativa,
          agora,
          usuario: s.login,
        }),
    );
  }

  /** As versões anteriores (inativas) da revisão, do sorteio e da pendência. */
  @Get(`${B}/versoes/:registro/:id`)
  @Permissao(P.revisaoProntuarioLer)
  async versoes(
    @Param('registro') registro: string,
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const tabela = TABELA_DO_REGISTRO[registro as RegistroVersionadoQualidade];
    if (
      !tabela ||
      !['revisao-prontuario', 'sorteio-revisao', 'pendencia-revisao', 'checklist-revisao'].includes(registro)
    )
      throw naoEncontrado('Registro');
    return { itens: await this.porta.versoes(s.porta, tabela, idDaRota(id)) };
  }

  // ── SAME ─────────────────────────────────────────────────────────────────────────────────────────────────────

  /** O aval da comissão pelo número da internação (o SAME confere antes do arquivamento e do descarte). */
  @Get(`${B}/aval`)
  @Permissao(P.revisaoAvalLer)
  async avalDaInternacao(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<AvalRevisaoProntuario> {
    const s = sessaoDe(req);
    const f = corpo(esquemaConsultaAvalRevisao, q);
    const rs = await this.porta.revisoesDaInternacao(s.porta, f.reg);
    const r = rs[0];
    if (!r)
      return {
        reg: f.reg,
        revisado: false,
        situacao: null,
        avalEm: null,
        avalPor: null,
        pendenciasAbertas: 0,
        texto: null,
      };
    const pend = await this.porta.pendenciasDosProntuarios(s.porta, [r.id]);
    return {
      reg: f.reg,
      revisado: r.situacao !== 'aRevisar',
      situacao: r.situacao as SituacaoRevisaoProntuario,
      avalEm: r.avalEm,
      avalPor: r.avalPor,
      pendenciasAbertas: pend.filter((p) => p.situacao === 'aberta').length,
      texto: r.avalEm && r.avalPor ? textoDoAval(r.avalEm, r.avalPor) : null,
    };
  }
}
