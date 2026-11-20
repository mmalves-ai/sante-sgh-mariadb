// Segurança do paciente, etapa 2 do M48 (ficha, seções 4, 5, 7 e 8; ADR 0031):
//   GET  /api/qualidade/analises                          as notificações em análise que a sessão vê (NSP: todas as
//                                                         distribuídas, em análise e concluídas; gestor: as dele)
//   GET  /api/qualidade/analises/:id                      a notificação (sem o notificador para o gestor), a análise e
//                                                         o plano 5W2H com o resumo
//   POST /api/qualidade/analises/:id                      qualidade.registrarAnalise (inicia, atualiza, conclui)
//   POST /api/qualidade/analises/:id/acoes                qualidade.registrarPlanoAcao (incluir, alterar, situação,
//                                                         eficácia)
//   GET  /api/qualidade/acoes/minhas                      as ações abertas de que a sessão é a responsável
//   GET  /api/qualidade/acoes/responsaveis?busca=         a busca do responsável da ação (contas ativas)
//   GET  /api/qualidade/sugestoes                         as sugestões automáticas de notificação da sessão (regra 4)
//   POST /api/qualidade/sugestoes/dispensar               a sugestão dispensada (só o resumo; regra 1)
//   GET  /api/qualidade/tecnovigilancia                   a lista da vigilância de produto
//   GET  /api/qualidade/tecnovigilancia/itens?busca=      a busca de produtos do cadastro
//   GET  /api/qualidade/tecnovigilancia/:id               o registro com o andamento
//   GET  /api/qualidade/tecnovigilancia/:id/expostos      os pacientes expostos ao lote (evento de auditoria)
//   POST /api/qualidade/tecnovigilancia                   qualidade.registrarQueixaTecnica (abrir)
//   POST /api/qualidade/tecnovigilancia/:id/andamento     qualidade.registrarQueixaTecnica (andamento)
//   GET  /api/qualidade/nsp/painel?de=&ate=               o painel do plano de segurança do paciente (agregados)
// Tudo pela chave `qualidade.notificacao` (POL-3; D-CHAVE-48.2). Regra 1: o gestor nunca vê quem notificou (a projeção
// do papel gestor); a sugestão resolvida não guarda a origem nem o login; a notificação anônima vinda de sugestão
// guarda só a fonte. Regra 11: a trilha leva só os IDs (nunca o paciente, nunca a origem da sugestão).
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  esquemaDispensarSugestao,
  esquemaPeriodoPainel,
  esquemaRegistrarAnalise,
  esquemaRegistrarPlanoAcao,
  esquemaRegistrarQueixaTecnica,
  EVENTOS_AUDITAVEIS,
  PERMISSOES_QUALIDADE as P,
  type SituacaoAcao,
  type SituacaoNotificacao,
  type SituacaoVigilanciaProduto,
  TETO_PROTOCOLOS_DO_PERIODO,
} from '@sgh/contratos';
import {
  acoesAtivas,
  calculaExpostos,
  conferirAberturaVigilancia,
  conferirAcaoNova,
  conferirAlteracaoAcao,
  conferirAnalise,
  conferirAndamentoVigilancia,
  conferirEficacia,
  conferirSituacaoAcao,
  DIAS_JANELA_SUGESTAO,
  lerOrigem,
  MENSAGENS_RECUSA_ANALISE,
  MENSAGENS_RECUSA_VIGILANCIA,
  periodoDoPainel,
  podeAnalisar,
  projetarNotificacao,
  type RecusaAnalise,
  type RecusaVigilanciaProduto,
  resumoDoPlano,
  sugestoesDoUsuario,
} from '@sgh/dominio-qualidade';
import type { AcaoPlanoSghLida, NotificacaoSghLida } from '@sgh/legado';
import { Auditar, AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ApoioGravacao, corpo } from '../exames/public-api.js';
import { CHAVE_QUALIDADE_NOTIFICACAO } from './notificacao.controller.js';
import { type GravadorQualidade, PORTA_QUALIDADE, type PortaQualidade } from './porta.js';
import { anosDosPrazos, calendario, detalheDe, resumoDe } from './servico.js';
import {
  acaoLida,
  adesaoProtocolosGerenciados,
  analiseLida,
  montarPainel,
  MOTIVO_SUGESTAO_SEM_CHAVE,
  queixaLida,
  RESUMO_SUGESTAO,
  type ResumoSugestao,
} from './servico-seguranca.js';

