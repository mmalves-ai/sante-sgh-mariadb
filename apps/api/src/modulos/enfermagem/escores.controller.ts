// Escores de risco e classificação de pacientes (M45, etapa 2; ficha, seções 4, 5, 7 e 8):
//   GET  /api/enfermagem/escores/unidade?unidade            a unidade no turno: os últimos escores, as reavaliações vencidas
//                                                          e os gatilhos abertos (leitura auditada)
//   GET  /api/enfermagem/escores/atendimentos/:atendimento  o paciente: o histórico, as reavaliações e as escalas em
//                                                          formulário do prontuário (leitura auditada)
//   POST /api/enfermagem/escores/afericao                  enfermagem.registrarEscore (NEWS2): os sinais vitais e o NEWS2
//                                                          na mesma gravação, com a conduta, o aviso e a reavaliação
//   POST /api/enfermagem/escores                           enfermagem.registrarEscore (Braden, Morse, Glasgow, RASS,
//                                                          CAM-ICU, dor), com os cuidados preventivos decididos
//   POST /api/enfermagem/escores/reavaliacoes              enfermagem.programarReavaliacao (admissão, mudança de quadro)
//   POST /api/enfermagem/escores/reavaliacoes/:id/dispensar  a dispensa com o motivo
//   GET|POST /api/enfermagem/escores/regras                as faixas vigentes; enfermagem.publicarRegraEscore (crítica)
//   GET|POST /api/enfermagem/classificacao                 a carga da unidade no turno; enfermagem.classificarPaciente
// Só do novo (SGH_), com a trilha_auditoria na mesma transação; a liberação é a `enfermagem.escores` (POL-3).
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type CargaDaUnidade,
  esquemaAfericaoNews2,
  esquemaClassificarPaciente,
  esquemaDispensarReavaliacao,
  esquemaProgramarReavaliacao,
  esquemaPublicarRegraEscore,
  esquemaRegistrarEscore,
  EVENTOS_AUDITAVEIS,
  type EscoresDaUnidade,
  type EscoresDoPaciente,
  PERMISSOES_ENFERMAGEM,
  PERMISSOES_ESCORES as P,
  type RegraEscore,
  type ResultadoEscore,
  TURNOS,
  type Turno,
  esquemaEstornarRegistro,
  esquemaDecidirProfilaxia,
  esquemaRetificarProfilaxia,
} from '@sgh/contratos';
import { BRADEN_HISTORICA_FORMULARIO, categoriaPorCbo, parametrosTev } from '@sgh/dominio-enfermagem';
import type { Internado } from './tipos.js';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { exigir, idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ApoioGravacao, corpo } from '../exames/public-api.js';
import { type GravadorEscores, PORTA_ESCORES, type PortaEscores } from './escores-porta.js';
import {
  CHAVE_ESCORES,
  mensagemDoEscore,
  type ParametrosEscores,
  ServicoEscores,
} from './escores-servico.js';
import { PORTA_ENFERMAGEM, type PortaEnfermagem } from './porta.js';

const UNIDADE = /^[A-Za-z0-9 ._-]{1,5}$/;
/** W0-03, M1: quem decide a profilaxia de TEV sugerida é quem prescreve (a permissão da prescrição do PEP). */
const PERMISSAO_PRESCREVER = 'pep.prescricao.criar';
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function unidadeDe(v: string | undefined): string {
  const u = (v ?? '').trim();
  if (!UNIDADE.test(u))
    throw new ErroProblema('entrada-invalida', 400, 'Unidade inválida', 'Escolha a unidade.');
  return u;
}

const lista = (v: unknown): string[] =>
  String(v ?? '')
    .split(',')
    .map((x) => x.trim().toUpperCase())
    .filter((x) => /^[A-Z0-9._-]{2,31}$/.test(x));

/** Os apoios comuns das telas de escores, classificação e índices (a mesma chave de liberação). */
export class ApoioEscores {
  readonly apoio: ApoioGravacao<GravadorEscores>;
  readonly servico: ServicoEscores;
  constructor(
    readonly porta: PortaEscores,
    readonly enfermagem: PortaEnfermagem,
    trilha: RegistradorTrilha,
    configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
  ) {
    this.apoio = new ApoioGravacao(
      {
        chave: CHAVE_ESCORES,
        nome: 'os escores de risco, a classificação de pacientes e os índices de UTI',
        operacoes: {},
      },
      porta,
      trilha,
      configuracao,
      cache,
    );
    this.servico = new ServicoEscores(porta, enfermagem);
  }

