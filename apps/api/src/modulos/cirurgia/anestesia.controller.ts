// Anestesia no bloco (M46, etapa 1; ficha, seções 4, 5, 7 e 8; regras 3, 4, 12 e 13):
//   GET  /api/cirurgia/anestesia/cirurgias?data=                 as cirurgias do dia com a situação da APA, da ficha e da SRPA
//   GET  /api/cirurgia/anestesia/dominios                        os domínios da ficha (cache por estabelecimento, 1 h)
//   GET  /api/cirurgia/anestesia/profissionais?q= | itens?q=     a busca do anestesista e do fármaco (SanteSelecao remota)
//   GET  /api/cirurgia/anestesia/:agenda/apa                     a APA (contexto, vigente, versões; leitura de prontuário)
//   POST /api/cirurgia/anestesia/:agenda/apa                     cirurgia.registrarApa (fecha as pendências do M18)
//   GET  /api/cirurgia/anestesia/:agenda/ficha                   a ficha anestésica (lacunas, responsáveis, pendências)
//   POST /api/cirurgia/anestesia/:agenda/ficha/lancamentos       cirurgia.registrarFichaAnestesica (lote por parte)
//   POST …/ficha/marcos | lancamentos/:id/encerrar | passagem | lacunas | assinatura | adendos
//   GET  /api/cirurgia/anestesia/srpa/quadro                     o quadro da recuperação (admitidos sem alta)
//   GET  /api/cirurgia/anestesia/:agenda/srpa                    a série da SRPA com os impedimentos da alta
//   POST /api/cirurgia/anestesia/:agenda/srpa                    cirurgia.registrarSrpa (admissão, avaliação, alta)
// Só do novo (banco), com a trilha de auditoria na mesma transação e o ator real; o estabelecimento vem da sessão. A receita relê
// a ficha travada e a versão na MESMA transação e o domínio confere ali de novo. A assinatura é do anestesista da
// cirurgia (o do agendamento, o da equipe com a função de anestesista e quem teve a responsabilidade), com a senha
// conferida de novo; quem não é recebe 403 e a negação vai à trilha. Tudo nasce desligado (chave `bloco.ficha`, POL-3).
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type ApaResposta,
  CONCLUSOES_APA,
  type ContextoAnestesiaResposta,
  type CirurgiasParaAnestesiaResposta,
  type ClasseAsa,
  type ConclusaoApa,
  type DominiosFichaResposta,
  esquemaAdendoFicha,
  esquemaAssinarFicha,
  esquemaEncerrarLancamentoFicha,
  esquemaJustificarLacuna,
  esquemaLancarFicha,
  esquemaMarcarTempoFicha,
  esquemaPassarResponsabilidade,
  esquemaRegistrarApa,
  esquemaRegistrarSrpa,
  EVENTOS_AUDITAVEIS,
  type FichaAnestesicaResposta,
  type LancamentoFichaEntrada,
  type LinhaQuadroSrpa,
  PARAMETRO_BALANCO_HORA_CORTE,
  PERMISSOES_ANESTESIA_CODIGOS as P,
  type QuadroSrpaResposta,
  type RecusaAnestesia,
  REGRA_ALTA_SRPA_V1,
  type ResultadoAnestesia,
  type SrpaResposta,
  type TelaApaResposta,
  type TelaFichaResposta,
  type TelaSrpaResposta,
} from '@sgh/contratos';
import {
  avaliacaoVencida,
  avaliarJejum,
  conclusaoLibera,
  conferirApa,
  conferirAvaliacao,
  conferirLancamentos,
  conferirMarco,
  conferirPassagem,
  deParaBalanco,
  descreverLancamento,
  type DominioDoBalanco,
  type EstadoAgendamento,
  impedimentosDaAlta,
  impressaoFicha,
  indiceLee,
  linhaDeResponsabilidade,
  minutosDoInstante,
  montarFicha,
  proximaAvaliacaoAte,
  responsavelAtual,
  rotuloAsa,
  situacaoDepoisDoMarco,
} from '@sgh/dominio-cirurgia';
import { horaDoCorte, janelaDoInstante } from '@sgh/dominio-enfermagem';
import type {
  AvaliacaoRecuperacao,
  ContextoAnestesia,
  DominiosFicha,
  FichaAnestesica,
  LancamentoFicha,
} from './tipos.js';
import { funcaoAnestesista } from './regras.js';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
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
import { PORTA_BALANCO, type PortaBalanco } from '../enfermagem/public-api.js';
import { ApoioGravacao, corpo } from '../exames/public-api.js';
// A porta (só o símbolo e o tipo), não a public-api: os adaptadores de suprimentos migram em outro lote da onda.
import { PORTA_SUPRIMENTOS, type PortaSuprimentos } from '../suprimentos/porta.js';
import { type GravadorAnestesia, PORTA_ANESTESIA, type PortaAnestesia } from './anestesia-porta.js';
import { PORTA_CIRURGIA, type PortaCirurgia } from './porta.js';
import { TRAVA_INCISAO, type TravaIncisao } from './trava-incisao.js';

const E = EVENTOS_AUDITAVEIS;
const CHAVE = /^[A-Za-z0-9._:-]{8,80}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
export const CHAVE_LIBERACAO_ANESTESIA = 'bloco.ficha';
/** Tolerância do relógio do aparelho para o horário informado (o tablet pode estar um pouco adiantado). */
const TOLERANCIA_FUTURO_MIN = 5;
const CACHE_DOMINIOS_MS = 3_600_000;
const EXTRAS = {
  apa: P.apaRegistrar,
  ficha: P.fichaRegistrar,
  assinar: P.fichaAssinar,
  srpa: P.srpaRegistrar,
} as const;
const CONFLITOS: readonly string[] = [
  'apa-mudou',
  'ficha-mudou',
  'srpa-mudou',
  'chave-reutilizada',
  'srpa-ja-com-alta',
  'ficha-assinada',
  'ficha-marco-repetido',
];

/** A recusa da regra da anestesia em Problem Details: conflito (409) ou entrada que a regra não aceita (422). */
export function recusaAnestesia(codigo: RecusaAnestesia | string, titulo = 'Anestesia'): ErroProblema {
  const conflito = CONFLITOS.includes(codigo);
  return new ErroProblema(
    conflito ? 'recusa-de-negocio' : 'entrada-invalida',
    conflito ? 409 : 422,
    titulo,
    'A regra da anestesia não aceita este registro agora (o código diz por quê).',
    { codigo },
  );
}

const SEM_REGISTRO = () =>
  new ErroProblema(
    'sem-permissao',
    403,
    'Registro profissional necessário',
    'Este registro é do profissional com o cadastro e o conselho ativos no estabelecimento.',
    { codigo: 'sem-registro-profissional' },
  );

const instanteT = (v: string) => v.trim().replace(' ', 'T').slice(0, 16);

export function chaveDoPedidoAnestesia(s: SessaoCadastro, doCorpo: string): string {
  const bruto = s.req.headers['idempotency-key'];
  const k = Array.isArray(bruto) ? bruto[0] : bruto;
  if (typeof k !== 'string' || !CHAVE.test(k))
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Pedido incompleto',
      'Falta a Idempotency-Key do pedido de gravação.',
    );
  if (k !== doCorpo)
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Pedido inconsistente',
      'A chave do corpo difere da Idempotency-Key.',
      {
        campos: ['chave'],
      },
    );
  return k;
}

