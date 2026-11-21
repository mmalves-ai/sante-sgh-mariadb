// Serviço dos escores e da classificação de pacientes (M45, etapa 2; ficha, seções 4, 5, 7 e 8, regras 1 a 4, 9 e 16):
// monta as telas (a unidade no turno com os últimos escores e as reavaliações vencidas; o paciente com o histórico, as
// escalas em formulário e as reavaliações; a carga da unidade) e decide no servidor o que a tela só mostra: o total
// sempre calculado (regra 3), a faixa pela regra vigente, o gatilho e a conduta, os cuidados preventivos decididos, a
// baixa e a programação das reavaliações, o aviso da central, a classificação por turno. O motor é
// @sgh/dominio-enfermagem.
import {
  CATEGORIAS_FUGULIN,
  type CargaDaUnidade,
  type ClassificacaoLida,
  type ClassificarPacienteEntrada,
  type AfericaoNews2Entrada,
  ESCALAS_ESCORE,
  type EscalaEscore,
  type EscalaReavaliada,
  type EscoreLido,
  type EscoresDaUnidade,
  type EscoresDoPaciente,
  type EscalaTev,
  esquemaFaixaEscore,
  type PendenciaProfilaxia,
  type FaixaEscore,
  type GatilhoEscore,
  type InstrumentoClassificacao,
  type PacienteEscoresUnidade,
  type ProgramarReavaliacaoEntrada,
  type PublicarRegraEscoreEntrada,
  type ReavaliacaoLida,
  type RegistrarEscoreEntrada,
  type RegraEscore,
  type ResultadoEscore,
  ROTULOS_ESCALA,
  ROTULOS_GATILHO,
  sha256Hex,
  SINAIS_VITAIS,
  type TipoSinalVital,
  type Turno,
} from '@sgh/contratos';
import {
  calcularEscala,
  calcularNews2,
  cargaDaUnidade,
  type AlertaReavaliacao,
  JANELA_ALERTA_NEWS2_HORAS,
  reavaliarAlertaNews2,
  chaveProgramada,
  classificar,
  conferirCuidados,
  conteudoCanonicoFaixas,
  cuidadosSugeridos,
  type EscalaDaTela,
  faixaDe,
  FAIXAS_DOR_COMPORTAMENTAL,
  problemasDasFaixas,
  programacaoPorMudancaDeQuadro,
  reavaliacoesDoPaciente,
  REGRAS_PADRAO,
  regrasVigentes,
  somarHoras,
  somarMinutos,
  turnoDoDia,
  turnoDoInstante,
  validarSinal,
  conferirEscalaTev,
  escoreTevVigente,
  PARAMETROS_TEV_PADRAO,
  type ParametrosTev,
  profilaxiaPendente,
  sugestaoProfilaxia,
} from '@sgh/dominio-enfermagem';
import type { EscoreRegistrado, NovoEstornoRegistro, Internado, OrigemEstorno } from './tipos.js';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoEscores, PortaEscores, RegistroDeEscore } from './escores-porta.js';
import type { PortaEnfermagem } from './porta.js';

export const CHAVE_ESCORES = 'enfermagem.escores';
/** A janela de leitura dos escores da unidade (o último de cada escala dos últimos 7 dias). */
const DIAS_UNIDADE = 7;
const DIAS_HISTORICO = 30;

const recusa = (codigo: string, detalhe: string, campos?: readonly string[]) =>
  new ErroProblema('recusa-de-negocio', 409, 'Não registrado', detalhe, {
    codigo,
    ...(campos ? { campos: [...campos] } : {}),
  });
const invalida = (codigo: string, detalhe: string, campos?: readonly string[]) =>
  new ErroProblema('entrada-invalida', 422, 'Registro incompleto', detalhe, {
    codigo,
    ...(campos ? { campos: [...campos] } : {}),
  });

export interface ParametrosEscores {
  readonly inicioTurnoDiurno: string;
  readonly intervaloHoras: number;
  readonly loginsMedico: readonly string[];
  readonly loginsTrr: readonly string[];
  /** W0-03, M1: a escala de TEV do paciente clínico e a do cirúrgico (padrão de mercado: Padua e Caprini). */
  readonly tev?: ParametrosTev;
}

export interface SessaoEscores {
  readonly c: ContextoEscores;
  readonly login: string;
}

/** A regra lida do banco no formato do contrato (faixas conferidas pelo esquema; a ilegível fica de fora). */
export function regraDoBanco(x: {
  escala: string;
  versao: number;
  faixas: unknown;
  impressao: string;
  publicadoEm: string;
  autor: string;
}): RegraEscore | null {
  const f = z.array(esquemaFaixaEscore).safeParse(x.faixas);
  if (!f.success || !(ESCALAS_ESCORE as readonly string[]).includes(x.escala)) return null;
  return {
    escala: x.escala as EscalaEscore,
    versao: x.versao,
    faixas: f.data,
    historica: false,
    origem: 'publicada pela gerência de enfermagem',
    impressao: x.impressao,
    publicadoEm: x.publicadoEm,
    autor: x.autor,
  };
}