  async parametros(s: SessaoCadastro): Promise<ParametrosEscores> {
    const [inicio, intervalo, medico, trr, tevClinico, tevCirurgico] = await Promise.all([
      this.apoio.parametroValor(s, 'enfermagem.inicioTurnoDiurno'),
      this.apoio.parametro(s, 'enfermagem.reavaliacao.intervaloHoras'),
      this.apoio.parametroValor(s, 'enfermagem.news2.loginsMedico'),
      this.apoio.parametroValor(s, 'enfermagem.news2.loginsTrr'),
      this.apoio.parametroValor(s, 'enfermagem.tev.escalaClinico'),
      this.apoio.parametroValor(s, 'enfermagem.tev.escalaCirurgico'),
    ]);
    return {
      inicioTurnoDiurno: /^\d{4}$/.test(String(inicio ?? '')) ? String(inicio) : '0700',
      intervaloHoras: intervalo > 0 ? intervalo : 24,
      loginsMedico: lista(medico),
      loginsTrr: lista(trr),
      tev: parametrosTev(tevClinico, tevCirurgico),
    };
  }

  /**
   * W0-03: estorna ou invalida o escore, a classificação ou o índice de UTI (fato novo, com o motivo; o original fica
   * inativo e visível). No NEWS2, o alerta já disparado é reavaliado e o resultado volta na resposta.
   */
  async estornar(
    s: SessaoCadastro,
    origem: 'escore' | 'classificacao' | 'indiceUti',
    id: number,
    b: unknown,
    recurso: string,
  ): Promise<{
    ok: true;
    id: number;
    alerta: string | null;
    escoreMantem: number | null;
    vinculados: { acionamentos: number; profilaxias: number; protocolos: number; reavaliacoes: number };
    mensagem: string;
  }> {
    const e = corpo(esquemaEstornarRegistro, b);
    const p = await this.servico.prepararEstorno({ c: s.porta, login: s.login }, origem, id, e);
    const tabela = {
      escore: 'aplicacao_escala',
      classificacao: 'classificacao_paciente',
      indiceUti: 'indice_gravidade_uti',
    }[origem];
    await this.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemRegistroEstornado.codigo,
      recurso,
      {
        tabela,
        id: String(id),
        paciente: p.paciente,
        chave: `${e.tipo}${p.alerta ? `:alerta-${p.alerta.alerta}` : ''}${p.vinculados.acionamentos ? `:trr-${p.vinculados.acionamentos}` : ''}${p.vinculados.protocolos ? `:protocolo-${p.vinculados.protocolos}` : ''}${p.vinculados.reavaliacoes ? `:reavaliacao-${p.vinculados.reavaliacoes}` : ''}`,
      },
      (g) => g.estornarRegistro(p.gravar),
    );
    const alerta = p.alerta?.alerta ?? null;
    return {
      ok: true,
      id,
      alerta,
      escoreMantem: p.alerta?.escoreMantem ?? null,
      vinculados: p.vinculados,
      mensagem:
        (e.tipo === 'estorno' ? 'Registro estornado' : 'Registro invalidado') +
        ' (o original fica inativo e visível).' +
        (alerta === 'encerrado'
          ? ' O alerta do NEWS2 foi encerrado: nenhum outro NEWS2 válido das últimas 12 horas tem gatilho.'
          : alerta === 'mantido'
            ? ' O alerta do NEWS2 continua: outro NEWS2 válido das últimas 12 horas mantém o gatilho.'
            : '') +
        (p.vinculados.acionamentos
          ? ` Este escore acionou o Time de Resposta Rápida (${p.vinculados.acionamentos} acionamento(s)): o acionamento continua registrado, marcado com o escore estornado, e sai do tempo "do alerta ao acionamento".`
          : '') +
        (p.vinculados.profilaxias
          ? ` A decisão de profilaxia de TEV deste escore (${p.vinculados.profilaxias}) fica inativa com ele.`
          : '') +
        (p.vinculados.protocolos
          ? ` O alerta deste escore abriu ${p.vinculados.protocolos} inclusão(ões) no protocolo de sepse do internado, que continua(m) aberta(s), com o relógio das metas: se a inclusão foi pelo alerta errado, inative-a ou encerre-a com o motivo na tela dos protocolos.`
          : '') +
        (p.vinculados.reavaliacoes
          ? ` Este escore cumpria ${p.vinculados.reavaliacoes} reavaliação(ões) programada(s), que voltam a valer: pendentes de novo (ou cumpridas pelo escore válido seguinte da mesma escala), com o mesmo vencimento.`
          : ''),
    };
  }

  /** O vínculo da sessão é de enfermeiro (CBO 2235) com o conselho ativo? (a classificação é do enfermeiro) */
  async ehEnfermeiro(s: SessaoCadastro): Promise<boolean> {
    const v = await this.porta.vinculo(s.porta, s.login).catch(() => null);
    return !!v && v.conselhoAtivo && categoriaPorCbo(v.codigoCbo) === 'enfermeiro';
  }

  /** O internado do atendimento (o paciente do pedido tem de ser o do atendimento). */
  async internado(s: SessaoCadastro, atendimento: number | null, paciente: number): Promise<Internado> {
    const i = atendimento ? await this.enfermagem.internado(s.porta, atendimento) : null;
    if (!i || i.paciente !== paciente)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Paciente não internado',
        'O paciente não está internado neste atendimento: abra-o pela unidade.',
      );
    return i;
  }
}