/** O cabeçalho das telas do bloco (o paciente, a cirurgia, as alergias e os exames), também no checklist (M46.2). */
export async function montarContextoAnestesia(
  cirurgia: PortaCirurgia,
  s: SessaoCadastro,
  c: ContextoAnestesia,
): Promise<ContextoAnestesiaResposta> {
  const [ag, nomes, procs] = await Promise.all([
    cirurgia.agendamento(s.porta, c.agendamento),
    c.anestesistaAgendado ? cirurgia.nomesProfissionais(s.porta, [c.anestesistaAgendado]) : new Map(),
    cirurgia.nomesProcedimentos(s.porta, [c.procedimento]),
  ]);
  return {
    agendamento: c.agendamento,
    reg: c.reg,
    atendimento: c.atendimento,
    paciente: c.paciente,
    nome: ag?.paciente?.trim() || null,
    sala: c.sala,
    dataHora: instanteT(c.inicio),
    procedimento: procs.get(c.procedimento) ?? null,
    tipoAnestesiaAgendado: c.tipoAnestesiaAgendado,
    anestesistaAgendado: c.anestesistaAgendado,
    anestesistaAgendadoNome: c.anestesistaAgendado ? (nomes.get(c.anestesistaAgendado) ?? null) : null,
    alergias: c.alergias.map((a) => ({ alergia: a.alergia, nome: a.nome })),
    examesRecentes: c.exames.map((x) => ({ id: x.id, exame: x.exame, data: x.data, liberado: x.liberado })),
    truncado: c.examesTruncado,
    pesoKg: c.pesoKg,
    alturaCm: c.alturaCm,
    creatinina: c.creatinina,
    medicacoesEmUso: [...c.medicacoes],
    medicacoesTruncado: c.medicacoesTruncado,
  };
}

@Controller('cirurgia/anestesia')
export class AnestesiaController {
  private readonly apoio: ApoioGravacao<GravadorAnestesia>;
  private readonly cacheDominios = new Map<string, { em: number; d: DominiosFicha }>();