/** Os sete parâmetros do NEWS2 (a aferição completa). */
export const PARAMETROS_NEWS2 = ['fr', 'spo2', 'o2', 'pas', 'fc', 'acvpu', 'temperatura'] as const;

export class ServicoEscores {
  constructor(
    private readonly porta: PortaEscores,
    private readonly enfermagem: PortaEnfermagem,
  ) {}

  /**
   * W0-03: o estorno ou a invalidação de um escore, classificação ou índice de UTI. O paciente, a escala e o gatilho
   * vêm do banco; o já estornado é recusado (409). No NEWS2, o alerta que ele disparou é reavaliado na hora (encerrado
   * ou mantido pelo NEWS2 válido mais recente das 12 h). Devolve o que gravar (fato novo) e a reavaliação.
   */
  async prepararEstorno(
    s: SessaoEscores,
    origem: OrigemEstorno,
    id: number,
    e: { tipo: 'estorno' | 'invalidacao'; motivo: string },
  ): Promise<{
    gravar: Omit<NovoEstornoRegistro, 'hospital'>;
    paciente: number;
    alerta: AlertaReavaliacao | null;
    /** Revisão W0-03 (D-CRUD-ORFAOS): o que está ligado ao escore só por código, para o aviso do estorno. */
    vinculados: { acionamentos: number; profilaxias: number; protocolos: number; reavaliacoes: number };
  }> {
    const r = await this.porta.registroParaEstorno(s.c, origem, id);
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Registro não encontrado');
    if (r.estornado)
      throw new ErroProblema('recusa-de-negocio', 409, 'Estorno', 'O registro já foi estornado.', {
        codigo: 'registro-ja-estornado',
      });
    let alerta: AlertaReavaliacao | null = null;
    if (origem === 'escore' && r.escala === 'news2') {
      const agora = await this.relogio(s.c);
      const outros = (
        await this.porta.escores(s.c, [r.paciente], somarHoras(agora, -JANELA_ALERTA_NEWS2_HORAS))
      )
        .filter((x) => x.escala === 'news2')
        .map((x) => ({ id: x.id, gatilho: x.gatilho, aferidoEm: x.aferidoEm, estornado: !!x.estorno }));
      alerta = reavaliarAlertaNews2({ id, gatilho: r.gatilho ?? 'nenhum' }, outros, agora);
    }
    // Revisão W0-03: o acionamento do TRR (acionamento_resposta_rapida.ID_ESCORE, só por código) e a decisão de profilaxia ligados ao
    // escore. Nada se apaga: o acionamento é fato real (fica, marcado com o escore estornado, e o tempo "do alerta ao
    // acionamento" sai do indicador); a decisão de profilaxia sai da lista com o escore.
    // A inclusão em protocolo do internado aberta pelo alerta (inclusao_protocolo_paciente.ID_ESCORE, só por código) também
    // fica: só é contada (a vigente, sem encerramento nem inativação) para o aviso dizer que segue aberta.
    // Revisão W0-03: as reavaliações de Braden e Morse que o escore cumpriu (reavaliacao_escala.ID_ESCORE) são
    // reabertas na transação do estorno (fato novo; a baixa original fica) e contadas aqui para o aviso.
    const vinculados = { acionamentos: 0, profilaxias: 0, protocolos: 0, reavaliacoes: 0 };
    if (origem === 'escore') {
      const [acs, decs, pros, reavs] = await Promise.all([
        this.porta.acionamentosDosEscores(s.c, [id]),
        this.porta.decisoesProfilaxia(s.c, [id]),
        this.porta.protocolosInternados(s.c, { escores: [id] }),
        r.escala === 'braden' || r.escala === 'morse'
          ? this.porta.reavaliacoes(s.c, [r.paciente], r.quando)
          : Promise.resolve([]),
      ]);
      vinculados.reavaliacoes = reavs.filter((x) => x.situacao === 'cumprida' && x.escore === id).length;
      vinculados.acionamentos = acs.filter((x) => !x.inativo).length;
      vinculados.profilaxias = decs.length;
      vinculados.protocolos = pros.filter(
        (p) => !p.eventos.some((e) => e.tipo === 'encerramento' || e.tipo === 'inativacao'),
      ).length;
    }
    return {
      paciente: r.paciente,
      alerta,
      vinculados,
      gravar: {
        origem,
        id,
        paciente: r.paciente,
        tipo: e.tipo,
        motivo: e.motivo,
        alerta: alerta?.alerta ?? null,
        escoreMantem: alerta?.escoreMantem ?? null,
        usuario: s.login,
      },
    };
  }

