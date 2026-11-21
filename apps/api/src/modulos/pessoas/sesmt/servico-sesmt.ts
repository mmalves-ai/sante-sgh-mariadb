// Serviço do SESMT, fatia F5 (M52.5; ficha, seções 4 a 8, regras 16 a 19 e 22; cap-07 §7.1.4): o painel das pendências,
// o prontuário ocupacional e o ASO, a carteira de vacinas, os acidentes com a profilaxia, a sorologia e a CAT, o mapa de
// riscos e o EPI por função, as entregas de EPI, a dosimetria e a exposição a quimioterápico, e os documentos (CAT e
// comprovante de entrega). Toda gravação confere a chave `pessoas.sesmt` e a permissão, relê o colaborador do
// estabelecimento da sessão e vai numa transação só SGH_ com a trilha. O prontuário ocupacional é dado de saúde: leitura
// auditada (o controlador) e nunca exposto ao PEP (regra 16). As regras ficam em @sgh/dominio-pessoas.
import {
  CODIGOS_PENDENCIA_SESMT,
  DOSES_VACINA_SESMT,
  EVENTOS_AUDITAVEIS,
  JANELA_ALERTA_ASO_DIAS,
  MARCOS_SOROLOGIA,
  NATUREZAS_ASO,
  naturezaAso,
  PERIODICIDADE_ASO_MESES,
  PRAZO_CAT_DIAS_UTEIS,
  type AcidenteResposta,
  type AcidenteResumo,
  type AnularAcidenteEntrada,
  type CancelarEpiEntrada,
  type CorrecaoResposta,
  type DadosCatEntrada,
  type EsocialDoAcidente,
  type DescartarEventoEsocialEntrada,
  type EfeitoEsocialSesmt,
  type ExcluirEventoEsocialEntrada,
  type GerarCatEsocialEntrada,
  type ResultadoGeracaoEsocial,
  type RetificarAcidenteEntrada,
  type ApoioSesmt,
  type AsoResposta,
  type AssinaturaEpiEntrada,
  type BuscaColaboradoresSesmt,
  type CarteiraVacinas,
  type ColaboradorSesmt,
  type DoseVacinaSesmt,
  type EmitirCatEntrada,
  type EncerrarAcidenteEntrada,
  type EncerrarLinhaRiscoEntrada,
  type EpiDoColaborador,
  type FatoresRisco,
  type FiltroAcidentesEntrada,
  type FiltroRiscosEntrada,
  type FiltroSesmtEntrada,
  type LinhaPainelSesmt,
  type LinhaRiscoEntrada,
  type LinhaRiscoResposta,
  type ListaAcidentes,
  type MapaRiscos,
  type MarcoSorologia,
  type PainelSesmt,
  type PendenciaResposta,
  type PendenciaSesmt,
  type PppColaborador,
  type ProfilaxiaEntrada,
  type ProntuarioOcupacional,
  type RegistrarAcidenteEntrada,
  type RegistrarAsoEntrada,
  type RegistrarVacinaColaboradorEntrada,
  type RegistroEpiEntrada,
  type RegistroEpiResposta,
  type ResultadoSesmt,
  type ResultadoSorologia,
  type SituacaoProfilaxia,
  type SorologiaEntrada,
  VACINAS_SESMT,
  type VacinaSesmt,
} from '@sgh/contratos';
import {
  type AcidenteParaSituacao,
  type AsoLido,
  asosEmVigor,
  type CatParaEvento,
  chaveFuncao,
  codigoNoDominio,
  conferirAcidente,
  conferirAso,
  conferirDosimetria,
  conferirEmissaoCat,
  conferirEncerramento,
  conferirEntregaEpi,
  conferirVacina,
  dataDe,
  diasEntre,
  doseNoAno,
  type EntregaLida,
  episFaltando,
  juntarPendencias,
  linhasDaFuncao,
  linhasNoPeriodo,
  marcosSorologia,
  pendenciasAcidente,
  pendenciasDoAso,
  pendenciasEpi,
  periodosDeAtribuicao,
  prazoCat,
  profilaxiaSugerida,
  proximoAso,
  type RecusaSesmt,
  type RegistroVacinaLido,
  situacaoAso,
  situacaoVacinas,
} from '@sgh/dominio-pessoas';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../../config/public-api.js';
import { ApoioGravacao } from '../../exames/public-api.js';
import type { PortaPessoas } from '../porta.js';
import type {
  AcidenteTrabalho,
  CorrecaoSesmt,
  DadosCat,
  DominiosSesmt,
  DoseVacinaColaborador,
  GravadorSesmt,
  LinhaRiscoFuncao,
  PortaSesmt,
  RegistroOcupacional,
  RegistroProtecao,
  SorologiaAcidente,
} from './porta-sesmt.js';

/** O vínculo de trabalho como a gestão de pessoas o lê. */
type VinculoPessoa = NonNullable<Awaited<ReturnType<PortaPessoas['vinculo']>>>;

/** O evento do eSocial na fila (o que o SESMT lê da fila do serviço do eSocial). */
export interface EventoEsocialNaFila {
  readonly id: number;
  readonly evento: string;
  readonly situacao: string;
  readonly recibo: string | null;
  readonly eventoAnterior: number | null;
  readonly motivo: string | null;
  readonly criadoEm: string;
  readonly versao: number;
  /** Empresa (estabelecimento empregador) do evento. */
  readonly empresa: number;
}

const E = EVENTOS_AUDITAVEIS;
export const CHAVE_PESSOAS_SESMT = 'pessoas.sesmt';
export const PERMISSOES_SESMT = {
  ocupacionalLer: 'pessoas.ocupacional.ler',
  ocupacionalRegistrar: 'pessoas.ocupacional.registrar',
  acidenteLer: 'pessoas.acidente.ler',
  acidenteRegistrar: 'pessoas.acidente.registrar',
  riscoLer: 'pessoas.risco.ler',
  riscoEditar: 'pessoas.risco.editar',
  epiEntregar: 'pessoas.epi.entregar',
  vacinaLer: 'pessoas.vacinacao.ler',
  vacinaRegistrar: 'pessoas.vacinacao.registrar',
} as const;
const P = PERMISSOES_SESMT;
const TTL_DOMINIOS_MS = 10 * 60_000;

const naoEncontrado = (o: string) =>
  new ErroProblema(
    'nao-encontrado',
    404,
    `${o} não encontrado`,
    `O registro não existe neste estabelecimento.`,
  );
const recusar = (r: RecusaSesmt) =>
  new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', r.mensagem, {
    codigo: r.codigo,
    ...(r.campo ? { campos: [r.campo] } : {}),
  });
const recusaRegra = (codigo: string, mensagem: string, campo: string | null = null) =>
  recusar({ codigo, mensagem, campo });

/** O texto do pedido de exame ao laboratório (regra 22): sem padrão de convênio do funcionário, pelo fluxo de hoje. */
export const MOTIVO_PEDIDO_EXAME =
  'O pedido do exame ocupacional ao laboratório do hospital segue o fluxo de pedido de exame de hoje: o convênio de atendimento de funcionário ainda não foi definido. Aqui fica o registro do resultado.';

function rotulos(xs: readonly { codigo: number; rotulo: string }[]): Map<number, string> {
  return new Map(xs.map((x) => [x.codigo, x.rotulo]));
}
function resposta(p: readonly PendenciaSesmt[]): PendenciaResposta[] {
  return juntarPendencias(p);
}

/**
 * W0-06: o pedaço da fila do eSocial que o SESMT usa para o S-2210 do acidente (o ServicoEsocial atende; nulo nos
 * testes que não olham a fila). Nada sai do dev: a transmissão segue o lote e fica desligada fora de produção.
 */
export interface FilaCatEsocial {
  empresasCat(s: SessaoCadastro): Promise<{ codigo: number; rotulo: string }[]>;
  eventosCat(s: SessaoCadastro, acidente: number): Promise<EventoEsocialNaFila[]>;
  gerarCat(
    s: SessaoCadastro,
    x: {
      empresa: number;
      vinculo: number;
      cat: CatParaEvento;
      retificar: EventoEsocialNaFila | null;
      gravar: boolean;
    },
  ): Promise<ResultadoGeracaoEsocial>;
  descartar(s: SessaoCadastro, id: number, x: DescartarEventoEsocialEntrada): Promise<unknown>;
  excluir(s: SessaoCadastro, id: number, x: ExcluirEventoEsocialEntrada): Promise<ResultadoGeracaoEsocial>;
}

/** W0-06: o histórico das correções (motivo, quem, quando e o valor anterior), da mais nova para a mais antiga. */
function correcoesResposta(xs: readonly CorrecaoSesmt[]): CorrecaoResposta[] {
  return [...xs]
    .sort((a, b) => b.id - a.id)
    .map((c) => ({
      id: c.id,
      operacao: c.operacao,
      registro: c.registro,
      antes: c.antes,
      depois: c.depois,
      motivo: c.motivo,
      por: c.por,
      em: c.em,
    }));
}

/** As situações do S-2210 na fila: o que ainda não saiu se descarta; o que está em lote ou enviado espera o retorno. */
const CAT_NAO_ENVIADA: ReadonlySet<string> = new Set(['gerado', 'invalido', 'validado', 'rejeitado']);
const CAT_EM_TRANSITO: ReadonlySet<string> = new Set(['em-lote', 'enviado']);