const E = EVENTOS_AUDITAVEIS;
const POR_PAGINA = 50;
const SITUACOES_EM_ANALISE: readonly SituacaoNotificacao[] = ['distribuida', 'emAnalise', 'concluida'];

const recusaAnalise = (motivo: RecusaAnalise) =>
  new ErroProblema('recusa-de-negocio', 409, 'Análise e plano de ação', MENSAGENS_RECUSA_ANALISE[motivo], {
    codigo: motivo,
    bloqueios: [motivo],
  });
const recusaVigilancia = (motivo: RecusaVigilanciaProduto) =>
  new ErroProblema('recusa-de-negocio', 409, 'Vigilância de produto', MENSAGENS_RECUSA_VIGILANCIA[motivo], {
    codigo: motivo,
    bloqueios: [motivo],
  });
const entrada = (titulo: string, detalhe: string, campos: readonly string[], codigo = 'entrada-invalida') =>
  new ErroProblema('entrada-invalida', 422, titulo, detalhe, { codigo, campos: [...campos] });
const naoEncontrada = () => new ErroProblema('nao-encontrado', 404, 'Notificação não encontrada');
const registroNaoEncontrado = () => new ErroProblema('nao-encontrado', 404, 'Registro não encontrado');

const somaDias = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const pagina = (v: string | undefined) => Math.max(1, Math.min(10_000, Number.parseInt(v ?? '1', 10) || 1));
const estadoAcao = (a: AcaoPlanoSghLida) => ({
  situacao: a.situacao as SituacaoAcao,
  versao: a.versao,
  quando: a.quando,
  eficacia: a.eficacia as never,
});

@Controller('qualidade')
export class SegurancaPacienteController {
  private readonly apoio: ApoioGravacao<GravadorQualidade>;