  /**
   * W0-03, M1: a profilaxia de TEV de cada paciente — o último escore de Caprini ou Padua válido (o estornado não conta)
   * e a decisão do prescritor, se houver. Só os que têm o gatilho de profilaxia entram.
   */
  async profilaxias(
    c: ContextoEscores,
    ultimos: readonly EscoreLido[],
    pacientes: readonly {
      paciente: number;
      atendimento: number | null;
      leito: string | null;
      nome: string | null;
    }[],
  ): Promise<PendenciaProfilaxia[]> {
    const vigentes = pacientes
      .map((p) => ({
        p,
        e: escoreTevVigente(
          ultimos.filter((x) => x.paciente === p.paciente).map((x) => ({ ...x, estornado: !!x.estorno })),
        ),
      }))
      .filter((x) => x.e && x.e.gatilho === 'profilaxia');
    if (!vigentes.length) return [];
    const decisoes = await this.porta.decisoesProfilaxia(
      c,
      vigentes.map((x) => x.e!.id),
    );
    // Revisão W0-03: a decisão anulada pelo autor reabre a pendência (o histórico segue legível).
    const decididos = new Set(decisoes.filter((d) => !d.anulada).map((d) => d.escore));
    return vigentes.map(({ p, e }) => {
      const lida = decisoes.find((x) => x.escore === e!.id) ?? null;
      const d = lida && !lida.anulada ? lida : null;
      return {
        escore: e!.id,
        paciente: p.paciente,
        atendimento: p.atendimento,
        leito: p.leito,
        nome: p.nome,
        escala: e!.escala as EscalaTev,
        versaoRegra: e!.versaoRegra,
        total: e!.total,
        faixa: e!.faixa,
        rotuloFaixa: e!.rotuloFaixa,
        sugestao: sugestaoProfilaxia(e!.escala, e!.faixa),
        aferidoEm: e!.aferidoEm,
        usuario: e!.usuario,
        decisao:
          d && !profilaxiaPendente(e!, decididos)
            ? { decisao: d.decisao, motivo: d.motivo, usuario: d.usuario, em: d.em }
            : null,
        historico: lida?.historico ?? [],
      };
    });
  }

  relogio(c: ContextoEscores): Promise<string> {
    return this.enfermagem.relogio(c);
  }

  async regras(
    c: ContextoEscores,
  ): Promise<{ vigentes: Record<EscalaEscore, RegraEscore>; publicadas: RegraEscore[] }> {
    const publicadas = (await this.porta.regras(c))
      .map(regraDoBanco)
      .filter((x): x is RegraEscore => x !== null);
    return { vigentes: regrasVigentes(publicadas), publicadas };
  }

  /** A faixa do escore gravado pela versão da regra que ele usou (a padrão ou a publicada). */
  private faixaDoGravado(
    e: EscoreRegistrado,
    publicadas: readonly RegraEscore[],
  ): { rotulo: string; risco: boolean } {
    const escala = e.escala as EscalaEscore;
    const regra =
      e.versaoRegra <= 1
        ? REGRAS_PADRAO[escala]
        : (publicadas.find((r) => r.escala === escala && r.versao === e.versaoRegra) ??
          REGRAS_PADRAO[escala]);
    const faixas: readonly FaixaEscore[] =
      escala === 'dor' && Object.keys(e.itens).includes('expressao')
        ? FAIXAS_DOR_COMPORTAMENTAL
        : (regra?.faixas ?? []);
    const f = faixas.find((x) => x.codigo === e.faixa) ?? faixaDe(faixas, e.total);
    if (e.faixa === 'baixoMedio') return { rotulo: 'Risco baixo a médio', risco: true };
    return { rotulo: f?.rotulo ?? e.faixa, risco: f?.risco ?? false };
  }

  lido(e: EscoreRegistrado, publicadas: readonly RegraEscore[]): EscoreLido {
    const f = this.faixaDoGravado(e, publicadas);
    return {
      id: e.id,
      paciente: e.paciente,
      reg: e.reg,
      unidade: e.unidade,
      escala: e.escala as EscalaEscore,
      versaoRegra: e.versaoRegra,
      itens: e.itens,
      total: e.total,
      faixa: e.faixa,
      rotuloFaixa: f.rotulo,
      risco: f.risco,
      gatilho: e.gatilho as GatilhoEscore,
      suspeitaInfeccao: e.suspeitaInfeccao,
      origem: e.origem,
      aferidoEm: e.aferidoEm,
      usuario: e.usuario,
      estorno: e.estorno ?? null,
    };
  }

  private ultimosPorEscala(escores: readonly EscoreLido[]): Partial<Record<EscalaEscore, EscoreLido>> {
    const r: Partial<Record<EscalaEscore, EscoreLido>> = {};
    for (const e of [...escores].sort((a, b) => b.aferidoEm.localeCompare(a.aferidoEm) || b.id - a.id))
      if (!r[e.escala]) r[e.escala] = e;
    return r;
  }