  constructor(
    @Inject(PORTA_ANESTESIA) private readonly porta: PortaAnestesia,
    @Inject(PORTA_CIRURGIA) private readonly cirurgia: PortaCirurgia,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(PORTA_BALANCO) private readonly balanco: PortaBalanco | null = null,
    @Optional() @Inject(PORTA_SUPRIMENTOS) private readonly suprimentos: PortaSuprimentos | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) private readonly cache: CacheConfig | null = null,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
    @Optional() @Inject(TRAVA_INCISAO) private readonly trava: TravaIncisao | null = null,
  ) {
    this.apoio = new ApoioGravacao(
      {
        chave: CHAVE_LIBERACAO_ANESTESIA,
        nome: 'a avaliação pré-anestésica, a ficha anestésica e a recuperação pós-anestésica',
        operacoes: {},
      },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  // ── Apoio ──────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Os domínios da ficha: no cache compartilhado (Valkey) por estabelecimento, 1 h; sem ele, na memória do processo. */
  private async dominios(s: SessaoCadastro): Promise<DominiosFicha> {
    if (this.cache)
      return this.cache.lerOuCarregar(
        this.cache.chave(s.rede, s.hospital, 'dominios-anestesia'),
        CACHE_DOMINIOS_MS / 1000,
        () => this.porta.dominios(s.porta),
      );
    const k = `${s.rede}:${s.hospital}`;
    const c = this.cacheDominios.get(k);
    if (c && Date.now() - c.em < CACHE_DOMINIOS_MS) return c.d;
    const d = await this.porta.dominios(s.porta);
    this.cacheDominios.set(k, { em: Date.now(), d });
    return d;
  }

  private async agora(s: SessaoCadastro): Promise<string> {
    const r = await this.cirurgia.relogio(s.porta);
    return `${r.hoje}T${r.hhmm.slice(0, 2)}:${r.hhmm.slice(2, 4)}`;
  }

  private naoNoFuturo(agora: string, ...momentos: (string | null | undefined)[]): void {
    const limite = minutosDoInstante(agora) + TOLERANCIA_FUTURO_MIN;
    if (momentos.some((m) => m && minutosDoInstante(m) > limite))
      throw recusaAnestesia('anestesia-horario-futuro');
  }

  private async contextoLido(s: SessaoCadastro, agenda: number): Promise<ContextoAnestesia> {
    const c = await this.porta.contexto(s.porta, agenda);
    if (!c)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Cirurgia não encontrada',
        'O agendamento não existe mais (pode ter sido cancelado).',
      );
    return c;
  }

  private contexto(s: SessaoCadastro, c: ContextoAnestesia): Promise<ContextoAnestesiaResposta> {
    return montarContextoAnestesia(this.cirurgia, s, c);
  }

  private async registros(s: SessaoCadastro): Promise<readonly number[]> {
    return (await this.porta.profissional(s.porta, s.login))?.registros ?? [];
  }

  /**
   * Revisão do M46.1 (regra 3, ficha §8): só o MÉDICO com o papel de anestesista na cirurgia assina. Dos registros da
   * sessão, ficam os de médico (conselho CRM ou CBO 225…); quem não é médico não vira assinante, mesmo que esteja na
   * linha de responsabilidade ou na equipe (linha antiga ou gravada por outro caminho).
   */
  private async registrosMedicos(
    s: SessaoCadastro,
    registros: readonly number[],
  ): Promise<readonly number[]> {
    if (registros.length === 0) return [];
    const ps = await this.cirurgia.profissionaisPorRegistro(s.porta, registros);
    return registros.filter((r) => ps.some((p) => p.id === r && p.medico === true));
  }

  /** O registro escolhido como anestesista (passagem ou equipe com a função de anestesista) tem de ser de médico. */
  private exigirMedico(p: { medico?: boolean } | undefined, campo: string): void {
    if (p?.medico !== true)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'O anestesista tem de ser médico (registro no conselho de medicina).',
        { campos: [campo], codigo: 'ficha-anestesista-nao-medico' },
      );
  }

  private async estadoAgendamento(s: SessaoCadastro, agenda: number): Promise<EstadoAgendamento> {
    const m = await this.cirurgia.estadosDosAgendamentos(s.porta, [agenda]);
    const e = m.get(agenda)?.estado;
    return (e ?? 'confirmado') as EstadoAgendamento;
  }

  private async negar(s: SessaoCadastro, recurso: string): Promise<void> {
    await this.trilha
      .registrar({
        evento: E.permissaoNegada.codigo,
        rede: s.rede,
        hospital: s.hospital,
        usuario: s.login,
        estacao: estacaoDaRequisicao(s.req),
        correlacao: correlacaoDaRequisicao(s.req, 'negada'),
        recurso: recurso.slice(0, 80),
        resultado: 'falha',
      })
      .catch(() => undefined);
  }

  private dominiosResposta(d: DominiosFicha): DominiosFichaResposta {
    return {
      tiposAnestesia: d.tiposAnestesia,
      posicoes: d.posicoes,
      modosRespiratorios: d.modosRespiratorios,
      funcoesEquipe: d.funcoesEquipe,
      tiposSinalLegado: d.tiposSinal,
      utilizacoes: d.utilizacoes,
    };
  }

  // ── Escolha e apoio das telas ──────────────────────────────────────────────────────────────────────────────────

  @Get('cirurgias')
  @Permissao(P.srpaLer)
  @Auditar(E.anestesiaLida.codigo)
  async cirurgias(
    @Query('data') data: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<CirurgiasParaAnestesiaResposta> {
    const s = sessaoDe(req);
    const dia = data && DATA.test(data) ? data : (await this.agora(s)).slice(0, 10);
    req.sghAlvo = { tabelaAlvo: 'agendamento_cirurgico' };
    const { itens, truncado } = await this.cirurgia.agendamentos(s.porta, dia, dia, null);
    const [sit, procs] = await Promise.all([
      this.porta.situacoes(
        s.porta,
        itens.map((a) => a.id),
      ),
      this.cirurgia.nomesProcedimentos(s.porta, [...new Set(itens.map((a) => a.procedimento))]),
    ]);
    return {
      data: dia,
      truncado,
      itens: itens.map((a) => {
        const x = sit.get(a.id);
        return {
          agendamento: a.id,
          sala: a.sala,
          inicio: instanteT(a.inicio),
          paciente: a.paciente.trim(),
          procedimento: procs.get(a.procedimento) ?? null,
          apa: (x?.apa ?? null) as ConclusaoApa | null,
          ficha: (x?.ficha ?? null) as CirurgiasParaAnestesiaResposta['itens'][number]['ficha'],
          srpa: (x?.srpa ?? null) as CirurgiasParaAnestesiaResposta['itens'][number]['srpa'],
        };
      }),
    };
  }

  @Get('dominios')
  @Permissao(P.fichaLer)
  async dominiosDaFicha(@Req() req: RequisicaoAutorizada): Promise<DominiosFichaResposta> {
    return this.dominiosResposta(await this.dominios(sessaoDe(req)));
  }

  @Get('profissionais')
  @Permissao(P.fichaRegistrar)
  async profissionais(@Query('q') q: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.cirurgia.buscarProfissionais(sessaoDe(req).porta, (q ?? '').slice(0, 60));
  }

  @Get('itens')
  @Permissao(P.fichaRegistrar)
  async itens(@Query('q') q: string | undefined, @Req() req: RequisicaoAutorizada) {
    const t = (q ?? '').trim().slice(0, 60);
    if (t.length < 2 || !this.suprimentos) return [];
    const l = await this.suprimentos.buscarItens(sessaoDe(req).porta, t);
    return l.slice(0, 30).map((i) => ({ codigo: i.codigo, nome: i.nome, unidade: i.unidade }));
  }

  // ── APA ────────────────────────────────────────────────────────────────────────────────────────────────────────

  @Get(':agenda/apa')
  @Permissao(P.apaLer)
  @Auditar(E.anestesiaLida.codigo)
  async apa(@Param('agenda') agenda: string, @Req() req: RequisicaoAutorizada): Promise<TelaApaResposta> {
    const s = sessaoDe(req);
    const c = await this.contextoLido(s, idDaRota(agenda));
    req.sghAlvo = {
      ...(c.paciente !== null ? { paciente: c.paciente } : {}),
      tabelaAlvo: 'avaliacao_pre_anestesica',
    };
    const [contexto, apas, d, gravacao] = await Promise.all([
      this.contexto(s, c),
      this.porta.apas(s.porta, c.agendamento),
      this.dominios(s),
      this.apoio.gravacao(s, EXTRAS),
    ]);
    const v = apas[0] ?? null;
    let vigente: ApaResposta | null = null;
    if (v) {
      const nomes = await this.cirurgia.nomesProfissionais(s.porta, [v.profissional]);
      const jejum = avaliarJejum(v.jejum, contexto.dataHora);
      vigente = {
        id: v.id,
        agendamento: v.agendamento,
        versao: v.versao,
        avaliadoEm: v.avaliadoEm,
        avaliadoPor: v.profissional,
        avaliadoPorNome: nomes.get(v.profissional) ?? null,
        asa: v.asa as ClasseAsa,
        emergencia: v.emergencia,
        rotuloAsa: rotuloAsa(v.asa as ClasseAsa, v.emergencia),
        lee: indiceLee(v.criteriosLee),
        jejum,
        conclusao: v.conclusao as ConclusaoApa,
        fechaPendencia: conclusaoLibera(v.conclusao as ConclusaoApa),
        registroProntuario: v.registroProntuario,
        pesoKg: v.pesoKg,
        alturaCm: v.alturaCm,
        viaAerea: v.viaAerea,
        ultimaIngestao: v.jejum,
        criteriosLee: v.criteriosLee,
        alergiasConferidas: v.alergiasConferidas,
        comorbidades: v.comorbidades,
        medicacoesEmUso: v.medicacoes,
        examesConsiderados: v.exames,
        anestesiasAnteriores: v.anestesiasAnteriores,
        plano: v.plano,
        ressalvas: v.ressalvas,
        usuario: v.usuario,
      };
    }
    return {
      contexto,
      vigente,
      versoes: apas.map((x) => ({
        versao: x.versao,
        avaliadoEm: x.avaliadoEm,
        conclusao: x.conclusao as ConclusaoApa,
        usuario: x.usuario,
      })),
      tiposAnestesia: d.tiposAnestesia,
      gravacao,
    };
  }

  @Post(':agenda/apa')
  @HttpCode(201)
  @Permissao(P.apaRegistrar)
  @AuditadoNoHandler(
    'cirurgia.registrarApa: avaliacao_pre_anestesica (e pendencia_agendamento_cirurgico) com a trilha de auditoria na mesma transação',
  )
  async registrarApa(
    @Param('agenda') agenda: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAnestesia> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarApa, b);
    const id = idDaRota(agenda);
    if (e.agendamento !== id)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido inconsistente',
        'O agendamento do corpo difere da rota.',
      );
    const chave = chaveDoPedidoAnestesia(s, e.chave);
    const [c, registros, d, estado, agora] = await Promise.all([
      this.contextoLido(s, id),
      this.registros(s),
      this.dominios(s),
      this.estadoAgendamento(s, id),
      this.agora(s),
    ]);
    if (registros.length === 0) throw SEM_REGISTRO();
    this.naoNoFuturo(agora, e.avaliadoEm);
    if (!d.tiposAnestesia.some((t) => t.id === e.plano.tipoAnestesia))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'Escolha o tipo de anestesia da lista.',
        {
          campos: ['plano.tipoAnestesia'],
        },
      );
    const conf = conferirApa({ ...e, asa: e.asa as ClasseAsa }, instanteT(c.inicio), estado);
    if (conf.recusas.length > 0) throw recusaAnestesia(conf.recusas[0]!, 'Avaliação pré-anestésica');
    const profissional =
      c.anestesistaAgendado !== null && registros.includes(c.anestesistaAgendado)
        ? c.anestesistaAgendado
        : registros[0]!;
    const r = await this.apoio.sgh(
      s,
      E.apaRegistrada.codigo,
      P.apaRegistrar,
      (x: { id: number; versao: number }) => ({
        tabela: 'avaliacao_pre_anestesica',
        id: String(x.id),
        paciente: c.paciente,
        chave: `${id}:v${x.versao}`,
      }),
      async (g) => {
        await this.conferirNaTransacao(g, id, true);
        return g.registrarApa({
          agendamento: id,
          sala: c.sala,
          dataHora: instanteT(c.inicio),
          reg: c.reg,
          paciente: c.paciente,
          versaoVista: e.versao,
          avaliadoEm: e.avaliadoEm,
          profissional,
          asa: e.asa,
          emergencia: e.emergencia,
          pesoKg: e.pesoKg,
          alturaCm: e.alturaCm,
          viaAerea: e.viaAerea,
          jejum: e.jejum,
          criteriosLee: e.criteriosLee,
          leePontos: conf.lee.pontos,
          alergiasConferidas: e.alergiasConferidas,
          comorbidades: e.comorbidades,
          medicacoes: e.medicacoesEmUso,
          exames: e.examesConsiderados,
          anestesiasAnteriores: e.anestesiasAnteriores,
          plano: e.plano,
          tipoAnestesia: e.plano.tipoAnestesia,
          conclusao: e.conclusao,
          ressalvas: e.ressalvas,
          pendencias: conf.pendenciasResolvidas,
          pendenciasAbertas: conf.pendenciasAbertas,
          usuario: s.login,
          chave,
        });
      },
    );
    const rotulo = CONCLUSOES_APA.find((x) => x.codigo === e.conclusao)?.rotulo ?? e.conclusao;
    return {
      ok: true,
      id: r.id,
      mensagem:
        `Avaliação pré-anestésica registrada (versão ${r.versao}): ${rotulo}.` +
        (r.pendencias.length > 0 ? ' A pendência de avaliação do agendamento foi resolvida.' : ''),
    };
  }

  // ── Ficha anestésica ───────────────────────────────────────────────────────────────────────────────────────────

  private async montarFichaResposta(
    s: SessaoCadastro,
    f: FichaAnestesica,
    o: { agora: string; agendado: number | null; dominios: DominiosFicha; registros: readonly number[] },
  ): Promise<{ resposta: FichaAnestesicaResposta; assinante: number | null }> {
    const m = montarFicha(f, {
      agora: o.agora,
      agendado: o.agendado,
      funcaoAnestesista: funcaoAnestesista(o.dominios),
      sessao: await this.registrosMedicos(s, o.registros),
    });
    const ids = new Set<number>([
      f.abertura,
      ...m.anestesistas,
      ...f.passagens.flatMap((p) => [p.de, p.para]),
    ]);
    for (const l of f.lancamentos) if (l.parte === 'equipe') ids.add(Number(l.dados['profissional']));
    if (f.assinadaPor) ids.add(f.assinadaPor);
    const nomes = await this.cirurgia.nomesProfissionais(s.porta, [...ids]);
    const mapa = (l: readonly { id: number; rotulo: string }[]) => new Map(l.map((x) => [x.id, x.rotulo]));
    const nomesDominio = {
      modos: mapa(o.dominios.modosRespiratorios),
      posicoes: mapa(o.dominios.posicoes),
      funcoes: mapa(o.dominios.funcoesEquipe),
      profissionais: nomes,
    };
    return {
      assinante: m.assinante,
      resposta: {
        id: f.id,
        agendamento: f.agendamento,
        versao: f.versao,
        situacao: f.situacao,
        marcos: f.marcos,
        lancamentos: f.lancamentos.map((l) => {
          const dsc = descreverLancamento(l, nomesDominio);
          return {
            id: l.id,
            parte: l.parte,
            momento: l.momento,
            fim: l.fim,
            descricao: dsc.descricao,
            valor: dsc.valor,
            unidade: dsc.unidade,
            registradoPor: l.profissional ?? 0,
            registradoEm: l.registradoEm,
            podeEncerrar:
              !l.fim &&
              (l.parte === 'gas' ||
                l.parte === 'evento' ||
                l.parte === 'fluido' ||
                l.parte === 'bi' ||
                l.parte === 'procedimento' ||
                (l.parte === 'medicamento' && l.dados['continua'] === 1)),
            noBalanco: l.parte === 'fluido' || l.parte === 'perda' ? l.balanco !== null : null,
            dados: l.dados,
          };
        }),
        lacunas: m.lacunas,
        responsaveis: m.responsaveis,
        totais: m.totais,
        assinadaPor: f.assinadaPor,
        assinadaEm: f.assinadaEm,
        pendenciasAssinatura: m.pendenciasAssinatura,
        hash: f.hash,
        anestesistas: [...m.anestesistas],
        responsavelAtual: responsavelAtual(m.responsaveis),
        passagens: f.passagens.map((p) => ({
          id: p.id,
          momento: p.momento,
          de: p.de,
          para: p.para,
          resumo: p.resumo,
        })),
        justificativas: f.lacunas.map((j) => ({ id: j.id, inicio: j.inicio, fim: j.fim, motivo: j.motivo })),
        adendos: f.adendos.map((a) => ({ id: a.id, texto: a.texto, profissional: a.profissional, em: a.em })),
        nomes: Object.fromEntries([...nomes].map(([k, v]) => [String(k), v])),
      },
    };
  }

  @Get(':agenda/ficha')
  @Permissao(P.fichaLer)
  @Auditar(E.anestesiaLida.codigo)
  async ficha(@Param('agenda') agenda: string, @Req() req: RequisicaoAutorizada): Promise<TelaFichaResposta> {
    const s = sessaoDe(req);
    const c = await this.contextoLido(s, idDaRota(agenda));
    req.sghAlvo = {
      ...(c.paciente !== null ? { paciente: c.paciente } : {}),
      tabelaAlvo: 'ficha_anestesica',
    };
    const [contexto, f, d, gravacao, agora, registros] = await Promise.all([
      this.contexto(s, c),
      this.porta.ficha(s.porta, c.agendamento),
      this.dominios(s),
      this.apoio.gravacao(s, EXTRAS),
      this.agora(s),
      this.registros(s),
    ]);
    const m = f
      ? await this.montarFichaResposta(s, f, {
          agora,
          agendado: c.anestesistaAgendado,
          dominios: d,
          registros,
        })
      : null;
    const preferido =
      c.anestesistaAgendado !== null && registros.includes(c.anestesistaAgendado)
        ? c.anestesistaAgendado
        : null;
    return {
      contexto,
      ficha: m?.resposta ?? null,
      dominios: this.dominiosResposta(d),
      agora,
      profissionalSessao: m?.assinante ?? preferido ?? registros[0] ?? null,
      gravacao,
    };
  }

  /** Abre a ficha na transação (o anestesista da sessão é o primeiro responsável) ou a relê travada. */
  /**
   * Revisão do M46.1: o contexto foi lido antes, fora da transação; na transação, o agendamento é relido (a linha da
   * agenda sumiu com o cancelamento por outro caminho: 404; a APA também recusa o agendamento realizado ou cancelado).
   */
  private async conferirNaTransacao(g: GravadorAnestesia, agendamento: number, apa = false): Promise<void> {
    const a = await g.agendamentoNaTransacao(agendamento);
    if (!a.existe)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Cirurgia não encontrada',
        'O agendamento não existe mais (pode ter sido cancelado).',
      );
    if (apa && (a.estado === 'realizado' || a.estado === 'cancelado'))
      throw recusaAnestesia('apa-agendamento-fechado', 'Avaliação pré-anestésica');
  }

  private async fichaNaTransacao(
    g: GravadorAnestesia,
    s: SessaoCadastro,
    c: ContextoAnestesia,
    o: { abrir: boolean; profissional: number | null; agora: string; chave: string; inicio?: string },
  ): Promise<FichaAnestesica> {
    await this.conferirNaTransacao(g, c.agendamento);
    const f = await g.ficha(c.agendamento);
    if (f) return f;
    if (!o.abrir) throw recusaAnestesia('ficha-sem-ficha', 'Ficha anestésica');
    if (o.profissional === null) throw SEM_REGISTRO();
    await g.abrirFicha({
      agendamento: c.agendamento,
      sala: c.sala,
      dataHora: instanteT(c.inicio),
      reg: c.reg,
      paciente: c.paciente,
      abertura: o.profissional,
      // A responsabilidade começa no primeiro horário registrado (o lote pode chegar depois, pela fila sem rede).
      abertaEm: o.inicio && minutosDoInstante(o.inicio) < minutosDoInstante(o.agora) ? o.inicio : o.agora,
      usuario: s.login,
      chave: o.chave,
    });
    const aberta = await g.ficha(c.agendamento);
    if (!aberta) throw recusaAnestesia('ficha-mudou', 'Ficha anestésica');
    return aberta;
  }

  private profissionalPreferido(c: ContextoAnestesia, registros: readonly number[]): number | null {
    if (c.anestesistaAgendado !== null && registros.includes(c.anestesistaAgendado))
      return c.anestesistaAgendado;
    return registros[0] ?? null;
  }

  private async paraGravar(
    s: SessaoCadastro,
    c: ContextoAnestesia,
    l: LancamentoFichaEntrada,
    o: {
      d: DominiosFicha;
      balanco: DominioDoBalanco | null;
      horaCorte: string;
      nomesItens: ReadonlyMap<number, string>;
    },
  ): Promise<LancamentoFicha> {
    const campo = (nome: string) =>
      new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Escolha o valor da lista.', {
        campos: [nome],
      });
    const balancoDe = (parte: 'fluido' | 'perda', tipo: string, rotulo: string) => {
      if (!o.balanco || c.atendimento === null || c.paciente === null) return null;
      const dp = deParaBalanco({ parte, tipo }, o.balanco);
      if (!dp) return null;
      return {
        paciente: c.paciente,
        atendimento: c.atendimento,
        grupo: dp.grupo,
        tipoEliminacao: dp.tipoEliminacao,
        descricao: `Ficha anestésica: ${rotulo}`.slice(0, 120),
        janelaInicio: janelaDoInstante(l.momento, o.horaCorte).inicio,
      };
    };
    switch (l.parte) {
      case 'sinal':
        return { parte: 'sinal', momento: l.momento, tipo: l.tipo, valor: l.valor };
      case 'medicamento':
        return {
          parte: 'medicamento',
          momento: l.momento,
          fim: l.continua ? l.fim : null,
          item: l.item,
          descricao: o.nomesItens.get(l.item) ?? null,
          dose: l.dose,
          unidade: l.unidade,
          via: l.via,
          continua: l.continua,
          observacao: l.observacao,
        };
      case 'gas':
        return { parte: 'gas', momento: l.momento, fim: l.fim, gas: l.gas, valor: l.valor };
      case 'fluido':
        return {
          parte: 'fluido',
          momento: l.momento,
          fim: l.fim,
          fluido: l.fluido,
          item: l.item,
          volumeMl: l.volumeMl,
          observacao: l.observacao,
          balanco: balancoDe(
            'fluido',
            l.fluido,
            descreverLancamento({ parte: 'fluido', dados: { fluido: l.fluido } }).descricao,
          ),
        };
      case 'perda':
        return {
          parte: 'perda',
          momento: l.momento,
          perda: l.perda,
          volumeMl: l.volumeMl,
          observacao: l.observacao,
          balanco: balancoDe(
            'perda',
            l.perda,
            descreverLancamento({ parte: 'perda', dados: { perda: l.perda } }).descricao,
          ),
        };
      case 'evento':
        return { parte: 'evento', momento: l.momento, fim: l.fim, evento: l.evento, descricao: l.descricao };
      case 'modoRespiratorio':
        if (!o.d.modosRespiratorios.some((x) => x.id === l.modo)) throw campo('modo');
        return { parte: 'modoRespiratorio', momento: l.momento, modo: l.modo, observacao: l.observacao };
      case 'posicao':
        if (!o.d.posicoes.some((x) => x.id === l.posicao)) throw campo('posicao');
        return { parte: 'posicao', momento: l.momento, posicao: l.posicao, observacao: l.observacao };
      case 'equipe': {
        if (!o.d.funcoesEquipe.some((x) => x.id === l.funcao)) throw campo('funcao');
        const [p] = await this.cirurgia.profissionaisPorRegistro(s.porta, [l.profissional.id]);
        if (!p || p.cod !== l.profissional.cod) throw campo('profissional');
        if (l.funcao === funcaoAnestesista(o.d)) this.exigirMedico(p, 'profissional');
        return {
          parte: 'equipe',
          momento: l.momento,
          profissional: l.profissional.id,
          cod: l.profissional.cod,
          funcao: l.funcao,
        };
      }
      case 'procedimento':
        return {
          parte: 'procedimento',
          momento: l.momento,
          fim: l.fim,
          codigo: l.codigo,
          descricao: l.descricao,
          observacao: l.observacao,
        };
      case 'exame':
        return { parte: 'exame', momento: l.momento, exame: l.exame, resultado: l.resultado };
      case 'avulso':
        return { parte: 'avulso', momento: l.momento, descricao: l.descricao, quantidade: l.quantidade };
      case 'bi':
        return {
          parte: 'bi',
          momento: l.momento,
          fim: l.fim,
          item: l.item,
          descricao: o.nomesItens.get(l.item) ?? null,
          vazao: l.vazao,
          unidade: l.unidade,
          observacao: l.observacao,
        };
    }
  }

  private async dominioDoBalanco(s: SessaoCadastro): Promise<DominioDoBalanco | null> {
    if (!this.balanco) return null;
    try {
      const d = await this.balanco.dominios(s.porta);
      return { grupos: d.grupos, tiposEliminacao: d.tiposEliminacao };
    } catch {
      return null;
    }
  }

  private async horaCorte(s: SessaoCadastro): Promise<string> {
    try {
      return horaDoCorte(
        String((await this.apoio.parametroValor(s, PARAMETRO_BALANCO_HORA_CORTE)) ?? '0700'),
      );
    } catch {
      return '07:00';
    }
  }

  @Post(':agenda/ficha/lancamentos')
  @HttpCode(201)
  @Permissao(P.fichaRegistrar)
  @AuditadoNoHandler(
    'cirurgia.registrarFichaAnestesica: ficha_anestesica e lancamento_ficha_anestesica com a trilha de auditoria na mesma transação',
  )
  async lancar(
    @Param('agenda') agenda: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAnestesia> {
    const s = sessaoDe(req);
    const e = corpo(esquemaLancarFicha, b);
    const id = idDaRota(agenda);
    if (e.agendamento !== id)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido inconsistente',
        'O agendamento do corpo difere da rota.',
      );
    const chave = chaveDoPedidoAnestesia(s, e.chave);
    const [c, registros, d, agora] = await Promise.all([
      this.contextoLido(s, id),
      this.registros(s),
      this.dominios(s),
      this.agora(s),
    ]);
    this.naoNoFuturo(agora, ...e.lancamentos.flatMap((l) => [l.momento, 'fim' in l ? l.fim : null]));
    const temBalanco = e.lancamentos.some((l) => l.parte === 'fluido' || l.parte === 'perda');
    const itens = [
      ...new Set(
        e.lancamentos.flatMap((l) => (l.parte === 'medicamento' || l.parte === 'bi' ? [l.item] : [])),
      ),
    ];
    const [balanco, horaCorte, nomesItens] = await Promise.all([
      temBalanco ? this.dominioDoBalanco(s) : null,
      temBalanco ? this.horaCorte(s) : '07:00',
      this.nomesItens(s, itens),
    ]);
    const lancamentos: LancamentoFicha[] = [];
    for (const l of e.lancamentos)
      lancamentos.push(await this.paraGravar(s, c, l, { d, balanco, horaCorte, nomesItens }));
    const profissional = this.profissionalPreferido(c, registros);
    const r = await this.apoio.sgh(
      s,
      E.fichaAnestesicaLancada.codigo,
      P.fichaRegistrar,
      (x: { ficha: number; ids: number[] }) => ({
        tabela: 'ficha_anestesica',
        id: String(x.ficha),
        paciente: c.paciente,
        chave: `${id}:${x.ids.length}`,
      }),
      async (g) => {
        const inicio = e.lancamentos.map((l) => l.momento).sort()[0];
        const f = await this.fichaNaTransacao(g, s, c, {
          abrir: true,
          profissional,
          agora,
          chave,
          ...(inicio ? { inicio } : {}),
        });
        const k = conferirLancamentos(
          f.situacao,
          f.marcos,
          e.lancamentos.map((l) => ({
            parte: l.parte,
            momento: l.momento,
            fim: 'fim' in l ? l.fim : null,
            ...(l.parte === 'sinal' ? { tipo: l.tipo, valor: l.valor } : {}),
          })),
        );
        if (!k.ok) throw recusaAnestesia(k.codigo, 'Ficha anestésica');
        await g.subirVersao({ ficha: f.id, versaoVista: f.versao, usuario: s.login });
        const x = await g.lancar({ ficha: f.id, lancamentos, profissional, usuario: s.login, chave });
        return { ficha: f.id, ...x };
      },
    );
    const n = r.ids.length;
    return {
      ok: true,
      id: r.ficha,
      mensagem:
        (n === 1 ? 'Lançamento registrado na ficha.' : `${n} lançamentos registrados na ficha.`) +
        (r.noBalanco > 0 ? ` ${r.noBalanco} levado(s) ao balanço hídrico.` : ''),
    };
  }

  private async nomesItens(s: SessaoCadastro, itens: readonly number[]): Promise<Map<number, string>> {
    const m = new Map<number, string>();
    if (!this.suprimentos || itens.length === 0) return m;
    await Promise.all(
      itens.slice(0, 20).map(async (i) => {
        const l = await this.suprimentos!.buscarItens(s.porta, String(i)).catch(() => []);
        const x = l.find((y) => y.codigo === i);
        if (x) m.set(i, x.nome);
      }),
    );
    return m;
  }

  @Post(':agenda/ficha/marcos')
  @HttpCode(201)
  @Permissao(P.fichaRegistrar)
  @AuditadoNoHandler(
    'cirurgia.registrarFichaAnestesica (marco): ficha_anestesica com a trilha de auditoria na mesma transação',
  )
  async marcar(
    @Param('agenda') agenda: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAnestesia> {
    const s = sessaoDe(req);
    const e = corpo(esquemaMarcarTempoFicha, b);
    const id = idDaRota(agenda);
    if (e.agendamento !== id)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido inconsistente',
        'O agendamento do corpo difere da rota.',
      );
    const chave = chaveDoPedidoAnestesia(s, e.chave);
    // M46 (etapa 2, regra 2): o início da cirurgia é a incisão; com a trava ligada, só depois da pausa cirúrgica.
    if (e.marco === 'inicioCirurgia') await this.trava?.conferir(s, { agendamento: id, incisao: e.momento });
    const [c, registros, agora] = await Promise.all([
      this.contextoLido(s, id),
      this.registros(s),
      this.agora(s),
    ]);
    this.naoNoFuturo(agora, e.momento);
    const profissional = this.profissionalPreferido(c, registros);
    const r = await this.apoio.sgh(
      s,
      E.fichaAnestesicaLancada.codigo,
      P.fichaRegistrar,
      (x: { ficha: number }) => ({
        tabela: 'ficha_anestesica',
        id: String(x.ficha),
        paciente: c.paciente,
        chave: `${id}:${e.marco}`,
      }),
      async (g) => {
        const f = await this.fichaNaTransacao(g, s, c, {
          abrir: true,
          profissional,
          agora,
          chave,
          inicio: e.momento,
        });
        if (f.situacao === 'assinada') throw recusaAnestesia('ficha-assinada', 'Ficha anestésica');
        const k = conferirMarco(f.marcos, e.marco, e.momento);
        if (!k.ok) throw recusaAnestesia(k.codigo, 'Ficha anestésica');
        await g.subirVersao({
          ficha: f.id,
          versaoVista: f.versao,
          usuario: s.login,
          marco: { marco: e.marco, momento: e.momento },
          situacao: situacaoDepoisDoMarco(f.situacao, e.marco),
        });
        return { ficha: f.id };
      },
    );
    return { ok: true, id: r.ficha, mensagem: 'Tempo registrado na ficha.' };
  }

  @Post(':agenda/ficha/lancamentos/:lancamento/encerrar')
  @HttpCode(201)
  @Permissao(P.fichaRegistrar)
  @AuditadoNoHandler(
    'cirurgia.registrarFichaAnestesica (fim): lancamento_ficha_anestesica com a trilha de auditoria na mesma transação',
  )
  async encerrar(
    @Param('agenda') agenda: string,
    @Param('lancamento') lancamento: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAnestesia> {
    const s = sessaoDe(req);
    const e = corpo(esquemaEncerrarLancamentoFicha, b);
    const id = idDaRota(agenda);
    if (e.agendamento !== id || e.lancamento !== idDaRota(lancamento))
      throw new ErroProblema('entrada-invalida', 400, 'Pedido inconsistente', 'O corpo difere da rota.');
    chaveDoPedidoAnestesia(s, e.chave);
    const [c, agora] = await Promise.all([this.contextoLido(s, id), this.agora(s)]);
    this.naoNoFuturo(agora, e.fim);
    const r = await this.apoio.sgh(
      s,
      E.fichaAnestesicaLancada.codigo,
      P.fichaRegistrar,
      (x: { ficha: number }) => ({
        tabela: 'ficha_anestesica',
        id: String(x.ficha),
        paciente: c.paciente,
        chave: `${id}:fim:${e.lancamento}`,
      }),
      async (g) => {
        const f = await this.fichaNaTransacao(g, s, c, {
          abrir: false,
          profissional: null,
          agora,
          chave: e.chave,
        });
        if (f.situacao === 'assinada') throw recusaAnestesia('ficha-assinada', 'Ficha anestésica');
        await g.subirVersao({ ficha: f.id, versaoVista: f.versao, usuario: s.login });
        await g.encerrar({ ficha: f.id, lancamento: e.lancamento, fim: e.fim, usuario: s.login });
        return { ficha: f.id };
      },
    );
    return { ok: true, id: r.ficha, mensagem: 'Fim registrado.' };
  }

  @Post(':agenda/ficha/passagem')
  @HttpCode(201)
  @Permissao(P.fichaRegistrar)
  @AuditadoNoHandler(
    'cirurgia.registrarFichaAnestesica (passagem): passagem_ficha_anestesica com a trilha de auditoria na mesma transação',
  )
  async passar(
    @Param('agenda') agenda: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAnestesia> {
    const s = sessaoDe(req);
    const e = corpo(esquemaPassarResponsabilidade, b);
    const id = idDaRota(agenda);
    if (e.agendamento !== id)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido inconsistente',
        'O agendamento do corpo difere da rota.',
      );
    const chave = chaveDoPedidoAnestesia(s, e.chave);
    const [c, registros, agora, para] = await Promise.all([
      this.contextoLido(s, id),
      this.registros(s),
      this.agora(s),
      this.cirurgia.profissionaisPorRegistro(sessaoDe(req).porta, [e.para.id]),
    ]);
    this.naoNoFuturo(agora, e.momento);
    if (!para[0] || para[0].cod !== e.para.cod)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Escolha o anestesista da lista.', {
        campos: ['para'],
      });
    this.exigirMedico(para[0], 'para');
    const r = await this.apoio.sgh(
      s,
      E.fichaAnestesicaPassagem.codigo,
      P.fichaRegistrar,
      (x: { ficha: number; id: number }) => ({
        tabela: 'passagem_ficha_anestesica',
        id: String(x.id),
        paciente: c.paciente,
        chave: `${id}:${e.para.id}`,
      }),
      async (g) => {
        const f = await this.fichaNaTransacao(g, s, c, { abrir: false, profissional: null, agora, chave });
        if (f.situacao === 'assinada') throw recusaAnestesia('ficha-assinada', 'Ficha anestésica');
        const linha = linhaDeResponsabilidade({ anestesista: f.abertura, de: f.abertaEm }, f.passagens);
        const atual = responsavelAtual(linha);
        const quem = registros.find((x) => x === atual) ?? registros[0] ?? -1;
        const k = conferirPassagem(linha, quem, e.para.id, e.momento);
        if (!k.ok) throw recusaAnestesia(k.codigo, 'Passagem de responsabilidade');
        await g.subirVersao({ ficha: f.id, versaoVista: f.versao, usuario: s.login });
        const p = await g.passar({
          ficha: f.id,
          momento: e.momento,
          de: quem,
          para: e.para.id,
          paraCod: e.para.cod,
          resumo: e.resumo,
          usuario: s.login,
          chave,
        });
        return { ficha: f.id, id: p.id };
      },
    );
    return { ok: true, id: r.id, mensagem: 'Responsabilidade da anestesia transferida.' };
  }

  @Post(':agenda/ficha/lacunas')
  @HttpCode(201)
  @Permissao(P.fichaRegistrar)
  @AuditadoNoHandler(
    'cirurgia.registrarFichaAnestesica (lacuna): lacuna_ficha_anestesica com a trilha de auditoria na mesma transação',
  )
  async justificar(
    @Param('agenda') agenda: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAnestesia> {
    const s = sessaoDe(req);
    const e = corpo(esquemaJustificarLacuna, b);
    const id = idDaRota(agenda);
    if (e.agendamento !== id)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido inconsistente',
        'O agendamento do corpo difere da rota.',
      );
    const chave = chaveDoPedidoAnestesia(s, e.chave);
    if (minutosDoInstante(e.fim) <= minutosDoInstante(e.inicio))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'O fim tem de ser depois do início.',
        {
          campos: ['fim'],
        },
      );
    const [c, registros, agora] = await Promise.all([
      this.contextoLido(s, id),
      this.registros(s),
      this.agora(s),
    ]);
    this.naoNoFuturo(agora, e.fim);
    const r = await this.apoio.sgh(
      s,
      E.fichaAnestesicaLancada.codigo,
      P.fichaRegistrar,
      (x: { id: number }) => ({
        tabela: 'lacuna_ficha_anestesica',
        id: String(x.id),
        paciente: c.paciente,
        chave: `${id}:lacuna`,
      }),
      async (g) => {
        const f = await this.fichaNaTransacao(g, s, c, { abrir: false, profissional: null, agora, chave });
        if (f.situacao === 'assinada') throw recusaAnestesia('ficha-assinada', 'Ficha anestésica');
        await g.subirVersao({ ficha: f.id, versaoVista: f.versao, usuario: s.login });
        return g.justificar({
          ficha: f.id,
          inicio: e.inicio,
          fim: e.fim,
          motivo: e.motivo,
          profissional: this.profissionalPreferido(c, registros),
          usuario: s.login,
          chave,
        });
      },
    );
    return { ok: true, id: r.id, mensagem: 'Intervalo justificado na ficha.' };
  }

  @Post(':agenda/ficha/assinatura')
  @HttpCode(201)
  @Permissao(P.fichaAssinar)
  @AuditadoNoHandler(
    'cirurgia.registrarFichaAnestesica (assinatura): ficha_anestesica com a trilha de auditoria na mesma transação',
  )
  async assinar(
    @Param('agenda') agenda: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAnestesia> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAssinarFicha, b);
    const id = idDaRota(agenda);
    if (e.agendamento !== id)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido inconsistente',
        'O agendamento do corpo difere da rota.',
      );
    chaveDoPedidoAnestesia(s, e.chave);
    const [c, registros, d, agora] = await Promise.all([
      this.contextoLido(s, id),
      this.registros(s),
      this.dominios(s),
      this.agora(s),
    ]);
    const medicos = await this.registrosMedicos(s, registros);
    // A conferência fora da transação dá o 403 com a negação na trilha (quem não é anestesista da cirurgia).
    const lida = await this.porta.ficha(s.porta, id);
    if (!lida) throw recusaAnestesia('ficha-sem-ficha', 'Assinatura da ficha');
    const antes = montarFicha(lida, {
      agora,
      agendado: c.anestesistaAgendado,
      funcaoAnestesista: funcaoAnestesista(d),
      sessao: medicos,
    });
    if (antes.assinante === null) {
      await this.negar(s, P.fichaAssinar);
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Só o anestesista da cirurgia',
        'Só o médico anestesista desta cirurgia pode assinar a ficha.',
        { codigo: 'ficha-nao-e-anestesista' },
      );
    }
    await reautenticar(this.sessoes, this.resolvedor!, req, e.senha);
    const r = await this.apoio.sgh(
      s,
      E.fichaAnestesicaAssinada.codigo,
      P.fichaAssinar,
      (x: { ficha: number }) => ({
        tabela: 'ficha_anestesica',
        id: String(x.ficha),
        paciente: c.paciente,
        chave: `${id}:assinada`,
      }),
      async (g) => {
        const f = await this.fichaNaTransacao(g, s, c, {
          abrir: false,
          profissional: null,
          agora,
          chave: e.chave,
        });
        if (f.versao !== e.versao) throw recusaAnestesia('ficha-mudou', 'Assinatura da ficha');
        const m = montarFicha(f, {
          agora,
          agendado: c.anestesistaAgendado,
          funcaoAnestesista: funcaoAnestesista(d),
          sessao: medicos,
        });
        if (m.pendenciasAssinatura.length > 0 || m.assinante === null)
          throw recusaAnestesia(
            m.pendenciasAssinatura[0] ?? 'ficha-nao-e-anestesista',
            'Assinatura da ficha',
          );
        const hash = await impressaoFicha({
          agendamento: f.agendamento,
          marcos: f.marcos as Record<string, string>,
          lancamentos: f.lancamentos.map((l) => ({
            id: l.id,
            parte: l.parte,
            momento: l.momento,
            fim: l.fim,
            dados: l.dados,
          })),
          passagens: f.passagens.map((p) => ({
            momento: p.momento,
            de: p.de,
            para: p.para,
            resumo: p.resumo,
          })),
          lacunas: f.lacunas.map((j) => ({ inicio: j.inicio, fim: j.fim, motivo: j.motivo })),
        });
        await g.assinar({
          ficha: f.id,
          versaoVista: f.versao,
          profissional: m.assinante,
          hash,
          usuario: s.login,
        });
        return { ficha: f.id };
      },
    );
    return { ok: true, id: r.ficha, mensagem: 'Ficha anestésica assinada. Daqui em diante, só adendo.' };
  }

  @Post(':agenda/ficha/adendos')
  @HttpCode(201)
  @Permissao(P.fichaAssinar)
  @AuditadoNoHandler(
    'cirurgia.registrarFichaAnestesica (adendo): adendo_ficha_anestesica com a trilha de auditoria na mesma transação',
  )
  async adendo(
    @Param('agenda') agenda: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAnestesia> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAdendoFicha, b);
    const id = idDaRota(agenda);
    if (e.agendamento !== id)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido inconsistente',
        'O agendamento do corpo difere da rota.',
      );
    const chave = chaveDoPedidoAnestesia(s, e.chave);
    const [c, registros, d, agora] = await Promise.all([
      this.contextoLido(s, id),
      this.registros(s),
      this.dominios(s),
      this.agora(s),
    ]);
    const medicos = await this.registrosMedicos(s, registros);
    const lida = await this.porta.ficha(s.porta, id);
    if (!lida) throw recusaAnestesia('ficha-sem-ficha', 'Adendo');
    const m = montarFicha(lida, {
      agora,
      agendado: c.anestesistaAgendado,
      funcaoAnestesista: funcaoAnestesista(d),
      sessao: medicos,
    });
    if (m.assinante === null) {
      await this.negar(s, P.fichaAssinar);
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Só o anestesista da cirurgia',
        'Só o médico anestesista desta cirurgia inclui o adendo.',
        {
          codigo: 'ficha-nao-e-anestesista',
        },
      );
    }
    const r = await this.apoio.sgh(
      s,
      E.fichaAnestesicaAdendo.codigo,
      P.fichaAssinar,
      (x: { id: number }) => ({
        tabela: 'adendo_ficha_anestesica',
        id: String(x.id),
        paciente: c.paciente,
        chave: `${id}:adendo`,
      }),
      (g) =>
        g.adendo({ ficha: lida.id, texto: e.texto, profissional: m.assinante!, usuario: s.login, chave }),
    );
    return { ok: true, id: r.id, mensagem: 'Adendo incluído na ficha assinada.' };
  }

  // ── SRPA ───────────────────────────────────────────────────────────────────────────────────────────────────────

  private srpaResposta(
    c: ContextoAnestesia,
    h: readonly AvaliacaoRecuperacao[],
    agora: string,
  ): SrpaResposta {
    const serie = h.map((a) => ({
      momento: a.momento,
      em: a.em,
      aldrete: a.aldrete,
      dor: a.dor,
      nvpo: a.nvpo,
    }));
    const ultima = h.at(-1);
    const alta = h.find((a) => a.momento === 'alta');
    const impedimentos: RecusaAnestesia[] = alta
      ? ['srpa-ja-com-alta']
      : !ultima
        ? ['srpa-sem-admissao']
        : impedimentosDaAlta(serie, {
            em: agora,
            aldrete: ultima.aldrete,
            dor: ultima.dor,
            nvpo: ultima.nvpo,
            destino: 'unidade',
            motivoDestino: null,
          });
    return {
      agendamento: c.agendamento,
      reg: c.reg,
      avaliacoes: h.map((a) => ({
        id: a.id,
        momento: a.momento,
        em: a.em,
        aldrete: a.aldrete,
        total: a.total,
        dor: a.dor,
        nvpo: a.nvpo,
        registradoPor: a.profissional,
        usuario: a.usuario,
      })),
      regraVersao: REGRA_ALTA_SRPA_V1.versao,
      proximaAvaliacaoAte: proximaAvaliacaoAte(serie),
      podeDarAlta: impedimentos.length === 0,
      impedimentosAlta: impedimentos,
      alta: alta?.destino ? { em: alta.em, destino: alta.destino } : null,
      ultima: Math.max(0, ...h.map((a) => a.id)),
      avaliacaoVencida: avaliacaoVencida(serie, agora),
    };
  }

  @Get('srpa/quadro')
  @Permissao(P.srpaLer)
  @Auditar(E.anestesiaLida.codigo)
  async quadro(@Req() req: RequisicaoAutorizada): Promise<QuadroSrpaResposta> {
    const s = sessaoDe(req);
    req.sghAlvo = { tabelaAlvo: 'registro_recuperacao_anestesica' };
    const agora = await this.agora(s);
    // Os admitidos desde ontem (a recuperação que passa da meia-noite continua no quadro).
    const ontem = new Date(`${agora.slice(0, 10)}T00:00:00Z`);
    ontem.setUTCDate(ontem.getUTCDate() - 1);
    const [{ series, truncado }, gravacao] = await Promise.all([
      this.porta.quadroSrpa(s.porta, ontem.toISOString().slice(0, 10)),
      this.apoio.gravacao(s, EXTRAS),
    ]);
    const nomes = new Map(
      await Promise.all(
        series.map(async (h) => {
          const a = await this.cirurgia.agendamento(s.porta, h[0]!.agendamento);
          return [h[0]!.agendamento, a?.paciente?.trim() || null] as const;
        }),
      ),
    );
    const linhas: LinhaQuadroSrpa[] = series.map((h) => {
      const admissao = h.find((a) => a.momento === 'admissao')!;
      const serie = h.map((a) => ({
        momento: a.momento,
        em: a.em,
        aldrete: a.aldrete,
        dor: a.dor,
        nvpo: a.nvpo,
      }));
      const ultima = h.at(-1)!;
      const imp = impedimentosDaAlta(serie, {
        em: agora,
        aldrete: ultima.aldrete,
        dor: ultima.dor,
        nvpo: ultima.nvpo,
        destino: 'unidade',
        motivoDestino: null,
      });
      return {
        agendamento: admissao.agendamento,
        sala: admissao.sala,
        admitidoEm: admissao.em,
        ultimoTotal: ultima.total,
        avaliacaoVencida: avaliacaoVencida(serie, agora),
        podeDarAlta: imp.length === 0,
        proximaAte: proximaAvaliacaoAte(serie),
        permanenciaMin: Math.max(0, minutosDoInstante(agora) - minutosDoInstante(admissao.em)),
        paciente: nomes.get(admissao.agendamento) ?? null,
      };
    });
    return { linhas, truncado, agora, gravacao };
  }

  @Get(':agenda/srpa')
  @Permissao(P.srpaLer)
  @Auditar(E.anestesiaLida.codigo)
  async srpa(@Param('agenda') agenda: string, @Req() req: RequisicaoAutorizada): Promise<TelaSrpaResposta> {
    const s = sessaoDe(req);
    const c = await this.contextoLido(s, idDaRota(agenda));
    req.sghAlvo = {
      ...(c.paciente !== null ? { paciente: c.paciente } : {}),
      tabelaAlvo: 'registro_recuperacao_anestesica',
    };
    const [contexto, h, agora, gravacao] = await Promise.all([
      this.contexto(s, c),
      this.porta.srpa(s.porta, c.agendamento),
      this.agora(s),
      this.apoio.gravacao(s, EXTRAS),
    ]);
    return { contexto, srpa: this.srpaResposta(c, h, agora), agora, gravacao };
  }

  @Post(':agenda/srpa')
  @HttpCode(201)
  @Permissao(P.srpaRegistrar)
  @AuditadoNoHandler(
    'cirurgia.registrarSrpa: registro_recuperacao_anestesica com a trilha de auditoria na mesma transação',
  )
  async registrarSrpa(
    @Param('agenda') agenda: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAnestesia> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarSrpa, b);
    const id = idDaRota(agenda);
    if (e.agendamento !== id)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido inconsistente',
        'O agendamento do corpo difere da rota.',
      );
    const chave = chaveDoPedidoAnestesia(s, e.chave);
    const [c, registros, agora] = await Promise.all([
      this.contextoLido(s, id),
      this.registros(s),
      this.agora(s),
    ]);
    this.naoNoFuturo(agora, e.em);
    const evento = e.momento === 'alta' ? E.srpaAlta.codigo : E.srpaRegistrada.codigo;
    const r = await this.apoio.sgh(
      s,
      evento,
      P.srpaRegistrar,
      (x: { id: number }) => ({
        tabela: 'registro_recuperacao_anestesica',
        id: String(x.id),
        paciente: c.paciente,
        chave: `${id}:${e.momento}`,
      }),
      async (g) => {
        await this.conferirNaTransacao(g, id);
        const h = await g.srpa(id);
        const serie = h.map((a) => ({
          momento: a.momento,
          em: a.em,
          aldrete: a.aldrete,
          dor: a.dor,
          nvpo: a.nvpo,
        }));
        const ordem = conferirAvaliacao(serie, { momento: e.momento, em: e.em });
        if (!ordem.ok) throw recusaAnestesia(ordem.codigo, 'Recuperação pós-anestésica');
        if (e.momento === 'alta') {
          const imp = impedimentosDaAlta(serie, {
            em: e.em,
            aldrete: e.aldrete,
            dor: e.dor,
            nvpo: e.nvpo,
            destino: e.destino!,
            motivoDestino: e.motivoDestino,
          });
          if (imp.length > 0) throw recusaAnestesia(imp[0]!, 'Alta da recuperação');
        }
        return g.registrarSrpa({
          agendamento: id,
          sala: c.sala,
          dataHora: instanteT(c.inicio),
          reg: c.reg,
          paciente: c.paciente,
          cirurgia: null,
          momento: e.momento,
          em: e.em,
          aldrete: e.aldrete,
          dor: e.dor,
          nvpo: e.nvpo,
          pas: e.pas,
          pad: e.pad,
          fc: e.fc,
          spo2: e.spo2,
          temperatura: e.temperatura,
          observacao: e.observacao,
          destino: e.destino,
          motivoDestino: e.motivoDestino,
          regraVersao: e.momento === 'alta' ? REGRA_ALTA_SRPA_V1.versao : null,
          ultimaVista: e.ultimaVista,
          profissional: registros[0] ?? null,
          usuario: s.login,
          chave,
        });
      },
    );
    const msg =
      e.momento === 'admissao'
        ? 'Admissão na recuperação registrada.'
        : e.momento === 'alta'
          ? 'Alta da recuperação registrada.'
          : 'Avaliação registrada.';
    return { ok: true, id: r.id, mensagem: msg };
  }
}