  constructor(
    @Inject(PORTA_QUALIDADE) private readonly porta: PortaQualidade,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(RESUMO_SUGESTAO) private readonly resumoSugestao: ResumoSugestao | null = null,
  ) {
    this.apoio = new ApoioGravacao(
      { chave: CHAVE_QUALIDADE_NOTIFICACAO, nome: 'a segurança do paciente', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  private agora(s: SessaoCadastro): Promise<string> {
    return this.porta.relogio(s.porta);
  }

  /** NSP é quem lê as notificações (perfil do núcleo); o gestor da área vê só as distribuídas a ele. */
  private quem(s: SessaoCadastro) {
    return { nsp: s.pode(P.notificacaoLer), login: s.login };
  }

  /** A sessão pode ver a notificação: quem lê as notificações (NSP) ou o gestor a quem ela foi distribuída. */
  private veNotificacao(s: SessaoCadastro, n: NotificacaoSghLida | null): n is NotificacaoSghLida {
    if (!n) return false;
    return (
      s.pode(P.notificacaoLer) ||
      podeAnalisar({ situacao: n.situacao as SituacaoNotificacao, gestor: n.gestor }, this.quem(s))
    );
  }

  /** A notificação que a sessão pode analisar (senão, a mesma resposta de "não existe": não revela que existe). */
  private async notificacaoDaAnalise(s: SessaoCadastro, id: number): Promise<NotificacaoSghLida> {
    const n = await this.porta.notificacao(s.porta, id);
    if (!n || !podeAnalisar({ situacao: n.situacao as SituacaoNotificacao, gestor: n.gestor }, this.quem(s)))
      throw naoEncontrada();
    return n;
  }

  private async feriados(s: SessaoCadastro, anos: readonly number[]) {
    const de = `${String(Math.min(...anos))}-01-01`;
    const ate = `${String(Math.max(...anos))}-12-31`;
    return calendario(await this.porta.feriados(s.porta, de, ate), anos);
  }

  private async nomes(s: SessaoCadastro): Promise<(c: number | null) => string | null> {
    const us = await this.porta.unidades(s.porta).catch(() => []);
    const m = new Map(us.map((u) => [u.codigo, u.nome]));
    return (c) => (c === null ? null : (m.get(c) ?? `Unidade ${String(c)}`));
  }

  // ── Análise e plano de ação ───────────────────────────────────────────────────────────────────────

  @Get('analises')
  @Permissao(P.analiseLer)
  @Auditar(E.qualidadeNotificacaoLida.codigo)
  async analises(
    @Query('situacao') situacao: string | undefined,
    @Query('pagina') pg: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const q = this.quem(s);
    const sit = SITUACOES_EM_ANALISE.includes(situacao as SituacaoNotificacao)
      ? (situacao as SituacaoNotificacao)
      : undefined;
    const p = pagina(pg);
    const agora = await this.agora(s);
    // NSP: por situação (sem filtro, as três situações da análise, no banco: a página e o "tem mais" já saem filtrados);
    // gestor: as distribuídas a ele, pelo índice, nas mesmas situações.
    const r = await this.porta.lista(s.porta, {
      situacoes: sit ? [sit] : SITUACOES_EM_ANALISE,
      ...(q.nsp ? {} : { gestor: s.login }),
      pagina: p,
      porPagina: POR_PAGINA,
    });
    const visiveis = r.itens.filter((n) =>
      podeAnalisar({ situacao: n.situacao as SituacaoNotificacao, gestor: n.gestor }, q),
    );
    const [feriados, nomes] = await Promise.all([
      this.feriados(s, anosDosPrazos(visiveis, agora)),
      this.nomes(s),
    ]);
    req.sghAlvo = { tabelaAlvo: 'SGH_QUA_ANALISE', chaveNaturalAlvo: `analises:${String(visiveis.length)}` };
    return {
      itens: visiveis.map((n) => ({
        ...resumoDe(n, agora, feriados, nomes),
        prazoAnalise: n.prazoAnalise,
        analiseConcluidaEm: n.analiseConcluidaEm,
      })),
      temMais: r.temMais,
      pagina: p,
      agora,
    };
  }

  @Get('analises/:id')
  @Permissao(P.analiseLer)
  @Auditar(E.qualidadeNotificacaoLida.codigo)
  async analise(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = await this.notificacaoDaAnalise(s, idDaRota(id));
    const agora = await this.agora(s);
    const hoje = agora.slice(0, 10);
    const q = this.quem(s);
    const [eventos, contexto, feriados, nomes, analise, acoes, l] = await Promise.all([
      this.porta.eventos(s.porta, n.id),
      n.atendimento !== null ? this.porta.contexto(s.porta, n.atendimento) : Promise.resolve(null),
      this.feriados(s, anosDosPrazos([n], agora)),
      this.nomes(s),
      this.porta.analise(s.porta, n.id),
      this.porta.acoes(s.porta, n.id),
      this.apoio.liberacao(s),
    ]);
    const d = projetarNotificacao(
      detalheDe(n, eventos, contexto, agora, feriados, nomes),
      q.nsp ? { papel: 'nsp' } : { papel: 'gestor', login: s.login },
    );
    if (!d) throw naoEncontrada();
    req.sghAlvo = { tabelaAlvo: 'SGH_QUA_ANALISE', idAlvo: String(n.id), chaveNaturalAlvo: n.protocolo };
    const lidas = acoes.map((a) => acaoLida(a, hoje));
    const registrar = l.ligada && s.pode(P.analiseRegistrar);
    return {
      notificacao: d,
      prazoAnalise: n.prazoAnalise,
      analise: analise ? analiseLida(analise) : null,
      acoes: lidas,
      plano: resumoDoPlano(lidas, hoje),
      agora,
      gravacao: {
        ligada: l.ligada,
        motivo: l.motivo,
        acoes: {
          analisar: registrar && analise?.situacao !== 'concluida' && n.situacao !== 'concluida',
          planejar: registrar,
        },
      },
    };
  }

  @Post('analises/:id')
  @HttpCode(200)
  @Permissao(P.analiseRegistrar)
  @AuditadoNoHandler(
    'qualidade.registrarAnalise: SGH_QUA_ANALISE, a situação da notificação e a linha do tempo com a SGH_TRILHA',
  )
  async registrarAnalise(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarAnalise, { ...(b as object), notificacao: idDaRota(id) });
    await this.apoio.exigirLiberacao(s);
    const n = await this.notificacaoDaAnalise(s, e.notificacao);
    const agora = await this.agora(s);
    const q = this.quem(s);
    const r = await this.apoio.sgh(
      s,
      E.qualidadeAnaliseRegistrada.codigo,
      P.analiseRegistrar,
      { tabela: 'SGH_QUA_ANALISE', id: String(n.id), chave: n.protocolo },
      async (g) => {
        const atualN = await g.travar(n.id);
        if (!podeAnalisar({ situacao: atualN.situacao as SituacaoNotificacao, gestor: atualN.gestor }, q))
          throw naoEncontrada();
        const atual = await g.travarAnalise(n.id);
        const acoes = await g.acoesNaTransacao(n.id);
        const c = conferirAnalise(
          { situacao: atualN.situacao as SituacaoNotificacao },
          atual ? { situacao: atual.situacao as 'rascunho' | 'concluida', versao: atual.versao } : null,
          e,
          acoesAtivas(acoes.map((a) => ({ situacao: a.situacao as SituacaoAcao }))),
        );
        if (!c.ok) throw recusaAnalise(c.motivo);
        return g.registrarAnalise({
          notificacao: n.id,
          versaoNotificacao: atualN.versao,
          atual: atual ? { id: atual.id, versao: atual.versao } : null,
          metodo: e.conteudo.metodo,
          conteudo: JSON.stringify(e.conteudo),
          causaRaiz: c.valor.causaRaiz,
          fatores: c.valor.fatores,
          licoes: e.licoes,
          semAcaoJustificativa: e.semAcaoJustificativa,
          concluir: e.concluir,
          eventos: c.valor.eventos as ('analiseIniciada' | 'analiseConcluida')[],
          situacaoNotificacao: c.valor.situacaoNotificacao,
          usuario: s.login,
          agora,
        });
      },
    );
    return {
      ok: true,
      id: r.id,
      versao: r.versao,
      mensagem: e.concluir ? 'Análise concluída.' : 'Análise gravada.',
    };
  }

  @Post('analises/:id/acoes')
  @HttpCode(200)
  @Permissao(P.analiseRegistrar)
  @AuditadoNoHandler('qualidade.registrarPlanoAcao: SGH_QUA_PLANO_ACAO com a SGH_TRILHA')
  async registrarPlanoAcao(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarPlanoAcao, { ...(b as object), notificacao: idDaRota(id) });
    await this.apoio.exigirLiberacao(s);
    const n = await this.notificacaoDaAnalise(s, e.notificacao);
    if (
      (e.tipo === 'incluir' || e.tipo === 'alterar') &&
      !(await this.porta.usuarioAtivo(s.porta, e.acao.quem))
    )
      throw entrada(
        'Plano de ação',
        'O responsável precisa ser uma conta ativa: escolha da lista.',
        ['acao.quem'],
        'responsavel-inativo',
      );
    const agora = await this.agora(s);
    const hoje = agora.slice(0, 10);
    const q = this.quem(s);
    const r = await this.apoio.sgh(
      s,
      E.qualidadePlanoAcaoRegistrado.codigo,
      P.analiseRegistrar,
      (x: { id: number }) => ({ tabela: 'SGH_QUA_PLANO_ACAO', id: String(x.id), chave: n.protocolo }),
      async (g) => {
        const atualN = await g.travar(n.id);
        if (!podeAnalisar({ situacao: atualN.situacao as SituacaoNotificacao, gestor: atualN.gestor }, q))
          throw naoEncontrada();
        const notif = { situacao: atualN.situacao as SituacaoNotificacao };
        const base = { usuario: s.login, agora };
        if (e.tipo === 'incluir') {
          const acoes = await g.acoesNaTransacao(n.id);
          const c = conferirAcaoNova(notif, e.acao, hoje, acoes.length);
          if (!c.ok) throw recusaAnalise(c.motivo);
          const x = await g.incluirAcao({ notificacao: n.id, acao: e.acao, ...base });
          return { id: x.id, versao: x.versao };
        }
        const a = await g.travarAcao(n.id, e.id);
        if (e.tipo === 'alterar') {
          const c = conferirAlteracaoAcao(
            notif,
            estadoAcao(a),
            { versao: e.versao, quando: e.acao.quando },
            hoje,
          );
          if (!c.ok) throw recusaAnalise(c.motivo);
          const x = await g.alterarAcao({ id: a.id, versao: e.versao, acao: e.acao, ...base });
          return { id: a.id, versao: x.versao };
        }
        if (e.tipo === 'situacao') {
          const c = conferirSituacaoAcao(notif, estadoAcao(a), e);
          if (!c.ok) throw recusaAnalise(c.motivo);
          const x = await g.situacaoAcao({
            id: a.id,
            versao: e.versao,
            situacao: c.valor.situacao,
            encerra: c.valor.encerra,
            texto: e.texto,
            ...base,
          });
          return { id: a.id, versao: x.versao };
        }
        const c = conferirEficacia(estadoAcao(a), e);
        if (!c.ok) throw recusaAnalise(c.motivo);
        const x = await g.eficaciaAcao({
          id: a.id,
          versao: e.versao,
          eficacia: e.eficacia,
          texto: e.texto,
          ...base,
        });
        return { id: a.id, versao: x.versao };
      },
    );
    return { ok: true, id: r.id, versao: r.versao, mensagem: 'Plano de ação atualizado.' };
  }

  /** As ações abertas de que a sessão é a responsável (quem executa a ação nem sempre analisa). */
  @Get('acoes/minhas')
  @Permissao(P.notificacaoCriar)
  async minhasAcoes(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const agora = await this.agora(s);
    const acoes = await this.porta.acoesDoResponsavel(s.porta, s.login);
    return { itens: acoes.map((a) => acaoLida(a, agora.slice(0, 10))), agora };
  }

  /** A busca do responsável da ação (contas ativas e não bloqueadas; 20 no máximo; nada com menos de 2 letras). */
  @Get('acoes/responsaveis')
  @Permissao(P.analiseRegistrar)
  async responsaveis(@Query('busca') busca: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const termo = String(busca ?? '')
      .trim()
      .slice(0, 40);
    return { itens: termo.length < 2 ? [] : await this.porta.gestores(s.porta, termo) };
  }

  // ── Sugestão automática (regra 4) ─────────────────────────────────────────────────────────────────

  @Get('sugestoes')
  @Permissao(P.notificacaoCriar)
  async sugestoes(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const [l, agora] = await Promise.all([this.apoio.liberacao(s), this.agora(s)]);
    if (!l.ligada) return { ligada: false, itens: [], agora };
    const rs = this.resumoSugestao;
    if (!rs) return { ligada: false, motivo: MOTIVO_SUGESTAO_SEM_CHAVE, itens: [], agora };
    const desde = `${somaDias(agora.slice(0, 10), -DIAS_JANELA_SUGESTAO)}T${agora.slice(11, 19)}`;
    const candidatos = await this.porta.candidatos(s.porta, s.login, desde);
    const todas = sugestoesDoUsuario(candidatos, () => false);
    const resumos = new Map(todas.map((x) => [x.origem, rs.resumo(s.hospital, s.login, x.origem)]));
    const resolvidas = await this.porta.resolvidas(s.porta, [...resumos.values()]);
    const itens = sugestoesDoUsuario(candidatos, (o) => resolvidas.has(resumos.get(o) ?? ''));
    return { ligada: true, itens, agora };
  }

  @Post('sugestoes/dispensar')
  @HttpCode(200)
  @Permissao(P.notificacaoCriar)
  @AuditadoNoHandler(
    'qualidade: sugestão dispensada (SGH_QUA_SUGESTAO_RESOLVIDA, só o resumo) com a SGH_TRILHA',
  )
  async dispensarSugestao(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaDispensarSugestao, b);
    if (!lerOrigem(e.origem)) throw entrada('Sugestão', 'A sugestão informada é inválida.', ['origem']);
    const rs = this.resumoSugestao;
    if (!rs)
      throw new ErroProblema('recusa-de-negocio', 409, 'Sugestão', MOTIVO_SUGESTAO_SEM_CHAVE, {
        codigo: 'sugestao-sem-chave',
      });
    const agora = await this.agora(s);
    const r = await this.apoio.sgh(
      s,
      E.qualidadeSugestaoDispensada.codigo,
      P.notificacaoCriar,
      { tabela: 'SGH_QUA_SUGESTAO_RESOLVIDA', chave: 'sugestao' },
      (g) =>
        g.resolverSugestao({
          resumo: rs.resumo(s.hospital, s.login, e.origem),
          dia: agora.slice(0, 10),
        }),
    );
    return { ok: true, mensagem: r.gravou ? 'Sugestão dispensada.' : 'A sugestão já tinha sido resolvida.' };
  }