  /** As reavaliações de cada paciente (gravadas e calculadas), com as avaliações do novo e do formulário. */
  private async reavaliacoes(
    c: ContextoEscores,
    pacientes: readonly { paciente: number; reg: number }[],
    escores: readonly EscoreLido[],
    agora: string,
    intervaloHoras: number,
  ): Promise<{
    porPaciente: Map<number, ReavaliacaoLida[]>;
    formularios: Awaited<ReturnType<PortaEscores['escalasEmFormulario']>>;
  }> {
    const ids = pacientes.map((p) => p.paciente);
    const desde = somarHoras(agora, -DIAS_UNIDADE * 24);
    const [gravadas, formularios, internacoes] = await Promise.all([
      this.porta.reavaliacoes(c, ids, desde),
      this.porta.escalasEmFormulario(c, ids, desde),
      this.porta.internacoes(
        c,
        pacientes.map((p) => p.reg),
      ),
    ]);
    const porPaciente = new Map<number, ReavaliacaoLida[]>();
    for (const p of pacientes) {
      const avaliacoes = [
        ...escores
          .filter((e) => e.paciente === p.paciente && (e.escala === 'braden' || e.escala === 'morse'))
          .map((e) => ({
            escala: e.escala as EscalaReavaliada,
            quando: e.aferidoEm,
            origem: 'escore' as const,
          })),
        ...formularios
          .filter((f) => f.paciente === p.paciente && f.quando)
          .map((f) => ({ escala: f.escala, quando: f.quando!, origem: 'formulario' as const })),
      ];
      porPaciente.set(
        p.paciente,
        reavaliacoesDoPaciente({
          paciente: p.paciente,
          internadoEm: internacoes.find((i) => i.reg === p.reg)?.entrada ?? null,
          avaliacoes,
          gravadas: gravadas.filter((g) => g.paciente === p.paciente),
          agora,
          intervaloHoras,
        }),
      );
    }
    return { porPaciente, formularios };
  }

  /** A unidade no turno: os últimos escores de cada paciente, as reavaliações e os gatilhos abertos. */
  async unidade(
    s: SessaoEscores,
    unidade: string,
    p: ParametrosEscores,
    gravacao: EscoresDaUnidade['gravacao'],
  ): Promise<EscoresDaUnidade> {
    const c = s.c;
    const [agora, internados, regras] = await Promise.all([
      this.relogio(c),
      this.enfermagem.internados(c, unidade),
      this.regras(c),
    ]);
    const turno = turnoDoInstante(agora.slice(0, 16), p.inicioTurnoDiurno);
    // O último de cada escala por paciente (sem o teto de linhas do histórico: a UTI com NEWS2 frequente não esconde o
    // Braden e o Morse mais antigos, nem gera uma reavaliação vencida falsa).
    const brutos = await this.porta.ultimosEscores(
      c,
      internados.map((i) => i.paciente),
      somarHoras(agora, -DIAS_UNIDADE * 24),
    );
    const escores = brutos.map((e) => this.lido(e, regras.publicadas));
    const { porPaciente } = await this.reavaliacoes(
      c,
      internados.map((i) => ({ paciente: i.paciente, reg: i.numero })),
      escores,
      agora,
      p.intervaloHoras,
    );
    const pacientes: PacienteEscoresUnidade[] = internados.map((i) => {
      const meus = escores.filter((e) => e.paciente === i.paciente);
      const ultimos = this.ultimosPorEscala(meus);
      const reavs = porPaciente.get(i.paciente) ?? [];
      const news2 = ultimos.news2;
      const aberto =
        news2 && news2.gatilho !== 'nenhum' && news2.aferidoEm >= somarHoras(agora, -12)
          ? news2.gatilho
          : null;
      return {
        paciente: i.paciente,
        atendimento: i.atendimento,
        reg: i.numero,
        nome: i.nome,
        leito: i.leito,
        ultimos,
        reavaliacoesVencidas: reavs.filter((r) => r.vencida).length,
        reavaliacoes: reavs.filter((r) => r.situacao === 'pendente'),
        gatilhoAberto: aberto,
      };
    });
    const profilaxias = await this.profilaxias(
      c,
      escores,
      internados.map((i) => ({
        paciente: i.paciente,
        atendimento: i.atendimento,
        leito: i.leito,
        nome: i.nome,
      })),
    );
    return {
      unidade,
      agora,
      turno: { nome: turno.nome, inicio: turno.inicio, fim: turno.fim },
      pacientes,
      profilaxiasPendentes: profilaxias.filter((x) => x.decisao === null),
      resumo: {
        vencidas: pacientes.reduce((a, x) => a + x.reavaliacoesVencidas, 0),
        emRisco: pacientes.filter((x) => x.ultimos.braden?.risco || x.ultimos.morse?.risco).length,
        news2Alto: pacientes.filter((x) => (x.ultimos.news2?.total ?? 0) >= 7).length,
      },
      gravacao,
      regras: Object.values(regras.vigentes),
    };
  }

