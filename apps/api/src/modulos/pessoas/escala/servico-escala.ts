// Serviço da escala de plantão, fatia F2 (M52.2; ficha do M52, seções 4, 6, 7 e 8; regras 3 e 5 a 8): os modelos de
// regime e a vigência do regime do colaborador, a escala do setor por competência, a montagem com as regras de
// bloqueio e a publicação. As gravações exigem a chave `pessoas.escala` (POL-3; o administrador liga em
// Funcionalidades) e as regras puras de @sgh/dominio-pessoas antes de gravar; dentro da transação, a pessoa é travada,
// os plantões dela relidos e a conferência refeita (duas inclusões ao mesmo tempo não passam juntas). O
// estabelecimento vem da sessão, nunca do pedido (escala, plantão, regime ou vínculo de outro estabelecimento: 404).
// A sobreposição na Rede (regra 7) é lida antes da transação, nos bancos dos outros estabelecimentos, só de leitura e
// só com os intervalos. Escala publicada só muda com motivo (regra 8), que vai à trilha da escala e ao evento de
// mudança na SGH_OUTBOX; a publicação vai ao evento PESSOAS_ESCALA_PUBLICADA (a F3 consome).
import {
  ACOES_EVENTO_ESCALA,
  type AlterarCoberturaEntrada,
  type AlterarPlantaoEntrada,
  type AlterarRegimeEntrada,
  type AnularVigenciaEntrada,
  type ApoioEscala,
  type AtribuirRegimeEntrada,
  type CancelarEscalaEntrada,
  type CancelarPlantaoEntrada,
  CONSELHO_DA_ESCALA,
  type CriarEscalaEntrada,
  type EscalaResumo,
  type EstadoEscala,
  type ExcluirEscalaEntrada,
  EVENTO_ESCALA_ALTERADA,
  EVENTO_ESCALA_PUBLICADA,
  EVENTOS_AUDITAVEIS,
  type FiltroColaboradoresEscalaEntrada,
  type FiltroEscalasEntrada,
  type GradeEscala,
  type IncluirPlantaoEntrada,
  type IncluirRegimeEntrada,
  INTERJORNADA_MINIMA_MIN,
  JANELA_ALERTA_CONSELHO_DIAS,
  type ListaColaboradoresEscala,
  type ListaEscalas,
  type ListaRegimes,
  type PlantaoLido,
  type PublicarEscalaEntrada,
  type RegimeLido,
  type ResultadoEscala,
  type TipoEscala,
  type TipoPlantao,
  TIPOS_PLANTAO,
  type TipoVinculo,
  type VigenciaRegime,
} from '@sgh/contratos';
import {
  conferirConselhoParaPlantao,
  conferirMudancaNaEscala,
  conferirPlantaoNaEscala,
  conferirPublicacao,
  conferirRegime,
  dataDe,
  diaUtc,
  diasDaCompetencia,
  diasEntre,
  estadoDoPeriodo,
  furosDaEscala,
  horasPorSemana,
  instanteDeMinuto,
  limiteSemanalEfetivo,
  minutoLocal,
  type PlantaoProposto,
  type RegistroDoProfissional,
  regimeNoDia,
  segundaDaSemana,
  vinculoAtivo,
} from '@sgh/dominio-pessoas';
import type {
  EscalaPesLida,
  PlantaoPesLido,
  RegimePesLido,
  TempoParcialLido,
  VinculoPesLido,
} from '@sgh/legado';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../../config/public-api.js';
import { ApoioGravacao } from '../../exames/public-api.js';
import { LiberacaoPep } from '../../pep/public-api.js';
import type { PortaPessoas } from '../porta.js';
import type { PortaPonto } from '../ponto/porta-ponto.js';
import type { GravadorEscala, JanelaPlantoes, PlantoesDaRede, PortaEscala } from './porta-escala.js';

const E = EVENTOS_AUDITAVEIS;
export const CHAVE_PESSOAS_ESCALA = 'pessoas.escala';
const P = {
  ler: 'pessoas.escala.ler',
  montar: 'pessoas.escala.montar',
  publicar: 'pessoas.escala.publicar',
  regimeLer: 'pessoas.regime.ler',
  regimeEditar: 'pessoas.regime.editar',
} as const;

const naoEncontrado = (o: string, detalhe: string) =>
  new ErroProblema('nao-encontrado', 404, `${o} não encontrado`, detalhe);
const escalaNaoEncontrada = () =>
  new ErroProblema(
    'nao-encontrado',
    404,
    'Escala não encontrada',
    'A escala não existe neste estabelecimento.',
  );

/** Recusa de regra (domínio): 409 com o código e a mensagem em português. */
const recusaRegra = (codigo: string, mensagem: string, campos?: readonly string[]) =>
  new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', mensagem, {
    codigo,
    ...(campos ? { campos: [...campos] } : {}),
  });

/**
 * W0-06 (D-CRUD-ORFAOS): a recusa por vínculo, com quantos por grupo de produto (nunca o nome da tabela) no texto e
 * em `bloqueios`. 409.
 */
const recusaComVinculos = (
  v: readonly { grupo: string; quantidade: number }[],
  acao: 'excluida' | 'cancelada' = 'excluida',
) => {
  const porGrupo = new Map<string, number>();
  for (const x of v) porGrupo.set(x.grupo, (porGrupo.get(x.grupo) ?? 0) + x.quantidade);
  const linhas = [...porGrupo].map(([g, q]) => `${g}: ${q}`);
  const total = [...porGrupo.values()].reduce((a, b) => a + b, 0);
  return new ErroProblema(
    'recusa-de-negocio',
    409,
    'Operação recusada',
    acao === 'excluida'
      ? `A escala tem ${total} registro(s) ligado(s) e não pode ser excluída (${linhas.join('; ')}). Uma escala com plantão trocado, realizado ou acionado não é rascunho de engano: publique-a e, se for o caso, cancele-a com motivo.`
      : `A escala tem ${total} registro(s) em andamento e não pode ser cancelada agora (${linhas.join('; ')}). Resolva-os antes: desista da troca, estorne o realizado ou cancele o acionamento.`,
    { codigo: acao === 'excluida' ? 'escala-com-vinculos' : 'escala-com-pendencias', bloqueios: linhas },
  );
};

const ALERTAS = {
  aVencer: 'O registro no conselho vence em breve: confira a renovação com o RH.',
  semValidade: 'A validade do registro no conselho ainda não foi conferida pelo RH.',
  rede: 'Não foi possível conferir agora os plantões nos outros estabelecimentos da Rede: o plantão ficou marcado para conferência.',
} as const;

const HORA = (i: string) => `${i.slice(8, 10)}/${i.slice(5, 7)} ${i.slice(11, 16)}`;
export const descricaoPlantao = (nome: string, p: { tipo: string; inicio: string; fim: string }) =>
  `${nome}: ${TIPOS_PLANTAO[p.tipo as TipoPlantao] ?? p.tipo} de ${HORA(p.inicio)} a ${HORA(p.fim)}`;