  // ── Tecnovigilância e farmacovigilância ──────────────────────────────────────────────────────────

  @Get('tecnovigilancia')
  @Permissao(P.tecnovigilanciaLer)
  async queixas(
    @Query('situacao') situacao: string | undefined,
    @Query('area') area: string | undefined,
    @Query('pagina') pg: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const p = pagina(pg);
    const r = await this.porta.queixas(s.porta, {
      ...(situacao && /^[a-zA-Z]{1,16}$/.test(situacao) ? { situacao } : {}),
      ...(area && /^[a-z]{1,18}$/.test(area) ? { area } : {}),
      pagina: p,
      porPagina: POR_PAGINA,
    });
    const nomes = await this.porta.nomesDosItens(
      s.porta,
      r.itens.map((q) => q.item).filter((i): i is number => i !== null),
    );
    const l = await this.apoio.liberacao(s);
    return {
      itens: r.itens.map((q) => ({
        ...queixaLida(q),
        itemNome: q.item !== null ? (nomes.get(q.item) ?? null) : null,
      })),
      temMais: r.temMais,
      pagina: p,
      gravacao: {
        ligada: l.ligada,
        motivo: l.motivo,
        registrar: l.ligada && s.pode(P.tecnovigilanciaRegistrar),
      },
    };
  }