  /** O paciente: o histórico de 30 dias, os últimos, as reavaliações e as escalas em formulário. */
  async paciente(s: SessaoEscores, internado: Internado, p: ParametrosEscores): Promise<EscoresDoPaciente> {
    const c = s.c;
    const [agora, regras] = await Promise.all([this.relogio(c), this.regras(c)]);
    const desde = somarHoras(agora, -DIAS_HISTORICO * 24);
    const [brutos, ultimosBrutos] = await Promise.all([
      this.porta.escores(c, [internado.paciente], desde),
      this.porta.ultimosEscores(c, [internado.paciente], desde),
    ]);
    const historico = brutos.map((e) => this.lido(e, regras.publicadas));
    const ultimos = ultimosBrutos.map((e) => this.lido(e, regras.publicadas));
    const { porPaciente, formularios } = await this.reavaliacoes(
      c,
      [{ paciente: internado.paciente, reg: internado.numero }],
      ultimos,
      agora,
      p.intervaloHoras,
    );
    const [profilaxia] = await this.profilaxias(c, ultimos, [
      {
        paciente: internado.paciente,
        atendimento: internado.atendimento,
        leito: internado.leito,
        nome: internado.nome,
      },
    ]);
    return {
      paciente: internado.paciente,
      agora,
      profilaxia: profilaxia ?? null,
      ultimos: Object.values(this.ultimosPorEscala(ultimos)),
      historico: historico.slice(0, 200),
      reavaliacoes: porPaciente.get(internado.paciente) ?? [],
      formularios: formularios.map((f) => ({
        registro: f.registro,
        modelo: f.modelo,
        escala: f.modelo === 'ENF02' ? ('lesoes' as const) : f.escala,
        quando: f.quando,
        total: f.total,
        faixaFormulario: f.faixaFormulario,
      })),
    };
  }

  private avisosDoNews2(
    p: ParametrosEscores,
    gatilho: GatilhoEscore,
    sugereSepse: boolean,
    total: number,
    internado: Internado,
  ): RegistroDeEscore['avisos'] {
    if (gatilho === 'nenhum') return [];
    const trr = gatilho === 'trr';
    const logins = [...new Set([...(trr ? p.loginsTrr : []), ...p.loginsMedico])];
    const titulo = trr
      ? `NEWS2 ${total}: acionar o Time de Resposta Rápida (leito ${internado.leito})`
      : sugereSepse
        ? `NEWS2 ${total} com suspeita de infecção: avaliar o protocolo de sepse (leito ${internado.leito})`
        : `NEWS2 ${total}: avaliação médica urgente (leito ${internado.leito})`;
    return logins.map((login) => (escore: number) => ({
      login,
      tipo: 'escore-news2',
      gravidade: trr ? ('grave' as const) : ('atencao' as const),
      modulo: 'enfermagem',
      evento: 'enfermagem.escore.registrado',
      titulo: titulo.slice(0, 120),
      link: `/enfermagem/escores?atendimento=${internado.atendimento}`,
      objetoTabela: 'aplicacao_escala',
      objetoChave: String(escore),
    }));
  }

  /** W0-03, M1: o aviso da profilaxia de TEV sugerida aos prescritores da unidade (o mesmo parâmetro do médico). */
  private avisosDaProfilaxia(
    p: ParametrosEscores | null,
    escala: string,
    total: number,
    rotulo: string,
    internado: Internado,
  ): RegistroDeEscore['avisos'] {
    const titulo = `${escala === 'caprini' ? 'Caprini' : 'Padua'} ${total} (${rotulo}): decidir a profilaxia de TEV (leito ${internado.leito})`;
    return (p?.loginsMedico ?? []).map((login) => (escore: number) => ({
      login,
      tipo: 'escore-profilaxia-tev',
      gravidade: 'atencao' as const,
      modulo: 'enfermagem',
      evento: 'enfermagem.escore.registrado',
      titulo: titulo.slice(0, 120),
      link: `/enfermagem/escores?atendimento=${internado.atendimento}`,
      objetoTabela: 'aplicacao_escala',
      objetoChave: String(escore),
    }));
  }