/**
 * A janela de releitura de um plantão: a semana (segunda a domingo) do início até a do fim, para o limite do contrato,
 * e 72 h antes e depois, para a interjornada (o maior descanso de regime aceito); o início dos lidos vem 24 h antes.
 */
export function janelaDoPlantao(p: { inicio: string; fim: string }): JanelaPlantoes {
  const a = minutoLocal(p.inicio);
  const b = minutoLocal(p.fim);
  const segunda = diaUtc(segundaDaSemana(p.inicio.slice(0, 10))) * 1440;
  const fimSemana = (diaUtc(segundaDaSemana(instanteDeMinuto(b - 1).slice(0, 10))) + 7) * 1440;
  const de = Math.min(segunda, a - 72 * 60);
  const ate = Math.max(fimSemana, b + 72 * 60);
  return {
    de: instanteDeMinuto(de),
    ate: instanteDeMinuto(ate),
    inicioDesde: instanteDeMinuto(de - 24 * 60),
  };
}

const proposto = (p: {
  tipo: string;
  inicio: string;
  fim: string;
  chegadaMin: number | null;
}): PlantaoProposto => ({
  tipo: p.tipo as TipoPlantao,
  inicio: p.inicio,
  fim: p.fim,
  chegadaMin: p.chegadaMin,
});

const mesDe = (dia: string) => dia.slice(0, 7);
/** O cache curto dos domínios de RH (5 min, como a configuração do novo). */
const TTL_DOMINIOS_PESSOAS_S = 300;

export class ServicoEscala {
  readonly apoio: ApoioGravacao<GravadorEscala>;
  private readonly liberacao: LiberacaoPep;