@Controller('enfermagem/escores')
export class EscoresController {
  private readonly a: ApoioEscores;

  constructor(
    @Inject(PORTA_ESCORES) porta: PortaEscores,
    @Inject(PORTA_ENFERMAGEM) enfermagem: PortaEnfermagem,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
  ) {
    this.a = new ApoioEscores(porta, enfermagem, trilha, configuracao, cache);
  }

  private async gravacao(s: SessaoCadastro): Promise<EscoresDaUnidade['gravacao']> {
    const [l, enf] = await Promise.all([this.a.apoio.liberacao(s), this.a.ehEnfermeiro(s)]);
    const registrar = l.ligada && s.pode(P.escoreRegistrar);
    return {
      ligada: l.ligada,
      motivo: l.motivo,
      registrar,
      decidirCuidados: registrar && enf,
      publicar: l.ligada && s.pode(P.regraEscorePublicar),
      decidirProfilaxia: l.ligada && s.pode(PERMISSAO_PRESCREVER),
    };
  }

  @Get('unidade')
  @Permissao(P.escoreLer)
  @Auditar(EVENTOS_AUDITAVEIS.escoresLidos.codigo)
  async unidade(
    @Query('unidade') u: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<EscoresDaUnidade> {
    const s = sessaoDe(req);
    const unidade = unidadeDe(u);
    const [p, g] = await Promise.all([this.a.parametros(s), this.gravacao(s)]);
    const r = await this.a.servico.unidade({ c: s.porta, login: s.login }, unidade, p, g);
    req.sghAlvo = {
      tabelaAlvo: 'aplicacao_escala',
      chaveNaturalAlvo: `unidade:${unidade};n:${r.pacientes.length}`,
    };
    return r;
  }

  /**
   * W0-03, M1: as profilaxias de TEV pendentes da unidade, para o prescritor (a mesma lista da tela dos escores; quem
   * prescreve vê sem precisar da permissão de ler os escores da enfermagem).
   */
  @Get('profilaxia')
  @Permissao(PERMISSAO_PRESCREVER)
  @Auditar(EVENTOS_AUDITAVEIS.escoresLidos.codigo)
  async profilaxiasPendentes(@Query('unidade') u: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    // Revisão W0-03: a tela própria do prescritor (/enfermagem/escores/profilaxia) escolhe a unidade por esta mesma
    // leitura (as unidades vêm junto; sem a unidade, só a lista delas), sem a permissão de ler os horários nem os escores.
    const [p, g, unidades] = await Promise.all([
      this.a.parametros(s),
      this.gravacao(s),
      this.a.enfermagem.unidades(s.porta),
    ]);
    if (!(u ?? '').trim()) {
      req.sghAlvo = { tabelaAlvo: 'aplicacao_escala', chaveNaturalAlvo: 'profilaxia:unidades' };
      return { unidade: null, agora: null, pendentes: [], decidir: g.decidirProfilaxia ?? false, unidades };
    }
    const unidade = unidadeDe(u);
    const r = await this.a.servico.unidade({ c: s.porta, login: s.login }, unidade, p, g);
    const pendentes = r.profilaxiasPendentes ?? [];
    req.sghAlvo = {
      tabelaAlvo: 'aplicacao_escala',
      chaveNaturalAlvo: `profilaxia:${unidade};n:${pendentes.length}`,
    };
    return { unidade, agora: r.agora, pendentes, decidir: g.decidirProfilaxia ?? false, unidades };
  }

  @Get('atendimentos/:atendimento')
  @Permissao(P.escoreLer)
  @Auditar(EVENTOS_AUDITAVEIS.escoresLidos.codigo)
  async paciente(
    @Param('atendimento') atendimento: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<
    EscoresDoPaciente & { gravacao: EscoresDaUnidade['gravacao']; nome: string; leito: string; reg: number }
  > {
    const s = sessaoDe(req);
    const i = await this.a.enfermagem.internado(s.porta, idDaRota(atendimento));
    if (!i) throw new ErroProblema('nao-encontrado', 404, 'Paciente não internado');
    const [p, g] = await Promise.all([this.a.parametros(s), this.gravacao(s)]);
    const r = await this.a.servico.paciente({ c: s.porta, login: s.login }, i, p);
    req.sghAlvo = { paciente: i.paciente, tabelaAlvo: 'aplicacao_escala' };
    return { ...r, gravacao: g, nome: i.nome, leito: i.leito, reg: i.numero };
  }

  @Post('afericao')
  @HttpCode(201)
  @Permissao(P.escoreRegistrar)
  @AuditadoNoHandler(
    'enfermagem.registrarEscore (NEWS2): afericao_valor, aplicacao_escala e trilha_auditoria na mesma transação',
  )
  async afericao(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoEscore> {
    const s = sessaoDe(req);
    await exigir(s, PERMISSOES_ENFERMAGEM.sinalCriar, this.trilha);
    const e = corpo(esquemaAfericaoNews2, b);
    const i = await this.a.internado(s, e.atendimento, e.paciente);
    const p = await this.a.parametros(s);
    const { registro, resultado } = await this.a.servico.prepararAfericao(
      { c: s.porta, login: s.login },
      i,
      e,
      p,
    );
    const r = await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.escoreRegistrado.codigo,
      P.escoreRegistrar,
      (x: { id: number }) => ({
        tabela: 'aplicacao_escala',
        id: String(x.id),
        paciente: i.paciente,
        chave: `news2:v${registro.escore.versaoRegra}:${resultado.total}:${resultado.faixa}:${resultado.gatilho}`,
      }),
      (g) => g.registrarEscore(registro),
    );
    return {
      id: r.id,
      ...resultado,
      mensagem: mensagemDoEscore('news2', resultado.total, resultado.gatilho),
    };
  }

  @Post()
  @HttpCode(201)
  @Permissao(P.escoreRegistrar)
  @AuditadoNoHandler(
    'enfermagem.registrarEscore: aplicacao_escala, aplicacao_escala e trilha_auditoria na mesma transação',
  )
  async registrar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoEscore> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarEscore, b);
    const i = await this.a.internado(s, e.atendimento, e.paciente);
    const { registro, resultado } = await this.a.servico.prepararEscore(
      { c: s.porta, login: s.login },
      i,
      e,
      await this.a.ehEnfermeiro(s),
      await this.a.parametros(s),
    );
    const r = await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.escoreRegistrado.codigo,
      P.escoreRegistrar,
      (x: { id: number }) => ({
        tabela: 'aplicacao_escala',
        id: String(x.id),
        paciente: i.paciente,
        chave: `${e.escala}:v${registro.escore.versaoRegra}:${resultado.total}:${resultado.faixa}`,
      }),
      (g) => g.registrarEscore(registro),
    );
    return {
      id: r.id,
      ...resultado,
      mensagem: mensagemDoEscore(e.escala, resultado.total, resultado.gatilho),
    };
  }

  /**
   * W0-03, M1: o prescritor decide a profilaxia de TEV sugerida pelo escore de Caprini ou Padua em risco: prescrita, ou
   * não prescrita com o motivo (a ordem em si é da prescrição). Uma decisão por escore; o estornado não se decide.
   */
  @Post(':id/profilaxia')
  @HttpCode(201)
  @Permissao(PERMISSAO_PRESCREVER)
  @AuditadoNoHandler('a decisão em aplicacao_escala com a trilha_auditoria na mesma transação')
  async decidirProfilaxia(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaDecidirProfilaxia, b);
    const escore = idDaRota(id);
    const r = await this.a.porta.registroParaEstorno(s.porta, 'escore', escore);
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Escore não encontrado');
    await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemProfilaxiaTevDecidida.codigo,
      PERMISSAO_PRESCREVER,
      {
        tabela: 'aplicacao_escala',
        id: String(escore),
        paciente: r.paciente,
        chave: `profilaxiaTev:${e.decisao}`,
      },
      (g) =>
        g.decidirProfilaxia({
          escore,
          paciente: r.paciente,
          decisao: e.decisao,
          motivo: e.motivo ?? null,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      escore,
      decisao: e.decisao,
      mensagem:
        e.decisao === 'prescrita'
          ? 'Profilaxia registrada como prescrita: a pendência saiu da lista.'
          : 'Profilaxia registrada como não prescrita, com o motivo: a pendência saiu da lista.',
    };
  }

  /**
   * Revisão W0-03: a correção da decisão de profilaxia pelo próprio autor (fato novo com a justificativa): outra
   * decisão, ou a anulação, que reabre a pendência do prescritor. A decisão original continua legível.
   */
  @Post(':id/profilaxia/retificar')
  @HttpCode(201)
  @Permissao(PERMISSAO_PRESCREVER)
  @AuditadoNoHandler('a correção em profilaxia_tev_avaliacao com a trilha_auditoria na mesma transação')
  async retificarProfilaxia(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRetificarProfilaxia, b);
    const escore = idDaRota(id);
    const r = await this.a.porta.registroParaEstorno(s.porta, 'escore', escore);
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Escore não encontrado');
    await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemProfilaxiaTevDecidida.codigo,
      PERMISSAO_PRESCREVER,
      {
        tabela: 'profilaxia_tev_avaliacao',
        id: String(escore),
        paciente: r.paciente,
        chave: `profilaxiaTev:retifica:${e.decisao}`,
      },
      (g) =>
        g.retificarProfilaxia({
          escore,
          paciente: r.paciente,
          decisao: e.decisao,
          motivo: e.motivo ?? null,
          justificativa: e.justificativa,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      escore,
      decisao: e.decisao,
      mensagem:
        e.decisao === 'anulada'
          ? 'Decisão anulada: a pendência de profilaxia voltou à lista do prescritor. A decisão original continua visível.'
          : 'Decisão corrigida, com a justificativa: a decisão original continua visível.',
    };
  }

  /** W0-03: estornar ou invalidar o escore, com o motivo (o alerta NEWS2 disparado é reavaliado). */
  @Post(':id/estornar')
  @HttpCode(200)
  @Permissao(P.escoreRegistrar)
  @AuditadoNoHandler('o estorno em aplicacao_escala com a trilha_auditoria na mesma transação')
  estornar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.a.estornar(sessaoDe(req), 'escore', idDaRota(id), b, P.escoreRegistrar);
  }

  /**
   * W0-03: a exportação do histórico de 30 dias do paciente (CSV), com os estornados marcados como inativos, o motivo,
   * quem e quando (o registro estornado nunca some da exportação).
   */
  @Get('atendimentos/:atendimento/exportar')
  @Permissao(P.escoreLer)
  @Auditar(EVENTOS_AUDITAVEIS.escoresLidos.codigo)
  async exportar(@Param('atendimento') atendimento: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const i = await this.a.enfermagem.internado(s.porta, idDaRota(atendimento));
    if (!i) throw new ErroProblema('nao-encontrado', 404, 'Paciente não internado');
    const r = await this.a.servico.paciente({ c: s.porta, login: s.login }, i, await this.a.parametros(s));
    req.sghAlvo = { paciente: i.paciente, tabelaAlvo: 'aplicacao_escala' };
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const linhas = [
      [
        'escore',
        'escala',
        'versao_regra',
        'total',
        'faixa',
        'gatilho',
        'aferido_em',
        'autor',
        'situacao',
        'motivo',
        'estornado_por',
        'estornado_em',
        'alerta_news2',
      ],
      ...r.historico.map((x) => [
        x.id,
        x.escala,
        x.versaoRegra,
        x.total,
        x.rotuloFaixa,
        x.gatilho,
        x.aferidoEm,
        x.usuario,
        x.estorno ? (x.estorno.tipo === 'estorno' ? 'estornado' : 'invalidado') : 'ativo',
        x.estorno?.motivo ?? '',
        x.estorno?.usuario ?? '',
        x.estorno?.em ?? '',
        x.estorno?.alerta ?? '',
      ]),
    ];
    return {
      arquivo: `escores-${i.atendimento}.csv`,
      csv: linhas.map((l) => l.map(q).join(';')).join('\r\n'),
    };
  }

  @Post('reavaliacoes')
  @HttpCode(201)
  @Permissao(P.escoreRegistrar)
  @AuditadoNoHandler(
    'enfermagem.programarReavaliacao: reavaliacao_escala e trilha_auditoria na mesma transação',
  )
  async programar(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: number; mensagem: string }> {
    const s = sessaoDe(req);
    const e = corpo(esquemaProgramarReavaliacao, b);
    const i = await this.a.internado(s, e.atendimento, e.paciente);
    const p = await this.a.parametros(s);
    const r = await this.a.servico.prepararReavaliacao({ c: s.porta, login: s.login }, i, e, p);
    const id = await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.reavaliacaoProgramada.codigo,
      P.escoreRegistrar,
      (x: number) => ({
        tabela: 'reavaliacao_escala',
        id: String(x),
        paciente: i.paciente,
        chave: `${e.escala}:${r.chave}`,
      }),
      (g) => g.programarReavaliacao(r),
    );
    return { id, mensagem: `Reavaliação programada: prazo até ${r.prazoEm.slice(0, 16).replace('T', ' ')}.` };
  }

  @Post('reavaliacoes/:id/dispensar')
  @HttpCode(200)
  @Permissao(P.escoreRegistrar)
  @AuditadoNoHandler(
    'enfermagem.programarReavaliacao (dispensa): reavaliacao_escala e trilha_auditoria na mesma transação',
  )
  async dispensar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: number; mensagem: string }> {
    const s = sessaoDe(req);
    const e = corpo(esquemaDispensarReavaliacao, b);
    const rid = idDaRota(id);
    const agora = await this.a.servico.relogio(s.porta);
    await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.reavaliacaoProgramada.codigo,
      P.escoreRegistrar,
      (x: { paciente: number }) => ({
        tabela: 'reavaliacao_escala',
        id: String(rid),
        paciente: x.paciente,
        chave: 'dispensada',
      }),
      (g) =>
        g.dispensarReavaliacao({ id: rid, motivo: e.motivo, quando: agora.slice(0, 19), usuario: s.login }),
    );
    return { id: rid, mensagem: 'Reavaliação dispensada com o motivo.' };
  }

  @Get('regras')
  @Permissao(P.escoreLer)
  async regras(
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ vigentes: RegraEscore[]; publicadas: RegraEscore[]; historicas: RegraEscore[] }> {
    const s = sessaoDe(req);
    const r = await this.a.servico.regras(s.porta);
    return {
      vigentes: Object.values(r.vigentes),
      publicadas: r.publicadas,
      historicas: [BRADEN_HISTORICA_FORMULARIO],
    };
  }

  @Post('regras')
  @HttpCode(201)
  @Permissao(P.regraEscorePublicar)
  @AuditadoNoHandler(
    'enfermagem.publicarRegraEscore: escala_clinica_versao e trilha_auditoria na mesma transação',
  )
  async publicarRegra(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: number; versao: number; mensagem: string }> {
    const s = sessaoDe(req);
    const e = corpo(esquemaPublicarRegraEscore, b);
    if (!this.resolvedor)
      throw new ErroProblema(
        'reautenticacao-necessaria',
        401,
        'Confirme a senha',
        'Entre com o seu usuário.',
      );
    await reautenticar(this.sessoes, this.resolvedor, req, e.senha);
    const linha = await this.a.servico.prepararRegra({ c: s.porta, login: s.login }, e);
    const r = await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.regraEscorePublicada.codigo,
      P.regraEscorePublicar,
      (x: { id: number; versao: number }) => ({
        tabela: 'escala_clinica_versao',
        id: String(x.id),
        chave: `${e.escala}:v${x.versao}`,
      }),
      (g) => g.publicarRegra(linha),
    );
    return { ...r, mensagem: `Versão ${r.versao} das faixas publicada: vale para os registros novos.` };
  }
}