  /** A aferição dos sete parâmetros: os sinais vitais e o NEWS2 na mesma gravação (regra 1). */
  async prepararAfericao(
    s: SessaoEscores,
    internado: Internado,
    e: AfericaoNews2Entrada,
    p: ParametrosEscores,
    /** M25: os sinais já gravados pela tela dos sinais vitais (o NEWS2 nasce deles; a origem é o primeiro). */
    jaGravados: { readonly sinalVital: number } | null = null,
  ): Promise<{ registro: RegistroDeEscore; resultado: Omit<ResultadoEscore, 'id' | 'mensagem'> }> {
    const agora = (await this.relogio(s.c)).slice(0, 16);
    const quando = (e.aferidoEm ?? agora).slice(0, 16);
    if (quando > agora || quando < somarMinutos(agora, -24 * 60))
      throw invalida('hora-fora', 'A hora da aferição é do futuro ou de mais de 24 horas.', ['aferidoEm']);
    const sinais = [];
    for (const [tipo, valor] of Object.entries(e.sinais) as [TipoSinalVital, number][]) {
      const v = validarSinal({ tipo, valor, confirmadoForaDaFaixa: e.confirmadoForaDaFaixa });
      if (!v.ok) throw invalida(v.codigo, v.mensagem, [tipo]);
      sinais.push({
        paciente: internado.paciente,
        atendimento: internado.atendimento,
        horario: null,
        tipo,
        valor,
        unidade: v.unidade || SINAIS_VITAIS[tipo].unidade,
        metodo: null,
        foraDaFaixa: v.foraDaFaixa,
        horaReal: `${quando}:00`,
        origemOffline: false,
        observacao: null,
        usuario: s.login,
      });
    }
    const { vigentes } = await this.regras(s.c);
    const n = calcularNews2(e.sinais, {
      escalaSpo2: e.escalaSpo2,
      suspeitaInfeccao: e.suspeitaInfeccao,
      regra: vigentes.news2,
    });
    const itens = Object.fromEntries(n.parcelas.map((x) => [x.parametro, x.pontos]));
    if (e.escalaSpo2 === 2) itens['escalaSpo2'] = 2;
    const programar = programacaoPorMudancaDeQuadro(n.total, 0, quando, p.intervaloHoras).map((x) => ({
      paciente: internado.paciente,
      reg: internado.numero,
      unidade: internado.unidade,
      escala: x.escala,
      motivo: x.motivo,
      devidaEm: x.devidaEm,
      prazoEm: x.prazoEm,
      observacao: `NEWS2 ${n.total}`,
      usuario: s.login,
      chave: (escore: number) => `quadro:news2:${escore}`,
    }));
    const avisos = this.avisosDoNews2(p, n.gatilho, n.sugereSepse, n.total, internado);
    return {
      registro: {
        sinais: jaGravados ? [] : sinais,
        escore: {
          ...(jaGravados ? { sinalVital: jaGravados.sinalVital } : {}),
          paciente: internado.paciente,
          reg: internado.numero,
          atendimento: internado.atendimento,
          unidade: internado.unidade,
          escala: 'news2',
          versaoRegra: vigentes.news2.versao,
          itens,
          total: n.total,
          faixa: n.faixa.codigo,
          gatilho: n.gatilho,
          suspeitaInfeccao: e.suspeitaInfeccao,
          origem: 'afericao',
          aferidoEm: quando,
          usuario: s.login,
        },
        cuidados: [],
        cumprir: null,
        programar,
        avisos,
      },
      resultado: {
        total: n.total,
        faixa: n.faixa.codigo,
        rotuloFaixa: n.faixa.rotulo,
        gatilho: n.gatilho,
        conduta: n.conduta,
        avisos: [
          ...(n.sugereSepse
            ? ['Suspeita de infecção com NEWS2 de 5 ou mais: avalie o protocolo de sepse.']
            : []),
          ...(programar.length ? ['Braden e Morse ficaram devidos (mudança do quadro).'] : []),
          ...(avisos.length === 0 && n.gatilho !== 'nenhum'
            ? [
                'Nenhum usuário configurado para receber o aviso na central: avise o médico pelo telefone da unidade.',
              ]
            : []),
        ],
      },
    };
  }