  @Get('tecnovigilancia/itens')
  @Permissao(P.tecnovigilanciaRegistrar)
  async itens(@Query('busca') busca: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const termo = String(busca ?? '')
      .trim()
      .slice(0, 40);
    return { itens: termo.length < 2 ? [] : await this.porta.itens(s.porta, termo) };
  }

  @Get('tecnovigilancia/:id')
  @Permissao(P.tecnovigilanciaLer)
  async queixa(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const q = await this.porta.queixa(s.porta, idDaRota(id));
    if (!q) throw registroNaoEncontrado();
    const [eventos, nomes, n, l] = await Promise.all([
      this.porta.eventosQueixa(s.porta, q.id),
      this.porta.nomesDosItens(s.porta, q.item !== null ? [q.item] : []),
      q.notificacao !== null ? this.porta.notificacao(s.porta, q.notificacao) : Promise.resolve(null),
      this.apoio.liberacao(s),
    ]);
    return {
      registro: { ...queixaLida(q), itemNome: q.item !== null ? (nomes.get(q.item) ?? null) : null },
      eventos,
      // Só o número de acompanhamento da notificação ligada (o conteúdo é do NSP, pela tela dele), e só a quem pode ver a
      // notificação.
      protocoloNotificacao: this.veNotificacao(s, n) ? (n?.protocolo ?? null) : null,
      calculaExpostos: calculaExpostos(q),
      gravacao: {
        ligada: l.ligada,
        motivo: l.motivo,
        registrar: l.ligada && s.pode(P.tecnovigilanciaRegistrar) && q.situacao !== 'encerrada',
      },
    };
  }