  constructor(
    readonly porta: PortaEscala,
    private readonly pessoas: PortaPessoas,
    trilha: RegistradorTrilha,
    configuracao: FonteConfiguracao | null,
    private readonly cache: CacheConfig | null,
    /** W0-06: o período de ponto fechado que usou a vigência barra a anulação dela. */
    private readonly ponto: PortaPonto | null = null,
  ) {
    this.apoio = new ApoioGravacao<GravadorEscala>(
      { chave: CHAVE_PESSOAS_ESCALA, nome: 'a escala de plantão', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
    this.liberacao = new LiberacaoPep(configuracao, cache);
  }

  /**
   * D-ESCALA-REDE-52: a regra 7 só lê o banco do outro estabelecimento que liberou a escala de plantão para o
   * estabelecimento INTEIRO (a mesma regra do MPI do M57 com a chave dele); sem a configuração, desligado.
   */
  private escalaNaRedeLiberada(s: SessaoCadastro): (estabelecimento: string) => Promise<boolean> {
    return (h) => this.liberacao.ligadaNoEstabelecimento(s.rede, h, CHAVE_PESSOAS_ESCALA);
  }

  private async janelaConselho(s: SessaoCadastro): Promise<number> {
    const v = await this.apoio.parametro(s, 'pessoas.alertaConselhoDias').catch(() => 0);
    return v > 0 ? v : JANELA_ALERTA_CONSELHO_DIAS;
  }

  // ── Apoio e regimes ─────────────────────────────────────────────────────────────────────────────────────────

  private regimeLido(r: RegimePesLido, dom: DominiosEscala): RegimeLido {
    const parcial = dom.parciais.find((x) => x.codigo === r.contratoParcial) ?? null;
    return {
      id: r.id,
      codigo: r.codigo,
      nome: r.nome,
      jornada: r.jornada,
      jornadaNome: dom.jornadas.find((x) => x.codigo === r.jornada)?.nome ?? null,
      contratoParcial: r.contratoParcial,
      contratoParcialNome: parcial?.nome ?? null,
      folgaPadrao: r.folgaPadrao,
      folgaPadraoNome:
        r.folgaPadrao === null ? null : (dom.folgas.find((x) => x.codigo === r.folgaPadrao)?.nome ?? null),
      minutosPlantao: r.minutosPlantao,
      descansoMinimoMin: r.descansoMinimoMin,
      limiteSemanalHoras: r.limiteSemanalHoras,
      limiteEfetivoHoras: limiteSemanalEfetivo(this.regraDoRegime(r, dom.parciais), 'clt'),
      acordo: r.acordo,
      ativo: r.ativo,
      versao: r.versao,
    };
  }

  private regraDoRegime(r: RegimePesLido, parciais: readonly TempoParcialLido[]) {
    return {
      descansoMinimoMin: r.descansoMinimoMin,
      acordo: r.acordo,
      contratoParcial: r.contratoParcial,
      limiteParcialDominio: parciais.find((x) => x.codigo === r.contratoParcial)?.limiteSemanalHoras ?? null,
      limiteSemanalHoras: r.limiteSemanalHoras,
    };
  }

  /** Os domínios de RH do ramo (tabelas pequenas, lidas inteiras), com o cache curto (ficha, seção 4). */
  private async dominios(s: SessaoCadastro): Promise<DominiosEscala> {
    const carregar = async (): Promise<DominiosEscala> => {
      const [jornadas, parciais, folgas] = await Promise.all([
        this.porta.tiposJornada(s.porta),
        this.porta.temposParciais(s.porta),
        this.porta.tiposTrabalhoFolga(s.porta),
      ]);
      return { jornadas, parciais, folgas };
    };
    const c = this.cache;
    return c
      ? c.lerOuCarregar(c.chave(s.rede, s.hospital, 'dominios-pessoas'), TTL_DOMINIOS_PESSOAS_S, carregar)
      : carregar();
  }

  private async temposParciais(s: SessaoCadastro): Promise<readonly TempoParcialLido[]> {
    return (await this.dominios(s)).parciais;
  }

  async apoioTela(s: SessaoCadastro): Promise<ApoioEscala> {
    const [hoje, unidades, dom, regimes, gravacao] = await Promise.all([
      this.pessoas.hoje(s.porta),
      this.pessoas.unidades(s.porta),
      this.dominios(s),
      this.porta.regimes(s.porta),
      this.apoio.gravacao(s, { montar: P.montar, publicar: P.publicar, editarRegime: P.regimeEditar }),
    ]);
    const op = gravacao.operacoes;
    const montar = op['montar']?.pode ?? false;
    const publicar = op['publicar']?.pode ?? false;
    const editarRegime = op['editarRegime']?.pode ?? false;
    return {
      hoje,
      unidades: unidades.map((u) => ({ codigo: u.codigo, rotulo: u.nome })),
      jornadas: dom.jornadas.map((x) => ({ codigo: x.codigo, rotulo: x.nome })),
      temposParciais: dom.parciais.map((x) => ({
        codigo: x.codigo,
        rotulo: x.nome,
        limiteSemanalHoras: x.limiteSemanalHoras,
      })),
      folgas: dom.folgas.map((x) => ({ codigo: x.codigo, rotulo: x.nome })),
      regimes: regimes.map((r) => this.regimeLido(r, dom)),
      interjornadaMinimaMin: INTERJORNADA_MINIMA_MIN,
      gravacao: { ligada: gravacao.ligada, motivo: gravacao.motivo },
      acoes: {
        montar,
        publicar,
        editarRegime,
        motivo:
          montar || publicar || editarRegime
            ? null
            : (op['montar']?.motivo ?? op['editarRegime']?.motivo ?? gravacao.motivo),
      },
    };
  }

  async regimes(s: SessaoCadastro): Promise<ListaRegimes> {
    const [dom, regimes] = await Promise.all([this.dominios(s), this.porta.regimes(s.porta)]);
    return { itens: regimes.map((r) => this.regimeLido(r, dom)) };
  }

  private async conferirCamposRegime(s: SessaoCadastro, e: IncluirRegimeEntrada): Promise<void> {
    const dom = await this.dominios(s);
    if (!dom.jornadas.some((x) => x.codigo === e.jornada))
      throw recusaRegra('jornada-desconhecida', 'O tipo de jornada não existe nas tabelas do RH.', [
        'jornada',
      ]);
    if (!dom.parciais.some((x) => x.codigo === e.contratoParcial))
      throw recusaRegra('parcial-desconhecido', 'O tipo de contrato em tempo parcial não existe.', [
        'contratoParcial',
      ]);
    if (e.folgaPadrao !== null && !dom.folgas.some((x) => x.codigo === e.folgaPadrao))
      throw recusaRegra('folga-desconhecida', 'O tipo de folga não existe nas tabelas do RH.', [
        'folgaPadrao',
      ]);
    const c = conferirRegime(e);
    if (!c.ok) throw recusaRegra(c.codigo, c.mensagem);
  }

  async incluirRegime(s: SessaoCadastro, e: IncluirRegimeEntrada): Promise<ResultadoEscala> {
    await this.apoio.exigirLiberacao(s);
    await this.conferirCamposRegime(s, e);
    const id = await this.apoio.sgh(
      s,
      E.pessoasRegimeGravado.codigo,
      CHAVE_PESSOAS_ESCALA,
      (x: number) => ({ tabela: 'SGH_PES_REGIME', id: String(x) }),
      (g) => g.incluirRegime({ ...e, por: s.login }),
    );
    return { id, mensagem: 'Regime incluído.', alertas: [] };
  }

  async alterarRegime(s: SessaoCadastro, e: AlterarRegimeEntrada): Promise<ResultadoEscala> {
    await this.apoio.exigirLiberacao(s);
    const atual = await this.porta.regime(s.porta, e.id);
    if (!atual || atual.hospital !== s.hospital)
      throw naoEncontrado('Regime', 'O regime não existe neste estabelecimento.');
    await this.conferirCamposRegime(s, e);
    await this.apoio.sgh(
      s,
      E.pessoasRegimeGravado.codigo,
      CHAVE_PESSOAS_ESCALA,
      { tabela: 'SGH_PES_REGIME', id: String(e.id) },
      (g) => g.alterarRegime({ ...e, por: s.login }),
    );
    return { id: e.id, mensagem: 'Regime alterado.', alertas: [] };
  }

  /** Os colaboradores ativos (nome ou matrícula; sem CPF) com o regime em vigor hoje. */
  async colaboradores(
    s: SessaoCadastro,
    f: FiltroColaboradoresEscalaEntrada,
  ): Promise<ListaColaboradoresEscala> {
    const [hoje, lista, regimes] = await Promise.all([
      this.pessoas.hoje(s.porta),
      this.pessoas.listarVinculos(s.porta, {
        estado: 'ativo',
        limite: f.limite,
        ...(f.termo ? { termo: f.termo } : {}),
      }),
      this.porta.regimes(s.porta),
    ]);
    const vig = await this.porta.vigencias(
      s.porta,
      lista.itens.map((v) => v.id),
    );
    const porId = new Map(regimes.map((r) => [r.id, r]));
    return {
      itens: lista.itens.map((v) => {
        const atual = regimeNoDia(
          vig.filter((x) => x.vinculo === v.id),
          hoje,
        );
        const r = atual ? porId.get(atual.regime) : undefined;
        return {
          vinculo: v.id,
          nome: v.nome,
          matricula: v.matricula,
          tipo: v.tipo as TipoVinculo,
          cargo: v.cargo,
          cargaSemanalHoras: v.cargaSemanal,
          regime: atual && r ? { id: r.id, codigo: r.codigo, desde: atual.desde } : null,
        };
      }),
    };
  }

  private async vinculoOu404(s: SessaoCadastro, id: number): Promise<VinculoPesLido> {
    const v = await this.pessoas.vinculo(s.porta, id);
    if (!v || v.hospital !== s.hospital)
      throw naoEncontrado('Colaborador', 'O vínculo não existe neste estabelecimento.');
    return v;
  }

  async vigencias(s: SessaoCadastro, vinculo: number): Promise<VigenciaRegime[]> {
    await this.vinculoOu404(s, vinculo);
    const [vig, regimes] = await Promise.all([
      this.porta.historicoVigencias(s.porta, vinculo),
      this.porta.regimes(s.porta),
    ]);
    const porId = new Map(regimes.map((r) => [r.id, r]));
    return vig.map((v) => ({
      id: v.id,
      regime: v.regime,
      codigo: porId.get(v.regime)?.codigo ?? String(v.regime),
      desde: v.desde,
      por: v.por,
      anulada: v.anulada,
    }));
  }

  async atribuirRegime(s: SessaoCadastro, e: AtribuirRegimeEntrada): Promise<ResultadoEscala> {
    await this.apoio.exigirLiberacao(s);
    const [v, r] = await Promise.all([this.vinculoOu404(s, e.vinculo), this.porta.regime(s.porta, e.regime)]);
    if (!r || r.hospital !== s.hospital)
      throw naoEncontrado('Regime', 'O regime não existe neste estabelecimento.');
    if (!vinculoAtivo(v)) throw recusaRegra('desligado', 'O vínculo está desligado: não recebe regime.');
    if (!r.ativo) throw recusaRegra('regime-inativo', 'O regime está inativo.', ['regime']);
    if (diasEntre(v.admissao, e.desde) < 0)
      throw recusaRegra('antes-da-admissao', 'O regime não pode valer antes da admissão.', ['desde']);
    const id = await this.apoio.sgh(
      s,
      E.pessoasRegimeAtribuido.codigo,
      CHAVE_PESSOAS_ESCALA,
      (x: number) => ({ tabela: 'SGH_PES_REGIME_VINCULO', id: String(x), chave: `SGH_PES_VINCULO:${v.id}` }),
      (g) => g.atribuirRegime({ vinculo: v.id, regime: r.id, desde: e.desde, por: s.login }),
    );
    return {
      id,
      mensagem: `Regime ${r.codigo} a partir de ${e.desde.split('-').reverse().join('/')}.`,
      alertas: [],
    };
  }

  /**
   * W0-06: anula a vigência lançada por engano (nunca apaga; fica no histórico com quem, quando e o motivo). Recusa
   * se um período de ponto FECHADO do colaborador usou a vigência (os dias do período caem entre o início dela e o da
   * vigência seguinte): reabra o período antes (a reabertura tem motivo e trilha própria).
   */
  async anularVigencia(s: SessaoCadastro, e: AnularVigenciaEntrada): Promise<ResultadoEscala> {
    await this.apoio.exigirLiberacao(s);
    const alvo = await this.vigenciaOu404(s, e.vigencia);
    const v = await this.vinculoOu404(s, alvo.vinculo);
    if (alvo.anulada) throw recusaRegra('ja-anulada', 'A vigência já está anulada.');
    await this.apoio.sgh(
      s,
      E.pessoasRegimeVigenciaAnulada.codigo,
      CHAVE_PESSOAS_ESCALA,
      { tabela: 'SGH_PES_REGIME_VINCULO', id: String(alvo.id), chave: `SGH_PES_VINCULO:${v.id}` },
      async (g) => {
        // Revisão W0-06 (fail-closed): trava a pessoa (a mesma trava do fechamento do ponto) e reconta os períodos
        // fechados DENTRO da transação; um fechamento gravado depois da leitura da tela não passa.
        await g.travarPessoa(v.pessoa);
        const fechados = await this.competenciasFechadasNaVigencia(s, alvo, g);
        if (fechados.length > 0)
          throw new ErroProblema(
            'recusa-de-negocio',
            409,
            'Operação recusada',
            `A vigência foi usada no ponto fechado de ${fechados.join(', ')}: reabra o período antes de anular (períodos de ponto fechados: ${fechados.length}).`,
            {
              codigo: 'vigencia-em-ponto-fechado',
              bloqueios: fechados.map((c) => `Período de ponto fechado: ${c}`),
            },
          );
        await g.anularVigencia({ id: alvo.id, motivo: e.motivo.trim(), por: s.login });
      },
    );
    return {
      id: alvo.id,
      mensagem: 'Vigência anulada: o regime volta a ser o da vigência anterior.',
      alertas: [],
    };
  }

  private async vigenciaOu404(s: SessaoCadastro, id: number) {
    // O estabelecimento vem da sessão: a vigência de outro estabelecimento não é achada (404).
    const x = await this.porta.vigencia(s.porta, id);
    if (!x) throw naoEncontrado('Vigência', 'A vigência não existe neste estabelecimento.');
    return x;
  }

  /** As competências de ponto fechado do vínculo que têm dia coberto pela vigência (a vigência seguinte limita). */
  private async competenciasFechadasNaVigencia(
    s: SessaoCadastro,
    alvo: { id: number; vinculo: number; desde: string },
    g: GravadorEscala,
  ): Promise<string[]> {
    const hist = await g.historicoVigencias(alvo.vinculo);
    const eventos =
      (await g.eventosPeriodo(alvo.vinculo)) ??
      (this.ponto ? await this.ponto.eventosPeriodo(s.porta, alvo.vinculo) : []);
    const seguinte = hist
      .filter((x) => !x.anulada && x.id !== alvo.id && x.desde > alvo.desde)
      .map((x) => x.desde)
      .sort()[0];
    const porComp = new Map<string, typeof eventos>();
    for (const ev of eventos) porComp.set(ev.competencia, [...(porComp.get(ev.competencia) ?? []), ev]);
    const r: string[] = [];
    for (const [comp, evs] of porComp) {
      const dias = diasDaCompetencia(comp);
      const cobre = dias[dias.length - 1]! >= alvo.desde && (!seguinte || dias[0]! < seguinte);
      if (!cobre) continue;
      const est = estadoDoPeriodo(
        evs.map((x) => ({
          id: x.id,
          acao: x.acao,
          ref: x.ref,
          concorda: x.concorda,
          registradoPor: x.registradoPor,
          registradoEm: x.registradoEm,
        })),
      );
      if (est.estado === 'fechado') r.push(comp);
    }
    return r.sort();
  }

  // ── Escala ──────────────────────────────────────────────────────────────────────────────────────────────────

  private resumo(x: EscalaPesLida, unidades: ReadonlyMap<number, string>): EscalaResumo {
    const tipo = x.tipo as TipoEscala;
    return {
      id: x.id,
      unidade: x.unidade,
      unidadeNome: unidades.get(x.unidade) ?? null,
      setor: x.setor,
      competencia: x.competencia,
      tipo,
      conselhoExigido: CONSELHO_DA_ESCALA[tipo] ?? null,
      estado: x.estado as EstadoEscala,
      cobertura: x.cobertura,
      plantoes: x.plantoes,
      publicadaEm: x.publicadaEm,
      publicadaPor: x.publicadaPor,
      cancelamento:
        x.canceladaEm && x.canceladaPor
          ? { por: x.canceladaPor, em: x.canceladaEm, motivo: x.motivoCancelamento ?? '' }
          : null,
      versao: x.versao,
    };
  }

  private async mapaUnidades(s: SessaoCadastro): Promise<Map<number, string>> {
    return new Map((await this.pessoas.unidades(s.porta)).map((u) => [u.codigo, u.nome]));
  }

  async escalas(s: SessaoCadastro, f: FiltroEscalasEntrada): Promise<ListaEscalas> {
    const [lista, un] = await Promise.all([this.porta.escalas(s.porta, f), this.mapaUnidades(s)]);
    return { itens: lista.map((x) => this.resumo(x, un)) };
  }

  private async escalaOu404(s: SessaoCadastro, id: number): Promise<EscalaPesLida> {
    const x = await this.porta.escala(s.porta, id);
    if (!x || x.hospital !== s.hospital) throw escalaNaoEncontrada();
    return x;
  }

  async criarEscala(s: SessaoCadastro, e: CriarEscalaEntrada): Promise<ResultadoEscala> {
    await this.apoio.exigirLiberacao(s);
    const [hoje, un] = await Promise.all([this.pessoas.hoje(s.porta), this.mapaUnidades(s)]);
    if (!un.has(e.unidade))
      throw recusaRegra('unidade-desconhecida', 'A unidade não existe neste estabelecimento.', ['unidade']);
    // D-COMP-52: a escala é da competência atual em diante (o passado é o realizado, do ponto e do repasse).
    if (e.competencia < mesDe(hoje))
      throw recusaRegra('competencia-passada', 'A escala é montada para o mês atual ou os seguintes.', [
        'competencia',
      ]);
    const id = await this.apoio.sgh(
      s,
      E.pessoasEscalaCriada.codigo,
      CHAVE_PESSOAS_ESCALA,
      (x: number) => ({ tabela: 'SGH_PES_ESCALA', id: String(x) }),
      (g) =>
        g.incluirEscala({
          unidade: e.unidade,
          setor: e.setor.trim(),
          competencia: e.competencia,
          tipo: e.tipo,
          cobertura: e.cobertura,
          por: s.login,
        }),
    );
    return { id, mensagem: 'Escala criada em rascunho.', alertas: [] };
  }

  async alterarCobertura(s: SessaoCadastro, e: AlterarCoberturaEntrada): Promise<ResultadoEscala> {
    await this.apoio.exigirLiberacao(s);
    const x = await this.escalaOu404(s, e.escala);
    const m = conferirMudancaNaEscala(x.estado as EstadoEscala, e.motivo);
    if (!m.ok) throw recusaRegra(m.codigo, m.mensagem, ['motivo']);
    await this.apoio.sgh(
      s,
      E.pessoasEscalaCriada.codigo,
      CHAVE_PESSOAS_ESCALA,
      { tabela: 'SGH_PES_ESCALA', id: String(x.id) },
      async (g) => {
        const esc = await g.escala(x.id);
        if (!esc) throw escalaNaoEncontrada();
        const m2 = conferirMudancaNaEscala(esc.estado as EstadoEscala, e.motivo);
        if (!m2.ok) throw recusaRegra(m2.codigo, m2.mensagem, ['motivo']);
        await g.alterarCobertura({ id: x.id, versao: e.versao, cobertura: e.cobertura, por: s.login });
        const ev = await g.evento({
          escala: x.id,
          plantao: null,
          acao: 'cobertura',
          descricao: `Cobertura mínima ${e.cobertura.manha}/${e.cobertura.tarde}/${e.cobertura.noite}`,
          motivo: e.motivo,
          por: s.login,
        });
        if (esc.estado === 'publicada') await this.outboxMudanca(g, s, esc, 'cobertura', ev);
      },
    );
    return { id: x.id, mensagem: 'Cobertura mínima alterada.', alertas: [] };
  }

  /** O evento de mudança da escala publicada: a chave (única na SGH_OUTBOX) leva o evento da trilha da escala. */
  private async outboxMudanca(
    g: GravadorEscala,
    s: SessaoCadastro,
    x: EscalaPesLida,
    acao: string,
    evento: number,
  ) {
    await g.outbox({
      tipo: EVENTO_ESCALA_ALTERADA,
      chave: `${s.hospital}:escala:${x.id}:${acao}:evento:${evento}`,
      carga: { escala: x.id, competencia: x.competencia, unidade: x.unidade, acao },
    });
  }

  /** Os registros do conselho do profissional do vínculo com a validade conferida (mesmo número e conselho). */
  private async registrosDe(s: SessaoCadastro, profissionais: readonly number[]) {
    const r = new Map<number, RegistroDoProfissional[]>();
    if (profissionais.length === 0) return r;
    const profs = await this.pessoas.profissionais(s.porta, profissionais);
    const regs = profs.flatMap((p) => p.registros);
    const hab = await this.pessoas.habilitacoes(
      s.porta,
      regs.map((x) => x.id),
    );
    for (const x of regs) {
      const h = hab.get(x.id);
      const vale = h && h.numero === x.numero && (h.conselho ?? null) === (x.conselho ?? null);
      r.set(x.profissional, [
        ...(r.get(x.profissional) ?? []),
        { registro: x.id, conselho: x.conselho, ativo: x.ativo, validade: vale ? h.validade : null },
      ]);
    }
    return r;
  }

  /**
   * Monta e confere um plantão (inclusão ou alteração) e grava na mesma transação em que relê a pessoa travada.
   * `atual`: o plantão alterado (fica fora das comparações).
   */
  private async gravarPlantao(
    s: SessaoCadastro,
    e: IncluirPlantaoEntrada | AlterarPlantaoEntrada,
    atual: PlantaoPesLido | null,
  ): Promise<ResultadoEscala> {
    await this.apoio.exigirLiberacao(s);
    const x = await this.escalaOu404(s, e.escala);
    const v = await this.vinculoOu404(s, e.vinculo);
    const hoje = await this.pessoas.hoje(s.porta);
    // D-PASSADO-52: o que já começou é o realizado (F4 e F6); a escala prevista só muda daqui para a frente.
    if (diasEntre(hoje, dataDe(e.inicio)) < 0 || (atual && diasEntre(hoje, dataDe(atual.inicio)) < 0))
      throw recusaRegra('plantao-no-passado', 'O plantão de um dia que já passou não muda pela escala.', [
        'inicio',
      ]);
    const p = proposto(e);
    const janela = janelaDoPlantao(p);
    const [dom, regs, regime, rede, janelaDias] = await Promise.all([
      this.temposParciais(s),
      this.registrosDe(s, v.profissional !== null ? [v.profissional] : []),
      this.porta.vigencias(s.porta, [v.id]),
      this.porta
        .plantoesNaRede(s.porta, v.id, janela, this.escalaNaRedeLiberada(s))
        .catch((): PlantoesDaRede => ({ intervalos: [], semResposta: 1 })),
      this.janelaConselho(s),
    ]);
    const vigente = regimeNoDia(regime, dataDe(e.inicio));
    const r = vigente ? await this.porta.regime(s.porta, vigente.regime) : null;
    const regra = r ? this.regraDoRegime(r, dom) : null;
    const registros = v.profissional !== null ? (regs.get(v.profissional) ?? []) : [];

    const conferir = (estado: EstadoEscala, daPessoa: readonly PlantaoPesLido[]) => {
      const outros = daPessoa.filter((o) => o.id !== atual?.id);
      return conferirPlantaoNaEscala(p, {
        escala: { competencia: x.competencia, tipo: x.tipo as TipoEscala, estado },
        vinculo: { tipo: v.tipo as TipoVinculo, admissao: v.admissao, desligamento: v.desligamento },
        registros,
        regime: regra,
        doVinculo: outros.filter((o) => o.vinculo === v.id).map(proposto),
        daPessoa: outros,
        rede,
        motivo: e.motivo,
        janelaDias,
      });
    };
    // Primeira conferência fora da transação (resposta rápida); a de valor é a de dentro.
    const antes = conferir(
      x.estado as EstadoEscala,
      await this.porta.plantoesDaPessoa(s.porta, v.pessoa, janela),
    );
    if (!antes.ok) throw recusaRegra(antes.codigo, antes.mensagem);

    const acao = atual ? 'alterado' : 'incluido';
    const r2 = await this.apoio.sgh(
      s,
      E.pessoasPlantaoGravado.codigo,
      CHAVE_PESSOAS_ESCALA,
      (y: { id: number }) => ({
        tabela: 'SGH_PES_PLANTAO',
        id: String(y.id),
        chave: `SGH_PES_ESCALA:${x.id}`,
      }),
      async (g) => {
        await g.travarPessoa(v.pessoa);
        const esc = await g.escala(x.id);
        if (!esc) throw escalaNaoEncontrada();
        const c = conferir(esc.estado as EstadoEscala, await g.plantoesDaPessoa(v.pessoa, janela));
        if (!c.ok) throw recusaRegra(c.codigo, c.mensagem);
        const campos = {
          tipo: e.tipo,
          inicio: e.inicio,
          fim: e.fim,
          chegadaMin: e.chegadaMin,
          registro: c.registro,
          alertaConselho: c.alertaConselho,
          redeNaoConferida: c.redeNaoConferida,
          motivo: e.motivo,
          por: s.login,
        };
        let id: number;
        if (atual) {
          await g.alterarPlantao({ id: atual.id, versao: (e as AlterarPlantaoEntrada).versao, ...campos });
          id = atual.id;
        } else
          id = await g.incluirPlantao({
            escala: x.id,
            vinculo: v.id,
            pessoa: v.pessoa,
            profissional: v.profissional,
            ...campos,
          });
        await g.tocarEscala({ id: x.id, estado: esc.estado, por: s.login });
        const ev = await g.evento({
          escala: x.id,
          plantao: id,
          acao,
          descricao: descricaoPlantao(v.nome, e),
          motivo: e.motivo,
          por: s.login,
        });
        if (esc.estado === 'publicada') await this.outboxMudanca(g, s, esc, acao, ev);
        return { id, c };
      },
    );
    const alertas: string[] = [];
    if (r2.c.ok && r2.c.alertaConselho) alertas.push(ALERTAS[r2.c.alertaConselho]);
    if (r2.c.ok && r2.c.redeNaoConferida) alertas.push(ALERTAS.rede);
    return { id: r2.id, mensagem: atual ? 'Plantão alterado.' : 'Plantão incluído.', alertas };
  }

  /**
   * M52.3 (troca de plantão): a conferência de um plantão que já existe com OUTRO vínculo (o colega que o assume), na
   * mesma regra da montagem (regras 3 e 5 a 7). Lê fora da transação o que não muda nela (domínios, registros do
   * conselho, regime e a Rede); `conferir` recebe o estado da escala e os plantões da pessoa relidos na transação, e
   * deixa de fora os plantões da troca (os dois mudam de dono juntos).
   */
  async conferenciaComOutroVinculo(
    s: SessaoCadastro,
    x: EscalaPesLida,
    v: VinculoPesLido,
    p: PlantaoPesLido,
    motivo: string,
  ) {
    const prop = proposto(p);
    const janela = janelaDoPlantao(prop);
    const [dom, regs, regime, rede, janelaDias] = await Promise.all([
      this.temposParciais(s),
      this.registrosDe(s, v.profissional !== null ? [v.profissional] : []),
      this.porta.vigencias(s.porta, [v.id]),
      this.porta
        .plantoesNaRede(s.porta, v.id, janela, this.escalaNaRedeLiberada(s))
        .catch((): PlantoesDaRede => ({ intervalos: [], semResposta: 1 })),
      this.janelaConselho(s),
    ]);
    const vigente = regimeNoDia(regime, dataDe(p.inicio));
    const r = vigente ? await this.porta.regime(s.porta, vigente.regime) : null;
    const regra = r ? this.regraDoRegime(r, dom) : null;
    const registros = v.profissional !== null ? (regs.get(v.profissional) ?? []) : [];
    return {
      janela,
      conferir: (estado: EstadoEscala, daPessoa: readonly PlantaoPesLido[], fora: ReadonlySet<number>) => {
        const outros = daPessoa.filter((o) => !fora.has(o.id));
        return conferirPlantaoNaEscala(prop, {
          escala: { competencia: x.competencia, tipo: x.tipo as TipoEscala, estado },
          vinculo: { tipo: v.tipo as TipoVinculo, admissao: v.admissao, desligamento: v.desligamento },
          registros,
          regime: regra,
          doVinculo: outros.filter((o) => o.vinculo === v.id).map(proposto),
          daPessoa: outros,
          rede,
          motivo,
          janelaDias,
        });
      },
    };
  }

  /** Os textos dos alertas da montagem (conselho a vencer ou sem validade; Rede não conferida). */
  static readonly ALERTAS = ALERTAS;

  /** O evento de mudança da escala publicada (a troca aprovada também o gera). */
  outboxDaMudanca(g: GravadorEscala, s: SessaoCadastro, x: EscalaPesLida, acao: string, evento: number) {
    return this.outboxMudanca(g, s, x, acao, evento);
  }

  incluirPlantao(s: SessaoCadastro, e: IncluirPlantaoEntrada): Promise<ResultadoEscala> {
    return this.gravarPlantao(s, e, null);
  }

  private async plantaoOu404(s: SessaoCadastro, escala: number, id: number): Promise<PlantaoPesLido> {
    const [p] = (await this.porta.plantoesDaEscala(s.porta, escala)).filter((x) => x.id === id);
    if (!p) throw naoEncontrado('Plantão', 'O plantão não está nesta escala.');
    return p;
  }

  async alterarPlantao(s: SessaoCadastro, e: AlterarPlantaoEntrada): Promise<ResultadoEscala> {
    await this.escalaOu404(s, e.escala);
    const atual = await this.plantaoOu404(s, e.escala, e.plantao);
    if (atual.situacao !== 'previsto') throw recusaRegra('cancelado', 'O plantão está cancelado.');
    if (atual.vinculo !== e.vinculo)
      throw recusaRegra(
        'troca-de-colaborador',
        'Para pôr outro colaborador no plantão, cancele este e inclua o novo (a troca entre colegas tem fluxo próprio).',
        ['vinculo'],
      );
    return this.gravarPlantao(s, e, atual);
  }

  async cancelarPlantao(s: SessaoCadastro, e: CancelarPlantaoEntrada): Promise<ResultadoEscala> {
    await this.apoio.exigirLiberacao(s);
    const x = await this.escalaOu404(s, e.escala);
    const p = await this.plantaoOu404(s, e.escala, e.plantao);
    if (p.situacao !== 'previsto') throw recusaRegra('cancelado', 'O plantão já está cancelado.');
    const hoje = await this.pessoas.hoje(s.porta);
    if (diasEntre(hoje, dataDe(p.inicio)) < 0)
      throw recusaRegra('plantao-no-passado', 'O plantão de um dia que já passou não muda pela escala.');
    const m = conferirMudancaNaEscala(x.estado as EstadoEscala, e.motivo);
    if (!m.ok) throw recusaRegra(m.codigo, m.mensagem, ['motivo']);
    const v = await this.pessoas.vinculo(s.porta, p.vinculo);
    await this.apoio.sgh(
      s,
      E.pessoasPlantaoGravado.codigo,
      CHAVE_PESSOAS_ESCALA,
      { tabela: 'SGH_PES_PLANTAO', id: String(p.id), chave: `SGH_PES_ESCALA:${x.id}` },
      async (g) => {
        const esc = await g.escala(x.id);
        if (!esc) throw escalaNaoEncontrada();
        const m2 = conferirMudancaNaEscala(esc.estado as EstadoEscala, e.motivo);
        if (!m2.ok) throw recusaRegra(m2.codigo, m2.mensagem, ['motivo']);
        await g.cancelarPlantao({ id: p.id, versao: e.versao, motivo: e.motivo, por: s.login });
        await g.tocarEscala({ id: x.id, estado: esc.estado, por: s.login });
        const ev = await g.evento({
          escala: x.id,
          plantao: p.id,
          acao: 'cancelado',
          descricao: descricaoPlantao(v?.nome ?? `Vínculo ${p.vinculo}`, p),
          motivo: e.motivo,
          por: s.login,
        });
        if (esc.estado === 'publicada') await this.outboxMudanca(g, s, esc, 'cancelado', ev);
      },
    );
    return { id: p.id, mensagem: 'Plantão cancelado.', alertas: [] };
  }

  // ── W0-06: exclusão do rascunho e cancelamento da publicada ────────────────────────────────────────────────

  private conferirVersao(x: EscalaPesLida, versao: number): void {
    if (x.versao !== versao)
      throw recusaRegra(
        'desatualizado',
        'A escala mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
      );
  }

  /**
   * Exclusão física da escala em RASCUNHO criada por engano (matriz: "rascunho admite exclusão física com log"): só
   * sem vínculo (trocas, realizados e acionamentos dos plantões dela; recusa 409 com a contagem por grupo, e a
   * contagem é refeita na transação), com o retrato da escala, dos plantões e da trilha da escala na
   * SGH_HIST_EXCLUSAO antes do DELETE (D-CRUD-SNAP). A publicada não se apaga: cancela-se com motivo.
   */
  async excluirEscala(s: SessaoCadastro, e: ExcluirEscalaEntrada): Promise<ResultadoEscala> {
    await this.apoio.exigirLiberacao(s);
    const x = await this.escalaOu404(s, e.escala);
    if (x.estado !== 'rascunho')
      throw recusaRegra(
        'escala-publicada',
        'A escala publicada não se exclui: cancele-a com o motivo (os plantões ficam cancelados e o histórico fica).',
      );
    this.conferirVersao(x, e.versao);
    const vinculos = await this.porta.dependenciasEscala(s.porta, x.id);
    if (vinculos.length > 0) throw recusaComVinculos(vinculos);
    const r = await this.apoio.sgh(
      s,
      E.pessoasEscalaExcluida.codigo,
      CHAVE_PESSOAS_ESCALA,
      { tabela: 'SGH_PES_ESCALA', id: String(x.id) },
      (g) => g.excluirEscalaRascunho({ id: x.id, versao: e.versao, motivo: e.motivo.trim(), por: s.login }),
    );
    return {
      id: x.id,
      mensagem: `Escala excluída (${r.plantoes} plantão(ões) do rascunho). O retrato de cada linha ficou guardado.`,
      alertas: [],
    };
  }

  /**
   * Cancelamento lógico da escala PUBLICADA com motivo (matriz, linha "Ponto e escala"): o estado vira 'cancelada',
   * os plantões previstos ficam cancelados com o mesmo motivo, a trilha da escala e o evento de mudança na SGH_OUTBOX
   * registram. Recusa com a contagem se houver troca em aberto, realizado registrado (não recusado) ou acionamento
   * do sobreaviso: estes se resolvem antes (desistência da troca, estorno do realizado).
   */
  async cancelarEscala(s: SessaoCadastro, e: CancelarEscalaEntrada): Promise<ResultadoEscala> {
    await this.apoio.exigirLiberacao(s);
    const x = await this.escalaOu404(s, e.escala);
    if (x.estado === 'rascunho')
      throw recusaRegra('escala-rascunho', 'A escala em rascunho não se cancela: exclua-a (só sem vínculo).');
    if (x.estado === 'cancelada') throw recusaRegra('escala-cancelada', 'A escala já está cancelada.');
    this.conferirVersao(x, e.versao);
    const plantoes = await this.porta.plantoesDaEscala(s.porta, x.id);
    const ids = plantoes.map((p) => p.id);
    const [abertas, vinculos] = await Promise.all([
      this.porta.plantoesEmTrocaAberta(s.porta, ids),
      this.porta.dependenciasEscala(s.porta, x.id),
    ]);
    const bloqueio = vinculos.filter((v) => v.grupo !== 'Trocas de plantão');
    if (abertas.size > 0)
      bloqueio.unshift({
        grupo: 'Trocas de plantão em aberto',
        tabela: 'SGH_PES_TROCA',
        coluna: 'ID_PLANTAO',
        quantidade: abertas.size,
      });
    if (bloqueio.length > 0) throw recusaComVinculos(bloqueio, 'cancelada');
    const n = await this.apoio.sgh(
      s,
      E.pessoasEscalaCancelada.codigo,
      CHAVE_PESSOAS_ESCALA,
      { tabela: 'SGH_PES_ESCALA', id: String(x.id) },
      async (g) => {
        if ((await g.plantoesEmTrocaAberta(ids)).size > 0)
          throw recusaRegra(
            'troca-em-aberto',
            'Uma troca de plantão foi pedida enquanto você cancelava: releia a escala.',
          );
        const k = await g.cancelarEscala({
          id: x.id,
          versao: e.versao,
          motivo: e.motivo.trim(),
          por: s.login,
        });
        const ev = await g.evento({
          escala: x.id,
          plantao: null,
          acao: 'cancelada',
          descricao: `Escala cancelada: ${k} plantão(ões) previstos cancelados`,
          motivo: e.motivo.trim(),
          por: s.login,
        });
        await this.outboxMudanca(g, s, x, 'cancelada', ev);
        return k;
      },
    );
    return { id: x.id, mensagem: `Escala cancelada: ${n} plantão(ões) previstos cancelados.`, alertas: [] };
  }

  // ── Grade e publicação ──────────────────────────────────────────────────────────────────────────────────────

  /** Plantões previstos cujo conselho estará vencido (ou sem registro) no dia: bloqueiam a publicação (regra 3). */
  private async bloqueadosPeloConselho(
    s: SessaoCadastro,
    x: EscalaPesLida,
    previstos: readonly PlantaoPesLido[],
    vinculos: ReadonlyMap<number, VinculoPesLido>,
  ): Promise<Set<number>> {
    const exigido = CONSELHO_DA_ESCALA[x.tipo as TipoEscala];
    const r = new Set<number>();
    if (exigido === null || exigido === undefined) return r;
    const profs = [...new Set([...vinculos.values()].map((v) => v.profissional).filter((p) => p !== null))];
    const [regs, janelaDias] = await Promise.all([
      this.registrosDe(s, profs as number[]),
      this.janelaConselho(s),
    ]);
    for (const p of previstos) {
      const v = vinculos.get(p.vinculo);
      const lista = v?.profissional != null ? (regs.get(v.profissional) ?? []) : [];
      const c = conferirConselhoParaPlantao(lista, p.inicio, {
        ...(exigido !== 'qualquer' ? { conselhoExigido: exigido } : {}),
        janelaDias,
      });
      if (!c.permitido) r.add(p.id);
    }
    return r;
  }

  private async vinculosDe(s: SessaoCadastro, ids: readonly number[]) {
    const lidos = await Promise.all([...new Set(ids)].map((id) => this.pessoas.vinculo(s.porta, id)));
    return new Map(lidos.filter((v): v is VinculoPesLido => v !== null).map((v) => [v.id, v]));
  }

  async grade(s: SessaoCadastro, id: number): Promise<GradeEscala> {
    const x = await this.escalaOu404(s, id);
    const [plantoes, eventos, un, dom] = await Promise.all([
      this.porta.plantoesDaEscala(s.porta, x.id),
      this.porta.eventos(s.porta, x.id),
      this.mapaUnidades(s),
      this.temposParciais(s),
    ]);
    const vinculos = await this.vinculosDe(
      s,
      plantoes.map((p) => p.vinculo),
    );
    const [vig, regimes] = await Promise.all([
      this.porta.vigencias(s.porta, [...vinculos.keys()]),
      this.porta.regimes(s.porta),
    ]);
    const porId = new Map(regimes.map((r) => [r.id, r]));
    const primeiroDia = `${x.competencia}-01`;
    const previstos = plantoes.filter((p) => p.situacao === 'previsto');
    const linhas = [...vinculos.values()]
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.id - b.id)
      .map((v) => {
        const doVinculo = plantoes.filter((p) => p.vinculo === v.id);
        const atual = regimeNoDia(
          vig.filter((y) => y.vinculo === v.id),
          primeiroDia,
        );
        const r = atual ? porId.get(atual.regime) : undefined;
        const limite = limiteSemanalEfetivo(r ? this.regraDoRegime(r, dom) : null, v.tipo as TipoVinculo);
        const horas = horasPorSemana(doVinculo.filter((p) => p.situacao === 'previsto').map(proposto));
        return {
          vinculo: v.id,
          nome: v.nome,
          cargo: v.cargo,
          regime: r?.codigo ?? null,
          plantoes: doVinculo.map(plantaoLido),
          semanas: [...horas]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([semana, h]) => ({ semana, horas: h, limite })),
        };
      });
    const resumo = this.resumo(x, un);
    return {
      escala: { ...resumo, justificativaFuro: x.justificativaFuro },
      dias: diasDaCompetencia(x.competencia),
      linhas,
      furos: furosDaEscala(x.competencia, x.cobertura, previstos.map(proposto)),
      eventos: eventos.map((ev) => ({
        id: ev.id,
        acao: ev.acao as keyof typeof ACOES_EVENTO_ESCALA,
        plantao: ev.plantao,
        descricao: ev.descricao,
        motivo: ev.motivo,
        por: ev.por,
        em: ev.em,
      })),
    };
  }