  /** Um escore da tela: total pelos itens, faixa e gatilho, cuidados conferidos, baixa das programadas. */
  async prepararEscore(
    s: SessaoEscores,
    internado: Internado,
    e: RegistrarEscoreEntrada,
    /** Quem registra é enfermeiro (CBO 2235, conselho ativo): só ele aceita ou recusa os cuidados (regra 4). */
    decideCuidados = true,
    p: ParametrosEscores | null = null,
  ): Promise<{ registro: RegistroDeEscore; resultado: Omit<ResultadoEscore, 'id' | 'mensagem'> }> {
    // W0-03, M1: a escala de TEV tem de ser a do perfil do paciente pelo parâmetro (Padua clínico, Caprini cirúrgico).
    if ((e.escala === 'caprini' || e.escala === 'padua') && e.perfilTev) {
      const t = conferirEscalaTev(e.escala, e.perfilTev, p?.tev ?? PARAMETROS_TEV_PADRAO);
      if (!t.ok) throw invalida(t.codigo, t.mensagem, ['escala']);
    }
    const agora = (await this.relogio(s.c)).slice(0, 16);
    const quando = (e.aferidoEm ?? agora).slice(0, 16);
    if (quando > agora || quando < somarMinutos(agora, -24 * 60))
      throw invalida('hora-fora', 'A hora da avaliação é do futuro ou de mais de 24 horas.', ['aferidoEm']);
    const { vigentes } = await this.regras(s.c);
    let rassAtual: number | null = null;
    if (e.escala === 'camicu') {
      const recentes = await this.porta.escores(s.c, [internado.paciente], somarHoras(agora, -24));
      rassAtual = recentes.find((x) => x.escala === 'rass')?.total ?? null;
    }
    const r = calcularEscala(e.escala as EscalaDaTela, e.itens, {
      regra: vigentes[e.escala],
      ...(e.modoDor ? { modoDor: e.modoDor } : {}),
      rassAtual,
    });
    if (!r.ok) throw invalida(r.codigo, r.mensagem, r.itens);
    const sugeridos = cuidadosSugeridos(e.escala, r.faixa);
    // D-CUIDADO-45: a decisão dos cuidados preventivos é do enfermeiro. Quem não é enfermeiro registra o escore sem
    // as decisões (as sugestões ficam para o enfermeiro, com o aviso); se mandar decisões, a recusa é a da
    // classificação (403 so-enfermeiro).
    if (!decideCuidados && e.cuidados.length > 0)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Sem permissão',
        'Aceitar ou recusar os cuidados preventivos é do enfermeiro.',
        { codigo: 'so-enfermeiro', campos: ['cuidados'] },
      );
    const cc = decideCuidados
      ? conferirCuidados(sugeridos, e.cuidados)
      : { ok: true as const, decisoes: [] as typeof e.cuidados };
    if (!cc.ok) throw invalida(cc.codigo, cc.mensagem, ['cuidados']);
    const paraOEnfermeiro =
      !decideCuidados && sugeridos.length > 0
        ? [
            `Paciente em risco: ${sugeridos.length} cuidado(s) preventivo(s) sugerido(s) ficam para o enfermeiro aceitar ou recusar.`,
          ]
        : [];
    const reavaliada = e.escala === 'braden' || e.escala === 'morse';
    return {
      registro: {
        sinais: [],
        escore: {
          paciente: internado.paciente,
          reg: internado.numero,
          atendimento: internado.atendimento,
          unidade: internado.unidade,
          escala: e.escala,
          versaoRegra: e.escala === 'dor' && e.modoDor === 'comportamental' ? 1 : vigentes[e.escala].versao,
          itens: r.itens,
          total: r.total,
          faixa: r.faixa.codigo,
          gatilho: r.gatilho,
          suspeitaInfeccao: false,
          origem: 'tela',
          aferidoEm: quando,
          usuario: s.login,
        },
        cuidados: cc.decisoes,
        cumprir: reavaliada ? { escala: e.escala, quando } : null,
        programar: [],
        avisos:
          r.gatilho === 'profilaxia'
            ? this.avisosDaProfilaxia(p, e.escala, r.total, r.faixa.rotulo, internado)
            : [],
      },
      resultado: {
        total: r.total,
        faixa: r.faixa.codigo,
        rotuloFaixa: r.faixa.rotulo,
        gatilho: r.gatilho,
        conduta: r.conduta,
        avisos: [
          ...cc.decisoes
            .filter((d) => d.decisao === 'recusado')
            .map(
              (d) =>
                `Cuidado recusado com o motivo: ${sugeridos.find((x) => x.codigo === d.codigo)?.rotulo ?? d.codigo}.`,
            ),
          ...paraOEnfermeiro,
          ...(r.gatilho === 'profilaxia'
            ? [
                `Profilaxia de TEV pendente ao prescritor: ${sugestaoProfilaxia(e.escala, r.faixa.codigo)}`,
                ...(p && p.loginsMedico.length === 0
                  ? [
                      'Nenhum prescritor configurado para o aviso na central: a pendência fica na tela dos escores.',
                    ]
                  : []),
              ]
            : []),
        ],
      },
    };
  }

  /** A reavaliação programada à mão (a admissão ou a mudança de quadro), devida agora. */
  async prepararReavaliacao(
    s: SessaoEscores,
    internado: Internado,
    e: ProgramarReavaliacaoEntrada,
    p: ParametrosEscores,
  ) {
    const agora = await this.relogio(s.c);
    const prazo = somarHoras(
      agora,
      e.motivo === 'admissao' ? p.intervaloHoras : Math.min(p.intervaloHoras, 12),
    );
    return {
      paciente: internado.paciente,
      reg: internado.numero,
      unidade: internado.unidade,
      escala: e.escala,
      motivo: e.motivo,
      chave: chaveProgramada(e.motivo, agora),
      devidaEm: agora.slice(0, 19),
      prazoEm: prazo,
      observacao: e.observacao ?? null,
      usuario: s.login,
    };
  }

  /** A nova versão das faixas: conferida (cobre a escala, sem buraco) e com a impressão SHA-256. */
  async prepararRegra(s: SessaoEscores, e: PublicarRegraEscoreEntrada) {
    const problemas = problemasDasFaixas(e.escala, e.faixas);
    if (problemas.length) throw invalida('faixas-invalidas', problemas.join(' '), ['faixas']);
    const { vigentes } = await this.regras(s.c);
    const canonico = conteudoCanonicoFaixas(e.escala, e.faixas);
    if (canonico === conteudoCanonicoFaixas(e.escala, vigentes[e.escala].faixas))
      throw recusa('sem-mudanca', 'As faixas são iguais às da versão vigente: nada a publicar.');
    return {
      escala: e.escala,
      faixas: [...e.faixas].sort((a, b) => a.minimo - b.minimo),
      impressao: await sha256Hex(canonico),
      notas: e.notas,
      autor: s.login,
    };
  }

  /** A classificação do turno pelo instrumento (regra 9): o turno do dia não pode ser futuro nem de mais de 24 h. */
  async prepararClassificacao(
    s: SessaoEscores,
    internado: Internado,
    e: ClassificarPacienteEntrada,
    p: ParametrosEscores,
  ) {
    const agora = (await this.relogio(s.c)).slice(0, 16);
    const t = turnoDoDia(e.data, e.turno, p.inicioTurnoDiurno);
    if (t.inicio > agora || t.fim < somarMinutos(agora, -24 * 60))
      throw invalida('turno-fora', 'Classifique o turno atual ou o anterior.', ['data', 'turno']);
    const r = classificar(e.instrumento, e.itens);
    if (!r.ok) throw invalida(r.codigo, r.mensagem, r.itens);
    return {
      paciente: internado.paciente,
      reg: internado.numero,
      atendimento: internado.atendimento,
      unidade: internado.unidade,
      data: e.data,
      turno: e.turno,
      instrumento: e.instrumento,
      versao: r.versao,
      itens: r.itens,
      total: r.total,
      categoria: r.categoria,
      horas24h: r.horas24h,
      usuario: s.login,
      resultado: r,
    };
  }

  /** A carga da unidade no turno (as parcelas de cada categoria e a soma do NAS). */
  async carga(
    s: SessaoEscores,
    unidade: string,
    data: string | null,
    turno: Turno | null,
    p: ParametrosEscores,
    gravacao: CargaDaUnidade['gravacao'],
  ): Promise<CargaDaUnidade> {
    const agora = (await this.relogio(s.c)).slice(0, 16);
    const t =
      data && turno
        ? turnoDoDia(data, turno, p.inicioTurnoDiurno)
        : turnoDoInstante(agora, p.inicioTurnoDiurno);
    const dia = t.inicio.slice(0, 10);
    const [internados, lidas] = await Promise.all([
      this.enfermagem.internados(s.c, unidade),
      this.porta.classificacoes(s.c, unidade, dia, t.nome),
    ]);
    const rotulo = (i: InstrumentoClassificacao, cat: string, total: number) =>
      i === 'nas'
        ? `${String(total).replace('.', ',')}% do tempo de um profissional`
        : (CATEGORIAS_FUGULIN.find((x) => x.codigo === cat)?.rotulo ?? cat);
    const comoLida = (x: (typeof lidas)[number]): ClassificacaoLida => ({
      id: x.id,
      paciente: x.paciente,
      reg: x.reg,
      instrumento: x.instrumento,
      itens: x.itens,
      total: x.total,
      categoria: x.categoria,
      rotuloCategoria: rotulo(x.instrumento, x.categoria, x.total),
      horas24h: x.horas24h,
      usuario: x.usuario,
      criadoEm: x.criadoEm,
      estorno: x.estorno ?? null,
    });
    // W0-03: a estornada fica visível na lista do paciente, mas não conta na carga nem como classificado.
    const ativas = lidas.filter((x) => !x.estorno);
    const k = cargaDaUnidade(ativas);
    return {
      unidade,
      data: dia,
      turno: t.nome,
      pacientes: internados.map((i) => ({
        paciente: i.paciente,
        atendimento: i.atendimento,
        reg: i.numero,
        nome: i.nome,
        leito: i.leito,
        classificacoes: lidas.filter((x) => x.paciente === i.paciente && x.reg === i.numero).map(comoLida),
      })),
      carga: {
        fugulin: k.fugulin,
        nas: k.nas,
        naoClassificados: internados.filter((i) => !ativas.some((x) => x.paciente === i.paciente)).length,
      },
      gravacao,
    };
  }
}

/** O texto da resposta do escore registrado. */
export function mensagemDoEscore(escala: EscalaEscore, total: number, gatilho: GatilhoEscore): string {
  return `${ROTULOS_ESCALA[escala]}: ${total}. ${ROTULOS_GATILHO[gatilho]}.`;
}