  @Get('tecnovigilancia/:id/expostos')
  @Permissao(P.tecnovigilanciaLer)
  @Auditar(E.qualidadeExpostosConsultados.codigo)
  async expostos(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const q = await this.porta.queixa(s.porta, idDaRota(id));
    if (!q) throw registroNaoEncontrado();
    if (!calculaExpostos(q) || q.item === null || q.lote === null)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Expostos ao lote',
        'Os expostos se calculam com o produto do cadastro e o lote informados no registro.',
        { codigo: 'sem-lote' },
      );
    const r = await this.porta.expostos(s.porta, q.item, q.lote);
    req.sghAlvo = {
      tabelaAlvo: 'SGH_QUA_TECNOVIG',
      idAlvo: String(q.id),
      chaveNaturalAlvo: `expostos:${String(r.expostos.length)}`,
    };
    return { item: q.item, itemNome: r.itemNome, lote: q.lote, expostos: r.expostos, cortada: r.cortada };
  }

  @Post('tecnovigilancia')
  @HttpCode(201)
  @Permissao(P.tecnovigilanciaRegistrar)
  @AuditadoNoHandler('qualidade.registrarQueixaTecnica: SGH_QUA_TECNOVIG e o andamento com a SGH_TRILHA')
  async abrirQueixa(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarQueixaTecnica, b);
    if (e.acao !== 'abrir')
      throw entrada('Vigilância de produto', 'Use a rota do andamento para um registro existente.', ['acao']);
    await this.apoio.exigirLiberacao(s);
    const p = conferirAberturaVigilancia(e);
    if (p) throw recusaVigilancia(p);
    // Só a notificação que a sessão pode ver (o NSP, ou o gestor a quem foi distribuída): a mesma resposta para a que
    // não existe e para a que a sessão não vê, sem revelar que existe nem ligar a queixa a ela.
    if (
      e.notificacao !== null &&
      !this.veNotificacao(s, await this.porta.notificacao(s.porta, e.notificacao))
    )
      throw entrada('Vigilância de produto', 'A notificação ligada não foi encontrada.', ['notificacao']);
    if (e.item !== null && !(await this.porta.nomesDosItens(s.porta, [e.item])).has(e.item))
      throw entrada(
        'Vigilância de produto',
        'Escolha o produto da lista do cadastro.',
        ['item'],
        'item-inexistente',
      );
    const agora = await this.agora(s);
    const r = await this.apoio.sgh(
      s,
      E.qualidadeQueixaTecnicaRegistrada.codigo,
      P.tecnovigilanciaRegistrar,
      (x: { id: number }) => ({ tabela: 'SGH_QUA_TECNOVIG', id: String(x.id) }),
      (g) =>
        g.abrirQueixa({
          area: e.area,
          tipo: e.tipo,
          item: e.item,
          produto: e.produto,
          lote: e.lote,
          serie: e.serie,
          fabricante: e.fabricante,
          registroAnvisa: e.registroAnvisa,
          descricao: e.descricao,
          notificacao: e.notificacao,
          alerta: e.alerta,
          conduta: e.conduta,
          usuario: s.login,
          agora,
        }),
    );
    return { ok: true, id: r.id, versao: r.versao, mensagem: 'Registro aberto.' };
  }

  @Post('tecnovigilancia/:id/andamento')
  @HttpCode(200)
  @Permissao(P.tecnovigilanciaRegistrar)
  @AuditadoNoHandler('qualidade.registrarQueixaTecnica: o andamento em SGH_QUA_TECNOVIG com a SGH_TRILHA')
  async andamentoQueixa(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarQueixaTecnica, { ...(b as object), acao: 'andamento', id: idDaRota(id) });
    if (e.acao !== 'andamento') throw entrada('Vigilância de produto', 'Andamento inválido.', ['acao']);
    await this.apoio.exigirLiberacao(s);
    const agora = await this.agora(s);
    const r = await this.apoio.sgh(
      s,
      E.qualidadeQueixaTecnicaRegistrada.codigo,
      P.tecnovigilanciaRegistrar,
      { tabela: 'SGH_QUA_TECNOVIG', id: String(e.id) },
      async (g) => {
        const atual = await g.travarQueixa(e.id);
        const c = conferirAndamentoVigilancia(
          {
            situacao: atual.situacao as SituacaoVigilanciaProduto,
            versao: atual.versao,
            notivisaNumero: atual.notivisaNumero,
          },
          e,
        );
        if (!c.ok) throw recusaVigilancia(c.motivo);
        return g.andamentoQueixa({
          id: e.id,
          versao: e.versao,
          situacao: e.situacao,
          conduta: e.conduta,
          notivisaNumero: c.notivisaNumero,
          encerra: c.encerra,
          texto: e.texto,
          usuario: s.login,
          agora,
        });
      },
    );
    return { ok: true, id: e.id, versao: r.versao, mensagem: 'Andamento registrado.' };
  }

  // ── Painel do plano de segurança do paciente ─────────────────────────────────────────────────────

  @Get('nsp/painel')
  @Permissao(P.protocoloLer)
  async painel(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const filtro = corpo(esquemaPeriodoPainel, { de: q['de'] || undefined, ate: q['ate'] || undefined });
    const agora = await this.agora(s);
    const hoje = agora.slice(0, 10);
    const p = periodoDoPainel(filtro, hoje);
    if (!p.ok)
      throw entrada(
        'Painel',
        p.motivo === 'fim-futuro'
          ? 'O fim do período não pode estar no futuro.'
          : 'O período do painel é de no máximo 12 meses.',
        ['de', 'ate'],
        p.motivo,
      );
    const [notificacoes, analises, acoes, adesao, gerenciados, historico] = await Promise.all([
      this.porta.painelNotificacoes(s.porta, p.de, p.fimExclusivo),
      this.porta.painelAnalises(s.porta, p.de, p.fimExclusivo, hoje),
      this.porta.painelAcoes(s.porta, hoje),
      this.porta.painelAdesao(s.porta, p.de, p.fimExclusivo, agora),
      this.porta.protocolosGerenciados(s.porta, `${p.de}T00:00:00`, `${p.fimExclusivo}T00:00:00`),
      this.porta.historicoRiscos(s.porta).catch(() => []),
    ]);
    const cortados = gerenciados.protocolos.length > TETO_PROTOCOLOS_DO_PERIODO;
    return {
      painel: montarPainel({
        de: p.de,
        ate: p.ate,
        notificacoes,
        analises,
        acoes,
        adesao,
        protocolos: adesaoProtocolosGerenciados(
          gerenciados.versoes,
          gerenciados.protocolos.slice(0, TETO_PROTOCOLOS_DO_PERIODO),
        ),
        protocolosCortados: cortados,
        historico,
      }),
      agora,
    };
  }
}