  async publicar(s: SessaoCadastro, e: PublicarEscalaEntrada): Promise<ResultadoEscala> {
    await this.apoio.exigirLiberacao(s);
    const x = await this.escalaOu404(s, e.escala);
    if (x.versao !== e.versao)
      throw recusaRegra(
        'desatualizado',
        'A escala mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
      );
    const plantoes = await this.porta.plantoesDaEscala(s.porta, x.id);
    const previstos = plantoes.filter((p) => p.situacao === 'previsto');
    const vinculos = await this.vinculosDe(
      s,
      previstos.map((p) => p.vinculo),
    );
    const bloqueados = await this.bloqueadosPeloConselho(s, x, previstos, vinculos);
    const furos = furosDaEscala(x.competencia, x.cobertura, previstos.map(proposto));
    const c = conferirPublicacao({
      estado: x.estado as EstadoEscala,
      plantoesPrevistos: previstos.length,
      furos: furos.length,
      bloqueadosPeloConselho: bloqueados.size,
      justificativaFuro: e.justificativaFuro,
    });
    if (!c.ok)
      throw recusaRegra(
        c.codigo,
        c.mensagem,
        c.codigo === 'furo-sem-justificativa' ? ['justificativaFuro'] : undefined,
      );
    const justificativa = furos.length > 0 ? e.justificativaFuro : null;
    await this.apoio.sgh(
      s,
      E.pessoasEscalaPublicada.codigo,
      CHAVE_PESSOAS_ESCALA,
      { tabela: 'SGH_PES_ESCALA', id: String(x.id) },
      async (g) => {
        await g.publicarEscala({
          id: x.id,
          versao: e.versao,
          justificativaFuro: justificativa,
          por: s.login,
        });
        await g.evento({
          escala: x.id,
          plantao: null,
          acao: 'publicada',
          descricao: `${previstos.length} plantão(ões) previstos; ${furos.length} turno(s) abaixo da cobertura mínima`,
          motivo: justificativa,
          por: s.login,
        });
        await g.outbox({
          tipo: EVENTO_ESCALA_PUBLICADA,
          chave: `${s.hospital}:escala:${x.id}:publicada`,
          carga: { escala: x.id, competencia: x.competencia, unidade: x.unidade, plantoes: previstos.length },
        });
      },
    );
    const alertas =
      furos.length > 0
        ? [`Publicada com ${furos.length} turno(s) abaixo da cobertura mínima, com a justificativa.`]
        : [];
    return { id: x.id, mensagem: 'Escala publicada.', alertas };
  }
}

interface DominiosEscala {
  readonly jornadas: readonly { codigo: number; nome: string }[];
  readonly parciais: readonly TempoParcialLido[];
  readonly folgas: readonly { codigo: number; nome: string }[];
}

function plantaoLido(p: PlantaoPesLido): PlantaoLido {
  return {
    id: p.id,
    vinculo: p.vinculo,
    tipo: p.tipo as TipoPlantao,
    inicio: p.inicio,
    fim: p.fim,
    chegadaMin: p.chegadaMin,
    situacao: p.situacao === 'cancelado' ? 'cancelado' : 'previsto',
    alertaConselho:
      p.alertaConselho === 'aVencer' || p.alertaConselho === 'semValidade' ? p.alertaConselho : null,
    redeNaoConferida: p.redeNaoConferida,
    motivo: p.motivo,
    versao: p.versao,
  };
}