/** O acidente lido no formato do S-2210 (o local do acidente sem tipo é o estabelecimento do empregador). */
export function catParaEvento(a: AcidenteTrabalho): CatParaEvento {
  const c = a.cat;
  const tipoCat = a.tipoCat === 1 || a.tipoCat === 2 || a.tipoCat === 3 ? a.tipoCat : null;
  const lat = c.lateralidade;
  return {
    id: a.id,
    ocorridoEm: a.ocorridoEm,
    tipo: a.tipo === 'trajeto' ? 'trajeto' : a.tipo === 'doenca' ? 'doenca' : 'tipico',
    horasTrabalhadasAntes: c.horasAntes,
    tipoCat,
    obito: a.obito,
    dataObito: c.dataObito,
    comunicouPolicia: c.comunicouPolicia,
    situacaoGeradora: a.situacao,
    observacao: c.observacao,
    ultimoDiaTrabalhado: c.ultimoDiaTrabalhado,
    houveAfastamento: a.afastamento,
    local: {
      tipo: (c.localTipo ?? 1) as CatParaEvento['local']['tipo'],
      descricao: a.local,
      logradouro: c.logradouro,
      numero: c.numero,
      cep: c.cep,
      municipio: c.municipio,
      uf: c.uf,
    },
    parteAtingida: a.parteCorpo,
    lateralidade: lat === 0 || lat === 1 || lat === 2 || lat === 3 ? lat : null,
    agenteCausador: a.agente,
    atestado:
      c.atestadoData === null
        ? null
        : {
            data: c.atestadoData,
            hora: c.atestadoHora ?? '',
            internacao: c.internacao,
            duracaoDias: c.duracaoDias ?? -1,
            afastamento: a.afastamento,
            naturezaLesao: a.natureza,
            complementoLesao: c.complementoLesao,
            diagnostico: c.diagnostico,
            cid: c.cid,
            emitenteNome: c.emitenteNome,
            emitenteConselho:
              c.emitenteConselho === 1 || c.emitenteConselho === 2 || c.emitenteConselho === 3
                ? c.emitenteConselho
                : null,
            emitenteNumero: c.emitenteNumero,
            emitenteUf: c.emitenteUf,
          },
    reciboCatOrigem: c.reciboOrigem,
  };
}

/** O que a retificação troca (o valor anterior e o novo vão à trilha_auditoria). */
function retificaveis(a: AcidenteTrabalho): Record<string, unknown> {
  return {
    ocorridoEm: a.ocorridoEm,
    tipo: a.tipo,
    local: a.local,
    descricao: a.descricao,
    parteCorpo: a.parteCorpo,
    natureza: a.natureza,
    agente: a.agente,
    situacao: a.situacao,
    afastamento: a.afastamento,
    obito: a.obito,
    catPrazo: a.catPrazo,
    cat: a.cat,
  };
}

const semEfeito: EfeitoEsocialSesmt = {
  operacao: 'nenhuma',
  evento: null,
  anterior: null,
  valido: true,
  pendencias: [],
};

export class ServicoSesmt {
  readonly apoio: ApoioGravacao<GravadorSesmt>;
  private readonly dominiosCache = new Map<string, { ate: number; d: DominiosSesmt }>();