@Controller('enfermagem/classificacao')
export class ClassificacaoPacientesController {
  private readonly a: ApoioEscores;

  constructor(
    @Inject(PORTA_ESCORES) porta: PortaEscores,
    @Inject(PORTA_ENFERMAGEM) enfermagem: PortaEnfermagem,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.a = new ApoioEscores(porta, enfermagem, trilha, configuracao, cache);
  }

  /** W0-03: estornar a classificação, com o motivo (relança-se no mesmo turno). */
  @Post(':id/estornar')
  @HttpCode(200)
  @Permissao(P.classificacaoRegistrar)
  @AuditadoNoHandler('o estorno em aplicacao_escala com a trilha_auditoria na mesma transação')
  estornar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.a.estornar(sessaoDe(req), 'classificacao', idDaRota(id), b, P.classificacaoRegistrar);
  }

  @Get()
  @Permissao(P.classificacaoLer)
  @Auditar(EVENTOS_AUDITAVEIS.classificacaoLida.codigo)
  async carga(
    @Query('unidade') u: string | undefined,
    @Query('data') data: string | undefined,
    @Query('turno') turno: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<CargaDaUnidade> {
    const s = sessaoDe(req);
    const unidade = unidadeDe(u);
    if ((data || turno) && (!DATA.test(data ?? '') || !(TURNOS as readonly string[]).includes(turno ?? '')))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Turno inválido',
        'Informe a data e o turno (diurno ou noturno).',
      );
    const [p, l, enf] = await Promise.all([
      this.a.parametros(s),
      this.a.apoio.liberacao(s),
      this.a.ehEnfermeiro(s),
    ]);
    const r = await this.a.servico.carga(
      { c: s.porta, login: s.login },
      unidade,
      data ?? null,
      (turno as Turno | undefined) ?? null,
      p,
      { ligada: l.ligada, motivo: l.motivo, registrar: l.ligada && enf && s.pode(P.classificacaoRegistrar) },
    );
    req.sghAlvo = {
      tabelaAlvo: 'classificacao_paciente',
      chaveNaturalAlvo: `unidade:${unidade};${r.data}:${r.turno}`,
    };
    return r;
  }

  @Post()
  @HttpCode(201)
  @Permissao(P.classificacaoRegistrar)
  @AuditadoNoHandler(
    'enfermagem.classificarPaciente: classificacao_paciente e trilha_auditoria na mesma transação',
  )
  async classificar(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{
    id: number;
    total: number;
    categoria: string;
    rotuloCategoria: string;
    horas24h: number;
    mensagem: string;
  }> {
    const s = sessaoDe(req);
    const e = corpo(esquemaClassificarPaciente, b);
    if (!(await this.a.ehEnfermeiro(s)))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Sem permissão',
        'A classificação de pacientes é do enfermeiro.',
        {
          codigo: 'so-enfermeiro',
        },
      );
    const i = await this.a.internado(s, e.atendimento, e.paciente);
    if (i.numero !== e.reg)
      throw new ErroProblema('nao-encontrado', 404, 'Internação', 'A internação não é a do atendimento.');
    const p = await this.a.parametros(s);
    const { resultado, ...linha } = await this.a.servico.prepararClassificacao(
      { c: s.porta, login: s.login },
      i,
      e,
      p,
    );
    const id = await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.pacienteClassificado.codigo,
      P.classificacaoRegistrar,
      (x: number) => ({
        tabela: 'classificacao_paciente',
        id: String(x),
        paciente: i.paciente,
        chave: `${e.instrumento}:${e.data}:${e.turno}:${resultado.total}`,
      }),
      (g) => g.classificar(linha),
    );
    return {
      id,
      total: resultado.total,
      categoria: resultado.categoria,
      rotuloCategoria: resultado.rotuloCategoria,
      horas24h: resultado.horas24h,
      mensagem: `Classificado: ${resultado.rotuloCategoria} (${String(resultado.horas24h).replace('.', ',')} h de enfermagem em 24 h).`,
    };
  }
}