  constructor(
    readonly porta: PortaSesmt,
    readonly pessoas: PortaPessoas,
    trilha: RegistradorTrilha,
    configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
    /** W0-06: a fila do eSocial do S-2210 (nula: a retificação e a anulação não olham a fila). */
    readonly esocial: FilaCatEsocial | null = null,
  ) {
    this.apoio = new ApoioGravacao<GravadorSesmt>(
      { chave: CHAVE_PESSOAS_SESMT, nome: 'o SESMT', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  // ── Apoio ───────────────────────────────────────────────────────────────────────────────────────────────────

  private async dominios(s: SessaoCadastro): Promise<DominiosSesmt> {
    const c = this.dominiosCache.get(s.hospital);
    if (c && c.ate > Date.now()) return c.d;
    const d = await this.porta.dominios(s.porta);
    this.dominiosCache.set(s.hospital, { ate: Date.now() + TTL_DOMINIOS_MS, d });
    return d;
  }

  private async parametros(s: SessaoCadastro) {
    const ler = (k: string) => this.apoio.parametro(s, k).catch(() => 0);
    const [periodicidade, alerta, prazo] = await Promise.all([
      ler('pessoas.sesmt.periodicidadeAsoMeses'),
      ler('pessoas.sesmt.alertaAsoDias'),
      ler('pessoas.sesmt.prazoCatDiasUteis'),
    ]);
    return {
      periodicidadeAsoMeses: periodicidade > 0 ? periodicidade : PERIODICIDADE_ASO_MESES,
      alertaAsoDias: alerta > 0 ? alerta : JANELA_ALERTA_ASO_DIAS,
      prazoCatDiasUteis: prazo > 0 ? prazo : PRAZO_CAT_DIAS_UTEIS,
    };
  }

  async apoioTela(s: SessaoCadastro): Promise<ApoioSesmt> {
    const [relogio, dominios, unidades, parametros, gravacao] = await Promise.all([
      this.porta.relogio(s.porta),
      this.dominios(s),
      this.pessoas.unidades(s.porta),
      this.parametros(s),
      this.apoio.gravacao(s, {
        ocupacional: P.ocupacionalRegistrar,
        vacina: P.vacinaRegistrar,
        acidente: P.acidenteRegistrar,
        risco: P.riscoEditar,
        epi: P.epiEntregar,
      }),
    ]);
    const op = (k: string) => gravacao.operacoes[k]?.pode ?? false;
    const motivos = ['ocupacional', 'vacina', 'acidente', 'risco', 'epi']
      .map((k) => gravacao.operacoes[k])
      .filter((o) => o && !o.pode)
      .map((o) => o?.motivo ?? null);
    return {
      hoje: relogio.hoje,
      agora: relogio.agora,
      gravacao: { ligada: gravacao.ligada, motivo: gravacao.motivo },
      acoes: {
        ocupacional: op('ocupacional'),
        vacina: op('vacina'),
        acidente: op('acidente'),
        risco: op('risco'),
        epi: op('epi'),
        motivo: motivos.length === 5 ? (motivos[0] ?? gravacao.motivo) : null,
      },
      dominios: { ...dominios, unidades: unidades.map((u) => ({ codigo: u.codigo, rotulo: u.nome })) },
      parametros,
    };
  }

  // ── Colaborador ─────────────────────────────────────────────────────────────────────────────────────────────

  private async vinculoOu404(s: SessaoCadastro, id: number): Promise<VinculoPessoa> {
    const v = await this.pessoas.vinculo(s.porta, id);
    if (!v || v.estabelecimento !== s.porta.estabelecimento) throw naoEncontrado('Colaborador');
    return v;
  }

  private async nomesUnidades(s: SessaoCadastro): Promise<Map<number, string>> {
    return new Map((await this.pessoas.unidades(s.porta)).map((u) => [u.codigo, u.nome]));
  }

  private colaborador(v: VinculoPessoa, unidades: Map<number, string>): ColaboradorSesmt {
    return {
      vinculo: v.id,
      nome: v.nome,
      matricula: v.matricula,
      cargo: v.cargo,
      funcao: v.funcao,
      unidade: v.unidade,
      unidadeNome: v.unidade !== null ? (unidades.get(v.unidade) ?? null) : null,
      setor: v.setor,
      admissao: v.admissao,
      desligamento: v.desligamento,
    };
  }

  async buscarColaboradores(
    s: SessaoCadastro,
    termo: string,
    estado: 'ativo' | 'desligado' | 'todos',
  ): Promise<BuscaColaboradoresSesmt> {
    const [r, unidades] = await Promise.all([
      this.pessoas.listarVinculos(s.porta, { termo, estado, limite: 20 }),
      this.nomesUnidades(s),
    ]);
    return { itens: r.itens.map((v) => this.colaborador(v, unidades)) };
  }

  // ── Painel (regras 17 a 19: as pendências dos ativos) ───────────────────────────────────────────────────────

  async painel(s: SessaoCadastro, f: FiltroSesmtEntrada): Promise<PainelSesmt> {
    const [{ hoje }, params, unidades] = await Promise.all([
      this.porta.relogio(s.porta),
      this.parametros(s),
      this.nomesUnidades(s),
    ]);
    const r = await this.porta.resumo(s.porta, Number(hoje.slice(0, 4)));
    const por = <T extends { vinculo: number }>(xs: readonly T[]) => {
      const m = new Map<number, T[]>();
      for (const x of xs) m.set(x.vinculo, [...(m.get(x.vinculo) ?? []), x]);
      return m;
    };
    const asos = por(r.asos);
    const vacinas = por(r.vacinas);
    const epis = por(r.epis);
    const acidentes = por(r.acidentes);
    const soro = new Map<number, SorologiaAcidente[]>();
    for (const x of r.sorologias) soro.set(x.acidente, [...(soro.get(x.acidente) ?? []), x]);
    // Regra 16 (segregação): cada pendência só aparece a quem tem a permissão da tela de origem; o painel
    // (pessoas.ocupacional.ler) não revela acidente, CAT, sorologia, EPI, dose ou vacina a quem não as lê. As contagens
    // são feitas depois desse corte.
    const veVacinas = s.pode('pessoas.vacinacao.ler');
    const veRiscos = s.pode('pessoas.risco.ler');
    const veAcidentes = s.pode('pessoas.acidente.ler');
    const linhas: LinhaPainelSesmt[] = r.vinculos.map((v) => {
      const resumo = situacaoAso((asos.get(v.id) ?? []).map(asoLido), hoje, params.alertaAsoDias);
      const pend: PendenciaSesmt[] = [
        ...pendenciasDoAso(resumo, true),
        ...(veVacinas
          ? situacaoVacinas((vacinas.get(v.id) ?? []).map(vacinaLida), hoje).flatMap((x) => x.pendencias)
          : []),
        ...(veRiscos ? pendenciasEpi([], (epis.get(v.id) ?? []).map(entregaLida), hoje) : []),
        ...(veAcidentes
          ? (acidentes.get(v.id) ?? []).flatMap((a) =>
              pendenciasAcidente(paraSituacao(a, soro.get(a.id) ?? []), hoje),
            )
          : []),
      ];
      return {
        vinculo: v.id,
        nome: v.nome,
        matricula: v.matricula,
        cargo: v.cargo,
        funcao: v.funcao,
        unidade: v.unidade,
        unidadeNome: v.unidade !== null ? (unidades.get(v.unidade) ?? null) : null,
        setor: v.setor,
        admissao: v.admissao,
        desligamento: null,
        proximoAso: resumo.ultimo?.proximo ?? null,
        pendencias: resposta(pend),
      };
    });
    const contagens: Partial<Record<PendenciaSesmt, number>> = {};
    for (const c of CODIGOS_PENDENCIA_SESMT) {
      const k = linhas.filter((l) => l.pendencias.some((p) => p.codigo === c)).length;
      if (k > 0) contagens[c] = k;
    }
    const termo = (f.termo ?? '').trim().toUpperCase();
    const filtradas = linhas.filter(
      (l) =>
        (!termo || l.nome.toUpperCase().includes(termo) || (l.matricula ?? '') === termo) &&
        (f.unidade === undefined || l.unidade === f.unidade) &&
        (f.pendencia === undefined || l.pendencias.some((p) => p.codigo === f.pendencia)) &&
        (!f.somentePendentes || l.pendencias.length > 0),
    );
    const paginas = Math.max(1, Math.ceil(filtradas.length / f.limite));
    const pagina = Math.min(f.pagina, paginas - 1);
    return {
      hoje,
      itens: filtradas.slice(pagina * f.limite, (pagina + 1) * f.limite),
      total: filtradas.length,
      pagina,
      paginas,
      contagens,
      ativos: linhas.length,
    };
  }

  // ── Prontuário ocupacional e ASO (regra 17) ─────────────────────────────────────────────────────────────────

  async prontuario(s: SessaoCadastro, vinculo: number): Promise<ProntuarioOcupacional> {
    const v = await this.vinculoOu404(s, vinculo);
    const [{ hoje }, rows, dominios, params, unidades] = await Promise.all([
      this.porta.relogio(s.porta),
      this.porta.ocupacional(s.porta, v.id),
      this.dominios(s),
      this.parametros(s),
      this.nomesUnidades(s),
    ]);
    const tipos = rotulos(dominios.tiposAso);
    const conclusoes = rotulos(dominios.conclusoesAso);
    const asosRows = rows.filter((x) => x.registro === 'aso');
    const retificadoPor = new Map<number, number>();
    for (const a of asosRows) if (a.retifica !== null) retificadoPor.set(a.retifica, a.id);
    const asos: AsoResposta[] = asosRows.map((a) => ({
      id: a.id,
      tipo: a.tipo ?? -1,
      tipoRotulo: tipos.get(a.tipo ?? -1) ?? NATUREZAS_ASO[naturezaAso(a.tipo ?? -1)],
      natureza: naturezaAso(a.tipo ?? -1),
      data: a.data,
      conclusao: a.conclusao ?? 0,
      conclusaoRotulo: conclusoes.get(a.conclusao ?? 0) ?? '',
      restricoes: a.restricoes,
      medico: a.medico ?? '',
      medicoConselho: a.medicoConselho,
      proximo: a.proximo,
      observacao: a.observacao,
      exames: rows
        .filter((x) => x.registro === 'exame' && x.aso === a.id)
        .map((x) => ({
          id: x.id,
          exame: x.exame ?? '',
          data: x.data,
          resultado: x.resultadoExame ?? 'normal',
        })),
      retifica: a.retifica,
      motivoRetificacao: a.motivoRetificacao,
      retificadoPor: retificadoPor.get(a.id) ?? null,
      registradoPor: a.criadoPor,
      registradoEm: a.criadoEm,
    }));
    const resumo = situacaoAso(asosRows.map(asoLido), hoje, params.alertaAsoDias);
    return {
      colaborador: this.colaborador(v, unidades),
      hoje,
      aso: {
        situacao: resumo.situacao,
        proximo: resumo.ultimo?.proximo ?? null,
        diasParaVencer: resumo.diasParaVencer,
      },
      asos,
      pendencias: resposta(pendenciasDoAso(resumo, v.desligamento === null)),
      pedidoExame: { integrado: false, motivo: MOTIVO_PEDIDO_EXAME },
    };
  }

  async registrarAso(s: SessaoCadastro, e: RegistrarAsoEntrada): Promise<ResultadoSesmt> {
    await this.apoio.exigirLiberacao(s);
    const v = await this.vinculoOu404(s, e.vinculo);
    const [{ hoje }, dominios, params] = await Promise.all([
      this.porta.relogio(s.porta),
      this.dominios(s),
      this.parametros(s),
    ]);
    if (!dominios.tiposAso.some((t) => t.codigo === e.tipo))
      throw recusaRegra('tipo-aso', 'Escolha o tipo do ASO.', 'tipo');
    if (!dominios.conclusoesAso.some((t) => t.codigo === e.conclusao))
      throw recusaRegra('conclusao-aso', 'Escolha a conclusão do ASO.', 'conclusao');
    const r = await this.apoio.sgh(
      s,
      E.pessoasAsoRegistrado.codigo,
      CHAVE_PESSOAS_SESMT,
      (x: { id: number }) => ({ tabela: 'aso', id: String(x.id) }),
      async (g) => {
        const anteriores = (await g.ocupacional(v.id)).filter((x) => x.registro === 'aso');
        if (e.retifica !== null) {
          const alvo = anteriores.find((a) => a.id === e.retifica);
          if (!alvo)
            throw recusaRegra(
              'retifica-inexistente',
              'O ASO a retificar não é deste colaborador.',
              'retifica',
            );
          if (anteriores.some((a) => a.retifica === e.retifica))
            throw recusaRegra(
              'ja-retificado',
              'Este ASO já foi retificado: retifique o registro mais novo.',
              'retifica',
            );
        }
        const recusa = conferirAso(
          {
            tipo: e.tipo,
            data: e.data,
            conclusao: e.conclusao,
            restricoes: e.restricoes,
            proximo: e.proximo,
            exames: e.exames,
          },
          {
            hoje,
            admissao: v.admissao,
            desligamento: v.desligamento,
            anteriores: asosEmVigor(anteriores.map(asoLido)),
            retifica: e.retifica,
          },
        );
        if (recusa) throw recusar(recusa);
        const id = await g.incluirAso({
          vinculo: v.id,
          tipo: e.tipo,
          data: e.data,
          conclusao: e.conclusao,
          restricoes: e.restricoes,
          medico: e.medico,
          medicoConselho: e.medicoConselho,
          proximo: proximoAso(e.data, naturezaAso(e.tipo), params.periodicidadeAsoMeses, e.proximo),
          observacao: e.observacao,
          retifica: e.retifica,
          motivoRetificacao: e.motivoRetificacao,
          por: s.login,
        });
        for (const x of e.exames)
          await g.incluirExame({
            vinculo: v.id,
            aso: id,
            exame: x.exame,
            data: x.data,
            resultado: x.resultado,
            por: s.login,
          });
        return { id };
      },
    );
    return { id: r.id, mensagem: e.retifica !== null ? 'ASO retificado.' : 'ASO registrado.' };
  }

  // ── Vacinas (regra 17) ──────────────────────────────────────────────────────────────────────────────────────

  async carteira(s: SessaoCadastro, vinculo: number): Promise<CarteiraVacinas> {
    const v = await this.vinculoOu404(s, vinculo);
    const [{ hoje }, rows, unidades] = await Promise.all([
      this.porta.relogio(s.porta),
      this.porta.vacinas(s.porta, v.id),
      this.nomesUnidades(s),
    ]);
    const retificadoPor = new Map<number, number>();
    for (const x of rows) if (x.retifica !== null) retificadoPor.set(x.retifica, x.id);
    return {
      colaborador: this.colaborador(v, unidades),
      hoje,
      situacao: situacaoVacinas(rows.map(vacinaLida), hoje).map((x) => ({
        vacina: x.vacina,
        rotulo: VACINAS_SESMT[x.vacina].rotulo,
        doses: x.doses,
        esquema: x.esquema,
        completo: x.completo,
        ultimaDose: x.ultimaDose,
        reforcoAte: x.reforcoAte,
        antiHbs: x.antiHbs,
        pendencias: resposta(x.pendencias),
      })),
      registros: [...rows]
        .sort((a, b) => (a.data === b.data ? b.id - a.id : a.data < b.data ? 1 : -1))
        .map((x) => ({
          id: x.id,
          registro: x.registro,
          vacina: x.vacina as VacinaSesmt,
          vacinaRotulo: VACINAS_SESMT[x.vacina as VacinaSesmt]?.rotulo ?? x.vacina,
          dose: x.dose as DoseVacinaSesmt | null,
          data: x.data,
          lote: x.lote,
          validadeLote: x.validadeLote,
          antiHbs: x.antiHbs,
          observacao: x.observacao,
          retifica: x.retifica,
          motivoRetificacao: x.motivoRetificacao,
          retificadoPor: retificadoPor.get(x.id) ?? null,
          registradoPor: x.criadoPor,
        })),
    };
  }

  async registrarVacina(s: SessaoCadastro, e: RegistrarVacinaColaboradorEntrada): Promise<ResultadoSesmt> {
    await this.apoio.exigirLiberacao(s);
    const v = await this.vinculoOu404(s, e.vinculo);
    const [{ hoje }, dominios] = await Promise.all([this.porta.relogio(s.porta), this.dominios(s)]);
    if (diasEntre(v.admissao, e.data) < -3650)
      throw recusaRegra('data-antiga', 'A data é de mais de 10 anos antes da admissão: confira.', 'data');
    const r = await this.apoio.sgh(
      s,
      E.pessoasVacinaRegistrada.codigo,
      CHAVE_PESSOAS_SESMT,
      (x: { id: number }) => ({ tabela: 'vacina_colaborador', id: String(x.id) }),
      async (g) => {
        const anteriores = await g.vacinas(v.id);
        if (e.retifica !== null) {
          const alvo = anteriores.find((a) => a.id === e.retifica);
          if (!alvo)
            throw recusaRegra(
              'retifica-inexistente',
              'O registro a retificar não é deste colaborador.',
              'retifica',
            );
          if (anteriores.some((a) => a.retifica === e.retifica))
            throw recusaRegra(
              'ja-retificado',
              'Este registro já foi retificado: retifique o mais novo.',
              'retifica',
            );
        }
        const recusa = conferirVacina(
          {
            registro: e.registro,
            vacina: e.vacina,
            dose: e.registro === 'dose' ? e.dose : null,
            data: e.data,
            validadeLote: e.validadeLote,
            antiHbs: e.antiHbs,
          },
          hoje,
          anteriores.map(vacinaLida),
          e.retifica,
        );
        if (recusa) throw recusar(recusa);
        const dose = e.registro === 'dose' ? e.dose : null;
        const id = await g.incluirVacina({
          vinculo: v.id,
          registro: e.registro,
          vacina: e.vacina,
          // D-VAC-525: o código do domínio lido na hora pela descrição; sem casamento único, vazio.
          codigoVacina: codigoNoDominio(dominios.vacinasCadastro, VACINAS_SESMT[e.vacina].termos),
          dose,
          codigoDose: dose
            ? codigoNoDominio(dominios.dosesVacinaCadastro, DOSES_VACINA_SESMT[dose].termos)
            : null,
          data: e.data,
          lote: e.registro === 'dose' ? e.lote : null,
          validadeLote: e.registro === 'dose' ? e.validadeLote : null,
          antiHbs: e.registro === 'anti-hbs' ? e.antiHbs : null,
          observacao: e.observacao,
          retifica: e.retifica,
          motivoRetificacao: e.motivoRetificacao,
          por: s.login,
        });
        return { id };
      },
    );
    return { id: r.id, mensagem: e.registro === 'dose' ? 'Dose registrada.' : 'Anti-HBs registrado.' };
  }

  // ── Acidentes e CAT (regra 18) ──────────────────────────────────────────────────────────────────────────────

  private resumoAcidente(
    a: AcidenteTrabalho,
    nome: string,
    soro: readonly SorologiaAcidente[],
    hoje: string,
  ): AcidenteResumo {
    return {
      id: a.id,
      vinculo: a.vinculo,
      nome,
      ocorridoEm: a.ocorridoEm,
      tipo: a.tipo as AcidenteResumo['tipo'],
      biologico: a.biologico,
      estado: a.estado,
      catPrazo: a.catPrazo,
      catNumero: a.catNumero,
      profilaxia: a.profilaxia as SituacaoProfilaxia,
      pendencias: resposta(pendenciasAcidente(paraSituacao(a, soro), hoje)),
    };
  }

  async listarAcidentes(s: SessaoCadastro, f: FiltroAcidentesEntrada): Promise<ListaAcidentes> {
    const [{ hoje }, r] = await Promise.all([
      this.porta.relogio(s.porta),
      this.porta.listarAcidentes(s.porta, {
        estado: f.estado,
        limite: f.limite,
        ...(f.vinculo !== undefined ? { vinculo: f.vinculo } : {}),
        ...(f.depois !== undefined ? { depois: f.depois } : {}),
      }),
    ]);
    const ids = [...new Set(r.itens.map((a) => a.vinculo))];
    const [vincs, soro] = await Promise.all([
      Promise.all(ids.map((id) => this.pessoas.vinculo(s.porta, id))),
      this.porta.sorologias(
        s.porta,
        r.itens.map((a) => a.id),
      ),
    ]);
    const nomes = new Map(vincs.filter((v): v is VinculoPessoa => v !== null).map((v) => [v.id, v.nome]));
    return {
      hoje,
      itens: r.itens.map((a) =>
        this.resumoAcidente(
          a,
          nomes.get(a.vinculo) ?? '',
          soro.filter((x) => x.acidente === a.id),
          hoje,
        ),
      ),
      depois: r.depois,
    };
  }

  private async acidenteOu404(s: SessaoCadastro, id: number): Promise<AcidenteTrabalho> {
    const a = await this.porta.acidente(s.porta, id);
    if (!a) throw naoEncontrado('Acidente');
    return a;
  }

  async acidente(s: SessaoCadastro, id: number): Promise<AcidenteResposta> {
    const a = await this.acidenteOu404(s, id);
    const [{ hoje }, v, soro, unidades, correcoes, esocial] = await Promise.all([
      this.porta.relogio(s.porta),
      this.vinculoOu404(s, a.vinculo),
      this.porta.sorologias(s.porta, [a.id]),
      this.nomesUnidades(s),
      this.porta.correcoes(s.porta, 'comunicacao_acidente', [a.id]),
      this.esocialDoAcidente(s, a.id),
    ]);
    return {
      ...this.resumoAcidente(a, v.nome, soro, hoje),
      versao: a.versao,
      colaborador: this.colaborador(v, unidades),
      unidade: a.unidade,
      local: a.local,
      descricao: a.descricao,
      perfurocortante: a.perfurocortante,
      exposicao: a.exposicao as AcidenteResposta['exposicao'],
      material: a.material as AcidenteResposta['material'],
      fonte: a.fonte as AcidenteResposta['fonte'],
      fonteTeste: a.fonteTeste as AcidenteResposta['fonteTeste'],
      parteCorpo: a.parteCorpo,
      natureza: a.natureza,
      agente: a.agente,
      situacao: a.situacao,
      afastamento: a.afastamento,
      obito: a.obito,
      profilaxiaEm: a.profilaxiaEm,
      profilaxiaObs: a.profilaxiaObs,
      profilaxiaSugerida: profilaxiaSugerida({
        biologico: a.biologico,
        perfurocortante: a.perfurocortante,
        exposicao: a.exposicao as AcidenteResposta['exposicao'],
        material: a.material as AcidenteResposta['material'],
        fonteTeste: a.fonteTeste as AcidenteResposta['fonteTeste'],
      }),
      tipoCat: a.tipoCat,
      iniciativaCat: a.iniciativaCat,
      catEmitidaEm: a.catEmitidaEm,
      catEmitidaPor: a.catEmitidaPor,
      encerradoEm: a.encerradoEm,
      motivoEncerramento: a.motivoEncerramento,
      sorologias: soro.map((x) => ({
        id: x.id,
        marco: x.marco as MarcoSorologia,
        marcoRotulo: MARCOS_SOROLOGIA[x.marco as MarcoSorologia]?.rotulo ?? x.marco,
        prevista: x.prevista,
        realizada: x.realizada,
        resultado: x.resultado as ResultadoSorologia | null,
        observacao: x.observacao,
        atrasada: x.resultado === null && diasEntre(x.prevista, hoje) > 7,
      })),
      registradoPor: a.criadoPor,
      cat: a.cat as DadosCatEntrada,
      anuladoEm: a.anuladoEm,
      anuladoPor: a.anuladoPor,
      correcoes: correcoesResposta(correcoes),
      esocial,
    };
  }

  /** W0-06: as empresas para o S-2210 e os eventos do acidente na fila (original, retificador e descartado guardados). */
  private async esocialDoAcidente(s: SessaoCadastro, acidente: number): Promise<EsocialDoAcidente | null> {
    if (!this.esocial) return null;
    const [empresas, eventos] = await Promise.all([
      this.esocial.empresasCat(s),
      this.esocial.eventosCat(s, acidente),
    ]);
    return {
      empresas,
      eventos: [...eventos]
        .sort((x, y) => y.id - x.id)
        .map((x) => ({
          id: x.id,
          evento: x.evento,
          situacao: x.situacao,
          recibo: x.recibo,
          anterior: x.eventoAnterior,
          motivo: x.motivo,
          em: x.criadoEm,
        })),
    };
  }

  async registrarAcidente(s: SessaoCadastro, e: RegistrarAcidenteEntrada): Promise<ResultadoSesmt> {
    await this.apoio.exigirLiberacao(s);
    const v = await this.vinculoOu404(s, e.vinculo);
    const [{ agora }, params, dominios] = await Promise.all([
      this.porta.relogio(s.porta),
      this.parametros(s),
      this.dominios(s),
    ]);
    if (v.desligamento !== null && diasEntre(v.desligamento, dataDe(e.ocorridoEm)) > 0)
      throw recusaRegra(
        'vinculo-desligado',
        'O acidente é posterior ao desligamento do vínculo.',
        'ocorridoEm',
      );
    const conferirCodigo = (codigo: number | null, lista: readonly { codigo: number }[], campo: string) => {
      if (codigo !== null && !lista.some((x) => x.codigo === codigo))
        throw recusaRegra('codigo-invalido', 'Código fora da tabela do eSocial: escolha da lista.', campo);
    };
    conferirCodigo(e.parteCorpo, dominios.partesCorpo, 'parteCorpo');
    conferirCodigo(e.natureza, dominios.naturezas, 'natureza');
    conferirCodigo(e.agente, dominios.agentes, 'agente');
    conferirCodigo(e.situacao, dominios.situacoes, 'situacao');
    const exposicao = {
      biologico: e.biologico,
      perfurocortante: e.perfurocortante,
      exposicao: e.biologico ? e.exposicao : null,
      material: e.biologico ? e.material : null,
      fonteTeste: e.biologico ? e.fonteTeste : null,
    };
    const profilaxia = e.profilaxia ?? profilaxiaSugerida(exposicao);
    const recusa = conferirAcidente(
      { ...exposicao, ocorridoEm: e.ocorridoEm, obito: e.obito, profilaxia, profilaxiaEm: e.profilaxiaEm },
      agora,
      v.admissao,
    );
    if (recusa) throw recusar(recusa);
    if (e.biologico && e.fonte === null)
      throw recusaRegra('fonte-ausente', 'Informe se a fonte do material é conhecida.', 'fonte');
    const r = await this.apoio.sgh(
      s,
      E.pessoasAcidenteRegistrado.codigo,
      CHAVE_PESSOAS_SESMT,
      (x: { id: number }) => ({ tabela: 'comunicacao_acidente', id: String(x.id) }),
      async (g) => {
        const id = await g.incluirAcidente({
          vinculo: v.id,
          ocorridoEm: e.ocorridoEm,
          tipo: e.tipo,
          unidade: e.unidade,
          local: e.local,
          descricao: e.descricao,
          ...exposicao,
          fonte: e.biologico ? e.fonte : null,
          parteCorpo: e.parteCorpo,
          natureza: e.natureza,
          agente: e.agente,
          situacao: e.situacao,
          afastamento: e.afastamento,
          obito: e.obito,
          profilaxia,
          profilaxiaEm: e.profilaxiaEm,
          profilaxiaObs: e.profilaxiaObs,
          catPrazo: prazoCat(e.ocorridoEm, e.obito, params.prazoCatDiasUteis),
          por: s.login,
        });
        for (const m of marcosSorologia(e.ocorridoEm, e.biologico))
          await g.incluirSorologia({ acidente: id, marco: m.marco, prevista: m.prevista });
        return { id };
      },
    );
    return { id: r.id, mensagem: 'Acidente registrado.' };
  }

  private async atualizar<T>(
    s: SessaoCadastro,
    acidente: number,
    fn: (g: GravadorSesmt, a: AcidenteTrabalho) => Promise<T>,
  ): Promise<T> {
    await this.apoio.exigirLiberacao(s);
    await this.acidenteOu404(s, acidente);
    return this.apoio.sgh(
      s,
      E.pessoasAcidenteAtualizado.codigo,
      CHAVE_PESSOAS_SESMT,
      { tabela: 'comunicacao_acidente', id: String(acidente) },
      async (g) => {
        const a = await g.acidente(acidente);
        if (!a) throw naoEncontrado('Acidente');
        return fn(g, a);
      },
    );
  }

  async profilaxia(s: SessaoCadastro, e: ProfilaxiaEntrada): Promise<ResultadoSesmt> {
    const { agora } = await this.porta.relogio(s.porta);
    await this.atualizar(s, e.acidente, async (g, a) => {
      if (a.estado !== 'aberto') throw recusaRegra('ja-encerrado', 'O acompanhamento já está encerrado.');
      const recusa = conferirAcidente(
        {
          biologico: a.biologico,
          perfurocortante: a.perfurocortante,
          exposicao: a.exposicao as AcidenteResposta['exposicao'],
          material: a.material as AcidenteResposta['material'],
          fonteTeste: a.fonteTeste as AcidenteResposta['fonteTeste'],
          ocorridoEm: a.ocorridoEm,
          obito: a.obito,
          profilaxia: e.profilaxia,
          profilaxiaEm: e.profilaxiaEm,
        },
        agora,
        '1900-01-01',
      );
      if (recusa) throw recusar(recusa);
      await g.atualizarProfilaxia({
        id: a.id,
        versao: e.versao,
        profilaxia: e.profilaxia,
        profilaxiaEm: e.profilaxiaEm,
        observacao: e.observacao,
        por: s.login,
      });
    });
    return { id: e.acidente, mensagem: 'Profilaxia registrada.' };
  }

  async sorologia(s: SessaoCadastro, e: SorologiaEntrada): Promise<ResultadoSesmt> {
    const { hoje } = await this.porta.relogio(s.porta);
    const id = await this.atualizar(s, e.acidente, async (g, a) => {
      if (a.estado !== 'aberto') throw recusaRegra('ja-encerrado', 'O acompanhamento já está encerrado.');
      if (
        e.realizada !== null &&
        (diasEntre(hoje, e.realizada) > 0 || diasEntre(dataDe(a.ocorridoEm), e.realizada) < 0)
      )
        throw recusaRegra('coleta-fora', 'A coleta fica entre o acidente e hoje.', 'realizada');
      const marcos = await g.sorologias(a.id);
      if (!marcos.some((x) => x.marco === e.marco))
        throw recusaRegra('marco-inexistente', 'Este acidente não tem este marco de sorologia.', 'marco');
      return g.registrarSorologia({
        acidente: a.id,
        marco: e.marco,
        realizada: e.resultado === 'nao-realizada' ? null : e.realizada,
        resultado: e.resultado,
        observacao: e.observacao,
        por: s.login,
      });
    });
    return { id, mensagem: 'Sorologia registrada.' };
  }

  async emitirCat(s: SessaoCadastro, e: EmitirCatEntrada): Promise<ResultadoSesmt> {
    const [{ hoje }, dominios] = await Promise.all([this.porta.relogio(s.porta), this.dominios(s)]);
    if (!dominios.tiposCat.some((t) => t.codigo === e.tipoCat))
      throw recusaRegra('tipo-cat', 'Escolha o tipo da CAT.', 'tipoCat');
    if (e.iniciativa !== null && !dominios.iniciativasCat.some((t) => t.codigo === e.iniciativa))
      throw recusaRegra('iniciativa-cat', 'Escolha a iniciativa da CAT.', 'iniciativa');
    let inicial = false;
    await this.atualizar(s, e.acidente, async (g, a) => {
      // A versão antes da regra: quem abriu uma versão velha vê que o acidente mudou (a regra roda sobre o atual).
      if (a.versao !== e.versao)
        throw recusaRegra(
          'desatualizado',
          'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
        );
      // D-CAT-525: uma emissão por acidente, a inicial, que nunca é sobrescrita (o tipo inicial vem do domínio lido).
      const emissao = conferirEmissaoCat(e.tipoCat, dominios.tiposCat, a.catNumero);
      if ('codigo' in emissao) throw recusar(emissao);
      inicial = emissao.inicial;
      if (diasEntre(hoje, e.emitidaEm) > 0 || diasEntre(dataDe(a.ocorridoEm), e.emitidaEm) < 0)
        throw recusaRegra('emissao-fora', 'A emissão fica entre o acidente e hoje.', 'emitidaEm');
      await g.emitirCat({
        id: a.id,
        versao: e.versao,
        tipoCat: e.tipoCat,
        iniciativa: e.iniciativa,
        numero: e.numero,
        emitidaEm: e.emitidaEm,
        por: s.login,
      });
      // W0-06: os dados da CAT para o S-2210, na mesma transação (a emissão é a primeira vez: sem valor anterior).
      if (e.cat)
        await g.retificarAcidente({
          ...(retificaveis(a) as Omit<
            Parameters<GravadorSesmt['retificarAcidente']>[0],
            'id' | 'versao' | 'por'
          >),
          cat: e.cat as DadosCat,
          id: a.id,
          versao: e.versao + 1,
          por: s.login,
        });
    });
    return {
      id: e.acidente,
      mensagem:
        inicial && diasEntre(e.emitidaEm, (await this.acidenteOu404(s, e.acidente)).catPrazo) < 0
          ? 'CAT registrada fora do prazo.'
          : 'CAT registrada.',
    };
  }

  async encerrarAcidente(s: SessaoCadastro, e: EncerrarAcidenteEntrada): Promise<ResultadoSesmt> {
    await this.atualizar(s, e.acidente, async (g, a) => {
      const recusa = conferirEncerramento(paraSituacao(a, await g.sorologias(a.id)));
      if (recusa) throw recusar(recusa);
      await g.encerrarAcidente({ id: a.id, versao: e.versao, motivo: e.motivo, por: s.login });
    });
    return { id: e.acidente, mensagem: 'Acompanhamento encerrado.' };
  }

  // ── W0-06: retificação e anulação do acidente e da CAT, com o S-2210 na fila do eSocial ─────────────────────

  private exigirFila(): FilaCatEsocial {
    if (!this.esocial)
      throw new ErroProblema(
        'indisponivel',
        503,
        'eSocial indisponível',
        'A fila do eSocial não está ligada.',
      );
    return this.esocial;
  }

  /** O S-2210 do acidente na fila: o aceito (retifica-se ou exclui-se), o não enviado (descarta-se) e o em trânsito. */
  private async filaCat(s: SessaoCadastro, acidente: number) {
    const fila = this.esocial ? await this.esocial.eventosCat(s, acidente) : [];
    const transito = fila.find((x) => CAT_EM_TRANSITO.has(x.situacao));
    if (transito)
      throw recusaRegra(
        'evento-em-transito',
        `O S-2210 deste acidente (evento ${transito.id}) está em lote ou enviado ao eSocial: aguarde o retorno para mudar o acidente.`,
      );
    return {
      aceito: fila.find((x) => x.situacao === 'aceito') ?? null,
      naoEnviados: fila.filter((x) => CAT_NAO_ENVIADA.has(x.situacao)),
    };
  }

  private efeito(
    operacao: EfeitoEsocialSesmt['operacao'],
    r: ResultadoGeracaoEsocial | null,
    anterior: number | null,
  ): EfeitoEsocialSesmt {
    const ev = r?.eventos[0];
    return {
      operacao,
      evento: ev?.id ?? null,
      anterior,
      valido: ev ? ev.valido && ev.pendencias.length === 0 : true,
      pendencias: ev ? ev.pendencias.map((p) => ({ codigo: p.codigo, mensagem: p.mensagem })) : [],
    };
  }

  /** O S-2210 original do acidente na fila do eSocial (prévia com as pendências, ou gravado). */
  async gerarCatEsocial(s: SessaoCadastro, e: GerarCatEsocialEntrada): Promise<ResultadoGeracaoEsocial> {
    const fila = this.exigirFila();
    const a = await this.acidenteOu404(s, e.acidente);
    if (a.anuladoEm) throw recusaRegra('acidente-anulado', 'O acidente foi anulado: não gera CAT.');
    return fila.gerarCat(s, {
      empresa: e.empresa,
      vinculo: a.vinculo,
      cat: catParaEvento(a),
      retificar: null,
      gravar: e.gravar,
    });
  }

  /**
   * Retificação com motivo: o registro inteiro do acidente e da CAT pela versão lida, com o valor anterior guardado.
   * Na fila do eSocial: o S-2210 aceito ganha o retificador (indRetif 2 com o recibo; a prévia sem pendência vem
   * antes de gravar); o não enviado se descarta e o original sai de novo com os dados certos; o em trânsito recusa.
   */
  async retificarAcidente(s: SessaoCadastro, e: RetificarAcidenteEntrada): Promise<ResultadoSesmt> {
    await this.apoio.exigirLiberacao(s);
    const a = await this.acidenteOu404(s, e.acidente);
    if (a.anuladoEm) throw recusaRegra('acidente-anulado', 'O acidente foi anulado: não se retifica.');
    if (a.versao !== e.versao)
      throw recusaRegra(
        'desatualizado',
        'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
      );
    const v = await this.vinculoOu404(s, a.vinculo);
    const [{ agora }, params, dominios] = await Promise.all([
      this.porta.relogio(s.porta),
      this.parametros(s),
      this.dominios(s),
    ]);
    this.conferirCodigosCat(e, dominios);
    const r = conferirAcidente(
      {
        biologico: a.biologico,
        perfurocortante: a.perfurocortante,
        exposicao: a.exposicao as AcidenteResposta['exposicao'],
        material: a.material as AcidenteResposta['material'],
        fonteTeste: a.fonteTeste as AcidenteResposta['fonteTeste'],
        ocorridoEm: e.ocorridoEm,
        obito: e.obito,
        profilaxia: a.profilaxia as SituacaoProfilaxia,
        profilaxiaEm: a.profilaxiaEm,
      },
      agora,
      v.admissao,
    );
    if (r) throw recusar(r);
    const novo: AcidenteTrabalho = {
      ...a,
      ocorridoEm: e.ocorridoEm,
      tipo: e.tipo,
      local: e.local,
      descricao: e.descricao,
      parteCorpo: e.parteCorpo,
      natureza: e.natureza,
      agente: e.agente,
      situacao: e.situacao,
      afastamento: e.afastamento,
      obito: e.obito,
      catPrazo: prazoCat(e.ocorridoEm, e.obito, params.prazoCatDiasUteis),
      cat: e.cat as DadosCat,
    };
    const { aceito, naoEnviados } = await this.filaCat(s, a.id);
    const fila = aceito || naoEnviados.length ? this.exigirFila() : null;
    if (fila && aceito) {
      // A retificação chega ao eSocial: sem pendência, ou nada muda.
      const previa = await fila.gerarCat(s, {
        empresa: aceito.empresa,
        vinculo: a.vinculo,
        cat: catParaEvento(novo),
        retificar: aceito,
        gravar: false,
      });
      const pend = previa.eventos[0]?.pendencias ?? [];
      if (pend.length)
        throw recusaRegra(
          'cat-com-pendencia',
          `A retificação vai ao eSocial e ainda falta: ${pend.map((p) => p.mensagem).join(' ')}`,
        );
    }
    await this.apoio.sgh(
      s,
      E.pessoasAcidenteRetificado.codigo,
      CHAVE_PESSOAS_SESMT,
      { tabela: 'comunicacao_acidente', id: String(a.id), chave: 'retificacao' },
      async (g) => {
        const atual = await g.acidente(a.id);
        if (!atual) throw naoEncontrado('Acidente');
        // O valor anterior copiado antes de gravar (a leitura pode devolver a própria linha).
        const antes = structuredClone(retificaveis(atual));
        await g.retificarAcidente({
          ...(retificaveis(novo) as Omit<
            Parameters<GravadorSesmt['retificarAcidente']>[0],
            'id' | 'versao' | 'por'
          >),
          id: a.id,
          versao: e.versao,
          por: s.login,
        });
        await g.registrarCorrecao({
          tabela: 'comunicacao_acidente',
          registro: a.id,
          operacao: 'acidente.retificado',
          antes,
          depois: retificaveis(novo),
          motivo: e.motivo,
          por: s.login,
        });
      },
    );
    let esocial = semEfeito;
    // O que ainda não saiu (o original ou um retificador anterior) se descarta: fica guardado, com o motivo.
    if (fila)
      for (const x of naoEnviados)
        await fila.descartar(s, x.id, {
          versao: x.versao,
          motivo: `Acidente retificado: ${e.motivo}`.slice(0, 200),
        });
    if (fila && aceito) {
      const g = await fila.gerarCat(s, {
        empresa: aceito.empresa,
        vinculo: a.vinculo,
        cat: catParaEvento(novo),
        retificar: aceito,
        gravar: true,
      });
      esocial = this.efeito('retificacao', g, aceito.id);
    } else if (fila && naoEnviados.length) {
      const g = await fila.gerarCat(s, {
        empresa: naoEnviados[0]!.empresa,
        vinculo: a.vinculo,
        cat: catParaEvento(novo),
        retificar: null,
        gravar: true,
      });
      esocial = this.efeito('original', g, naoEnviados[0]!.id);
    }
    return {
      id: a.id,
      mensagem:
        esocial.operacao === 'retificacao'
          ? 'Acidente retificado: o S-2210 retificador está na fila do eSocial.'
          : 'Acidente retificado.',
      esocial,
    };
  }

  /**
   * Anulação do acidente lançado por engano: encerra com o motivo e marca a anulação (nunca se apaga). Na fila do
   * eSocial: o S-2210 aceito ganha o S-3000 (o original fica guardado); o não enviado se descarta; o em trânsito recusa.
   */
  async anularAcidente(s: SessaoCadastro, e: AnularAcidenteEntrada): Promise<ResultadoSesmt> {
    await this.apoio.exigirLiberacao(s);
    const a = await this.acidenteOu404(s, e.acidente);
    if (a.anuladoEm) throw recusaRegra('acidente-anulado', 'O acidente já foi anulado.');
    if (a.versao !== e.versao)
      throw recusaRegra(
        'desatualizado',
        'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
      );
    await this.vinculoOu404(s, a.vinculo);
    const { aceito, naoEnviados } = await this.filaCat(s, a.id);
    const fila = aceito || naoEnviados.length ? this.exigirFila() : null;
    const motivoFila = `Acidente anulado: ${e.motivo}`.slice(0, 200);
    if (fila && aceito) {
      const previa = await fila.excluir(s, aceito.id, {
        versao: aceito.versao,
        motivo: motivoFila,
        gravar: false,
      });
      const pend = previa.eventos[0]?.pendencias ?? [];
      if (pend.length)
        throw recusaRegra(
          'cat-com-pendencia',
          `A exclusão vai ao eSocial e ainda falta: ${pend.map((p) => p.mensagem).join(' ')}`,
        );
    }
    await this.apoio.sgh(
      s,
      E.pessoasAcidenteAnulado.codigo,
      CHAVE_PESSOAS_SESMT,
      { tabela: 'comunicacao_acidente', id: String(a.id), chave: 'anulacao' },
      async (g) => {
        await g.anularAcidente({ id: a.id, versao: e.versao, motivo: e.motivo, por: s.login });
        await g.registrarCorrecao({
          tabela: 'comunicacao_acidente',
          registro: a.id,
          operacao: 'acidente.anulado',
          antes: {
            estado: a.estado,
            motivoEncerramento: a.motivoEncerramento,
            encerradoEm: a.encerradoEm,
            encerradoPor: a.encerradoPor ?? null,
            anulado: false,
          },
          depois: { estado: 'encerrado', anulado: true },
          motivo: e.motivo,
          por: s.login,
        });
      },
    );
    let esocial = semEfeito;
    if (fila) {
      for (const x of naoEnviados) await fila.descartar(s, x.id, { versao: x.versao, motivo: motivoFila });
      if (aceito) {
        const g = await fila.excluir(s, aceito.id, {
          versao: aceito.versao,
          motivo: motivoFila,
          gravar: true,
        });
        esocial = this.efeito('exclusao', g, aceito.id);
      } else esocial = { ...semEfeito, operacao: 'descarte', anterior: naoEnviados[0]?.id ?? null };
    }
    return {
      id: a.id,
      mensagem:
        esocial.operacao === 'exclusao'
          ? 'Acidente anulado: o S-3000 da CAT está na fila do eSocial.'
          : 'Acidente anulado.',
      esocial,
    };
  }

  private conferirCodigosCat(
    e: { parteCorpo: number | null; natureza: number | null; agente: number | null; situacao: number | null },
    dominios: DominiosSesmt,
  ): void {
    const conferir = (codigo: number | null, lista: readonly { codigo: number }[], campo: string) => {
      if (codigo !== null && !lista.some((x) => x.codigo === codigo))
        throw recusaRegra('codigo-invalido', 'Código fora da tabela do eSocial: escolha da lista.', campo);
    };
    conferir(e.parteCorpo, dominios.partesCorpo, 'parteCorpo');
    conferir(e.natureza, dominios.naturezas, 'natureza');
    conferir(e.agente, dominios.agentes, 'agente');
    conferir(e.situacao, dominios.situacoes, 'situacao');
  }

  // ── Mapa de riscos e EPI (regra 19) ─────────────────────────────────────────────────────────────────────────

  private async linhasResposta(
    s: SessaoCadastro,
    linhas: readonly LinhaRiscoFuncao[],
  ): Promise<LinhaRiscoResposta[]> {
    const [dominios, unidades, fatores] = await Promise.all([
      this.dominios(s),
      this.nomesUnidades(s),
      this.porta.fatoresPorCodigo(
        s.porta,
        linhas.map((l) => l.fatorRisco).filter((x): x is string => x !== null),
      ),
    ]);
    const grupos = new Map(dominios.gruposRisco.map((g) => [g.codigo, g.rotulo]));
    const epc = rotulos(dominios.eficaciasEpc);
    return linhas.map((l) => ({
      id: l.id,
      unidade: l.unidade,
      unidadeNome: l.unidade !== null ? (unidades.get(l.unidade) ?? null) : null,
      setor: l.setor,
      funcao: l.funcao,
      tipo: l.tipo,
      fatorRisco: l.fatorRisco,
      fatorRiscoRotulo: l.fatorRisco ? (fatores.get(l.fatorRisco) ?? null) : null,
      grupoRisco: l.grupoRisco,
      grupoRiscoRotulo: l.grupoRisco ? (grupos.get(l.grupoRisco) ?? null) : null,
      epc: l.epc,
      epcRotulo: l.epc !== null ? (epc.get(l.epc) ?? null) : null,
      epi: l.epi,
      descricao: l.descricao,
      inicio: l.inicio,
      fim: l.fim,
      motivoFim: l.motivoFim,
    }));
  }

  async mapaRiscos(s: SessaoCadastro, f: FiltroRiscosEntrada): Promise<MapaRiscos> {
    const [{ hoje }, linhas] = await Promise.all([
      this.porta.relogio(s.porta),
      this.porta.mapaRiscos(s.porta, {
        vigentes: f.vigentes,
        ...(f.funcao ? { funcaoChave: chaveFuncao(f.funcao) } : {}),
        ...(f.unidade !== undefined ? { unidade: f.unidade } : {}),
      }),
    ]);
    return { hoje, linhas: await this.linhasResposta(s, linhas) };
  }

  async fatoresRisco(s: SessaoCadastro, termo: string): Promise<FatoresRisco> {
    return { itens: await this.porta.fatoresRisco(s.porta, termo) };
  }

  async incluirLinhaRisco(s: SessaoCadastro, e: LinhaRiscoEntrada): Promise<ResultadoSesmt> {
    await this.apoio.exigirLiberacao(s);
    const dominios = await this.dominios(s);
    if (e.tipo === 'risco') {
      const fatores = await this.porta.fatoresPorCodigo(s.porta, [e.fatorRisco ?? '']);
      if (!fatores.has(e.fatorRisco ?? ''))
        throw recusaRegra(
          'fator-invalido',
          'Fator de risco fora da tabela do eSocial: escolha da busca.',
          'fatorRisco',
        );
      if (!dominios.gruposRisco.some((g) => g.codigo === e.grupoRisco))
        throw recusaRegra('grupo-invalido', 'Escolha o grupo do risco.', 'grupoRisco');
      if (e.epc !== null && !dominios.eficaciasEpc.some((x) => x.codigo === e.epc))
        throw recusaRegra('epc-invalido', 'Escolha a eficácia do EPC.', 'epc');
    }
    const r = await this.apoio.sgh(
      s,
      E.pessoasRiscoAlterado.codigo,
      CHAVE_PESSOAS_SESMT,
      (x: { id: number }) => alvoLinhaRisco(x.id),
      async (g) => ({
        id: await g.incluirLinhaRisco({
          unidade: e.unidade,
          setor: e.setor,
          funcao: e.funcao,
          funcaoChave: chaveFuncao(e.funcao),
          tipo: e.tipo,
          fatorRisco: e.tipo === 'risco' ? e.fatorRisco : null,
          grupoRisco: e.tipo === 'risco' ? e.grupoRisco : null,
          epc: e.tipo === 'risco' ? e.epc : null,
          epi: e.tipo === 'epi' ? e.epi : null,
          descricao: e.descricao,
          inicio: e.inicio,
          por: s.login,
        }),
      }),
    );
    return { id: r.id, mensagem: e.tipo === 'risco' ? 'Fator de risco incluído.' : 'EPI exigido incluído.' };
  }

  async encerrarLinhaRisco(s: SessaoCadastro, e: EncerrarLinhaRiscoEntrada): Promise<ResultadoSesmt> {
    await this.apoio.exigirLiberacao(s);
    const linha = (await this.porta.mapaRiscos(s.porta, { vigentes: true })).find((l) => l.id === e.id);
    if (!linha) throw naoEncontrado('Linha do mapa de riscos');
    if (diasEntre(linha.inicio, e.fim) < 0)
      throw recusaRegra('fim-antes-inicio', 'O fim da vigência vem depois do início.', 'fim');
    await this.apoio.sgh(
      s,
      E.pessoasRiscoAlterado.codigo,
      CHAVE_PESSOAS_SESMT,
      alvoLinhaRisco(e.id),
      async (g) => {
        await g.encerrarLinhaRisco({ id: e.id, fim: e.fim, motivo: e.motivo, por: s.login });
        return { id: e.id };
      },
    );
    return { id: e.id, mensagem: 'Vigência encerrada.' };
  }

  async epiDoColaborador(s: SessaoCadastro, vinculo: number): Promise<EpiDoColaborador> {
    const v = await this.vinculoOu404(s, vinculo);
    const funcao = v.funcao ?? v.cargo;
    const [{ hoje }, mapa, registros, unidades] = await Promise.all([
      this.porta.relogio(s.porta),
      this.porta.mapaRiscos(s.porta, { vigentes: false, funcaoChave: chaveFuncao(funcao) }),
      this.porta.registrosEpi(s.porta, v.id),
      this.nomesUnidades(s),
    ]);
    const correcoes = await this.porta.correcoes(
      s.porta,
      'entrega_epi',
      registros.map((r) => r.id),
    );
    const vigentes = linhasDaFuncao(mapa, funcao, v.unidade, hoje);
    const entregas = registros.filter((r) => r.canceladoEm === null).map(entregaLida);
    const dose = doseNoAno(entregas, Number(hoje.slice(0, 4)));
    return {
      colaborador: this.colaborador(v, unidades),
      hoje,
      riscos: await this.linhasResposta(s, vigentes),
      episFaltando: episFaltando(vigentes, entregas, hoje),
      registros: [...registros]
        .sort((a, b) => (a.data === b.data ? b.id - a.id : a.data < b.data ? 1 : -1))
        .map(registroEpiResposta),
      dose: {
        ano: Number(hoje.slice(0, 4)),
        totalMsv: dose.total,
        parcelasMsv: dose.parcelas,
        situacao: dose.situacao,
      },
      pendencias: resposta(v.desligamento === null ? pendenciasEpi(vigentes, entregas, hoje) : []),
      correcoes: correcoesResposta(correcoes),
    };
  }

  async registrarEpi(s: SessaoCadastro, e: RegistroEpiEntrada): Promise<ResultadoSesmt> {
    await this.apoio.exigirLiberacao(s);
    const v = await this.vinculoOu404(s, e.vinculo);
    const { hoje } = await this.porta.relogio(s.porta);
    if (v.desligamento !== null)
      throw recusaRegra('desligado', 'O vínculo está desligado: não recebe EPI nem registros.');
    let recusa: RecusaSesmt | null = null;
    if (e.tipo === 'epi')
      recusa = conferirEntregaEpi(
        {
          epi: e.epi,
          caNumero: e.caNumero,
          caValidade: e.caValidade,
          quantidade: e.quantidade,
          data: e.data,
        },
        hoje,
        v.admissao,
      );
    else if (e.tipo === 'dosimetria')
      recusa = conferirDosimetria({ periodoInicio: e.periodoInicio, data: e.data, doseMsv: e.doseMsv }, hoje);
    else if (diasEntre(hoje, e.data) > 0)
      recusa = { codigo: 'data-futura', mensagem: 'A data da exposição não pode ser futura.', campo: 'data' };
    if (recusa) throw recusar(recusa);
    const r = await this.apoio.sgh(
      s,
      E.pessoasEpiRegistrado.codigo,
      CHAVE_PESSOAS_SESMT,
      (x: { id: number }) => ({ tabela: 'entrega_epi', id: String(x.id) }),
      async (g) => ({
        id: await g.incluirRegistroEpi({
          vinculo: v.id,
          tipo: e.tipo,
          data: e.data,
          epi: e.tipo === 'epi' ? e.epi : null,
          caNumero: e.tipo === 'epi' ? e.caNumero.trim() : null,
          caValidade: e.tipo === 'epi' ? e.caValidade : null,
          quantidade: e.tipo === 'epi' ? e.quantidade : null,
          periodoInicio: e.tipo === 'dosimetria' ? e.periodoInicio : null,
          doseMsv: e.tipo === 'dosimetria' ? e.doseMsv : null,
          dosimetro: e.tipo === 'dosimetria' ? e.dosimetro : null,
          agente: e.tipo === 'quimio' ? e.agente : null,
          duracaoMin: e.tipo === 'quimio' ? e.duracaoMin : null,
          observacao: e.observacao,
          por: s.login,
        }),
      }),
    );
    const mensagem =
      e.tipo === 'epi'
        ? 'Entrega registrada: imprima o comprovante para a assinatura do colaborador.'
        : e.tipo === 'dosimetria'
          ? 'Leitura do dosímetro registrada.'
          : 'Exposição registrada.';
    return { id: r.id, mensagem };
  }

  async assinarEpi(s: SessaoCadastro, e: AssinaturaEpiEntrada): Promise<ResultadoSesmt> {
    await this.apoio.exigirLiberacao(s);
    const x = await this.porta.registroEpi(s.porta, e.entrega);
    if (!x || x.tipo !== 'epi') throw naoEncontrado('Entrega de EPI');
    await this.vinculoOu404(s, x.vinculo);
    if (x.assinatura === 'assinada')
      throw recusaRegra('ja-assinada', 'A assinatura desta entrega já foi registrada.');
    if (x.canceladoEm) throw recusaRegra('ja-cancelada', 'A entrega foi cancelada: não se assina.');
    await this.apoio.sgh(
      s,
      E.pessoasEpiRegistrado.codigo,
      CHAVE_PESSOAS_SESMT,
      { tabela: 'entrega_epi', id: String(x.id) },
      async (g) => {
        await g.assinarEntregaEpi({ id: x.id, por: s.login });
        return { id: x.id };
      },
    );
    return { id: x.id, mensagem: 'Assinatura registrada.' };
  }

  /** W0-06: cancelamento da entrega (ou da leitura, ou da exposição) com motivo; nunca se apaga. */
  async cancelarEpi(s: SessaoCadastro, e: CancelarEpiEntrada): Promise<ResultadoSesmt> {
    await this.apoio.exigirLiberacao(s);
    const x = await this.porta.registroEpi(s.porta, e.entrega);
    if (!x) throw naoEncontrado('Registro de EPI');
    await this.vinculoOu404(s, x.vinculo);
    if (x.canceladoEm) throw recusaRegra('ja-cancelada', 'Este registro já foi cancelado.');
    await this.apoio.sgh(
      s,
      E.pessoasEpiCancelado.codigo,
      CHAVE_PESSOAS_SESMT,
      { tabela: 'entrega_epi', id: String(x.id), chave: 'cancelamento' },
      async (g) => {
        await g.cancelarEntregaEpi({ id: x.id, motivo: e.motivo, por: s.login });
        await g.registrarCorrecao({
          tabela: 'entrega_epi',
          registro: x.id,
          operacao: 'epi.cancelado',
          antes: { cancelado: false, assinatura: x.assinatura },
          depois: { cancelado: true },
          motivo: e.motivo,
          por: s.login,
        });
      },
    );
    return { id: x.id, mensagem: 'Registro cancelado.' };
  }

  // ── Documentos (cap-14 §14.4.2: CAT e comprovante de entrega em PDF/A) ──────────────────────────────────────

  async dadosCat(
    s: SessaoCadastro,
    id: number,
  ): Promise<{ acidente: AcidenteResposta; dominios: DominiosSesmt }> {
    const acidente = await this.acidente(s, id);
    if (acidente.catNumero === null)
      throw recusaRegra('sem-cat', 'Registre a emissão da CAT antes de imprimir o documento.');
    return { acidente, dominios: await this.dominios(s) };
  }

  async dadosComprovante(
    s: SessaoCadastro,
    id: number,
  ): Promise<{ entrega: RegistroEpiResposta; colaborador: ColaboradorSesmt }> {
    const x = await this.porta.registroEpi(s.porta, id);
    if (!x || x.tipo !== 'epi') throw naoEncontrado('Entrega de EPI');
    const v = await this.vinculoOu404(s, x.vinculo);
    return { entrega: registroEpiResposta(x), colaborador: this.colaborador(v, await this.nomesUnidades(s)) };
  }

  /**
   * D-PPP-525: o PPP de consulta do colaborador (IN PRES/INSS 128/2022, art. 284): os períodos de atribuição pelo
   * histórico funcional, os fatores de risco e o EPI exigido que valeram em cada período (mapa de riscos com a
   * vigência), as entregas de EPI com o CA e a dosimetria; a monitoração biológica (os ASO) só para quem consulta o
   * prontuário ocupacional (regra 16). A lotação é a atual do vínculo em todos os períodos.
   */
  async ppp(s: SessaoCadastro, vinculo: number): Promise<PppColaborador> {
    const v = await this.vinculoOu404(s, vinculo);
    const [{ hoje }, historico, registros, unidades] = await Promise.all([
      this.porta.relogio(s.porta),
      this.pessoas.historico(s.porta, v.id),
      this.porta.registrosEpi(s.porta, v.id),
      this.nomesUnidades(s),
    ]);
    const periodos = periodosDeAtribuicao(
      { admissao: v.admissao, desligamento: v.desligamento, cargo: v.cargo, funcao: v.funcao },
      historico,
    );
    const mapas = new Map<string, LinhaRiscoFuncao[]>();
    for (const chave of new Set(periodos.map((p) => chaveFuncao(p.funcao))))
      mapas.set(chave, await this.porta.mapaRiscos(s.porta, { vigentes: false, funcaoChave: chave }));
    const unidadeNome = v.unidade !== null ? (unidades.get(v.unidade) ?? null) : null;
    const respostaPeriodos = [];
    for (const p of periodos) {
      const linhas = linhasNoPeriodo(mapas.get(chaveFuncao(p.funcao)) ?? [], p, v.unidade, hoje);
      const resp = await this.linhasResposta(s, linhas);
      respostaPeriodos.push({
        inicio: p.inicio,
        fim: p.fim,
        funcao: p.funcao,
        unidadeNome,
        setor: v.setor,
        linhas: resp.map((r, i) => ({
          ...r,
          vigenteDe: linhas[i]?.vigenteDe ?? r.inicio,
          vigenteAte: linhas[i]?.vigenteAte ?? r.fim,
        })),
      });
    }
    const asos = s.pode('pessoas.ocupacional.ler')
      ? (await this.prontuario(s, v.id)).asos.filter((a) => a.retificadoPor === null)
      : null;
    return {
      colaborador: this.colaborador(v, unidades),
      hoje,
      periodos: respostaPeriodos,
      registros: [...registros]
        .filter((r) => r.tipo === 'epi' || r.tipo === 'dosimetria')
        .sort((a, b) => (a.data === b.data ? a.id - b.id : a.data < b.data ? -1 : 1))
        .map(registroEpiResposta),
      asos,
    };
  }
}

// ── Conversões ────────────────────────────────────────────────────────────────────────────────────────────────

function asoLido(x: RegistroOcupacional): AsoLido {
  return {
    id: x.id,
    tipo: x.tipo ?? -1,
    data: x.data,
    conclusao: x.conclusao ?? 0,
    proximo: x.proximo,
    retifica: x.retifica,
  };
}

function vacinaLida(x: DoseVacinaColaborador): RegistroVacinaLido {
  return {
    id: x.id,
    registro: x.registro,
    vacina: x.vacina,
    dose: x.dose as DoseVacinaSesmt | null,
    data: x.data,
    antiHbs: x.antiHbs,
    retifica: x.retifica,
  };
}

function entregaLida(x: RegistroProtecao): EntregaLida {
  return {
    id: x.id,
    tipo: x.tipo,
    data: x.data,
    epi: x.epi,
    caValidade: x.caValidade,
    assinatura: x.assinatura,
    doseMsv: x.doseMsv,
  };
}

function paraSituacao(a: AcidenteTrabalho, soro: readonly SorologiaAcidente[]): AcidenteParaSituacao {
  return {
    estado: a.estado,
    catNumero: a.catNumero,
    catPrazo: a.catPrazo,
    profilaxia: a.profilaxia as SituacaoProfilaxia,
    sorologias: soro.map((x) => ({ prevista: x.prevista, resultado: x.resultado })),
  };
}

function registroEpiResposta(x: RegistroProtecao): RegistroEpiResposta {
  return {
    id: x.id,
    tipo: x.tipo,
    data: x.data,
    epi: x.epi,
    caNumero: x.caNumero,
    caValidade: x.caValidade,
    quantidade: x.quantidade,
    assinatura: x.assinatura,
    assinadaEm: x.assinadaEm,
    periodoInicio: x.periodoInicio,
    doseMsv: x.doseMsv,
    dosimetro: x.dosimetro,
    agente: x.agente,
    duracaoMin: x.duracaoMin,
    observacao: x.observacao,
    registradoPor: x.criadoPor,
    canceladoEm: x.canceladoEm,
    canceladoPor: x.canceladoPor,
    motivoCancelamento: x.motivoCancelamento,
  };
}

/**
 * O alvo da trilha da linha do mapa de riscos: a linha de EPI exigido chega com o id negativo (a tela a distingue da do
 * fator de risco), e a trilha leva a tabela e o id positivo da linha (entidade_id não tem sinal).
 */
function alvoLinhaRisco(id: number): { tabela: string; id: string } {
  return id < 0 ? { tabela: 'epi_funcao', id: String(-id) } : { tabela: 'risco_funcao', id: String(id) };
}
