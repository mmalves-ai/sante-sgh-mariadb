// Porta da escala de plantão, fatia F2 (M52.2; ficha, seções 4 e 6): o que as telas de escala e de regimes leem e
// gravam, independente de onde (a API não escreve SQL; fronteira Nx). O colaborador, o profissional e a validade do
// conselho vêm da porta da gestão de pessoas (F1); aqui, os domínios do ramo, os regimes, a escala, os plantões e a
// trilha da escala. Fatia F3 (M52.3): as trocas, o instante ("quem está de plantão agora"), os acionamentos do
// sobreaviso e o dimensionamento, com a classificação de pacientes do M45 só pela categoria e pelo total.
//   - `legado`: as leituras de @sgh/legado em transação READ ONLY no banco do estabelecimento; as gravações SGH_ numa
//     transação só SGH_ com a SGH_TRILHA junto; a consulta à Rede (regra 7) só de leitura, no banco de CADA outro
//     estabelecimento configurado, e só os intervalos;
//   - `memoria`: a sessão sintética de dev/ci (E2E); nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
import type {
  AcionamentoPesLido,
  CamposRegimeSgh,
  ClassificacaoLidaSgh,
  DimensionamentoPesLido,
  DimensionamentoSgh,
  FiltroInstanteSgh,
  FiltroTrocasSgh,
  NovaTrocaSgh,
  NovoAcionamentoSgh,
  PlantaoNoInstanteLido,
  TrocaPesLida,
  UnidadeInternacaoLida,
  EscalaPesLida,
  EventoPeriodoLidoSgh,
  EventoEscalaPesLido,
  EventoEscalaSgh,
  FiltroEscalasSgh,
  MudancaPlantaoSgh,
  NovaEscalaSgh,
  NovoPlantaoSgh,
  OpcaoDominioLida,
  PlantaoPesLido,
  RegimePesLido,
  TempoParcialLido,
  VigenciaRegimeLida,
  VigenciaRegimeHistoricoLida,
  VinculoPessoasContado,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../../exames/public-api.js';

export const PORTA_ESCALA = Symbol('PORTA_ESCALA');

export type ContextoEscala = ContextoPortaM18;

/** Janela de busca dos plantões: os que tocam [de, ate), com o início desde `inicioDesde` (24 h antes de `de`). */
export interface JanelaPlantoes {
  readonly de: string;
  readonly ate: string;
  readonly inicioDesde: string;
}

/** Os plantões da mesma pessoa nos outros estabelecimentos da Rede (regra 7): só os intervalos. */
export interface PlantoesDaRede {
  readonly intervalos: readonly { readonly inicio: string; readonly fim: string }[];
  readonly semResposta: number;
}

type SemHospital<T> = Omit<T, 'hospital'>;

/** As gravações SGH_ da F2 numa transação só SGH_, com as releituras dentro dela (o estabelecimento vem do contexto). */
export interface GravadorEscala {
  escala(id: number): Promise<EscalaPesLida | null>;
  plantao(id: number): Promise<PlantaoPesLido | null>;
  plantoesDaEscala(escala: number): Promise<PlantaoPesLido[]>;
  plantoesDaPessoa(pessoa: number, janela: JanelaPlantoes): Promise<PlantaoPesLido[]>;
  /** Trava os vínculos da pessoa até o fim da transação (inclusões simultâneas da mesma pessoa). */
  travarPessoa(pessoa: number): Promise<void>;
  regime(id: number): Promise<RegimePesLido | null>;
  incluirRegime(r: CamposRegimeSgh & { readonly por: string }): Promise<number>;
  alterarRegime(
    r: CamposRegimeSgh & { readonly id: number; readonly versao: number; readonly por: string },
  ): Promise<void>;
  atribuirRegime(a: {
    readonly vinculo: number;
    readonly regime: number;
    readonly desde: string;
    readonly por: string;
  }): Promise<number>;
  incluirEscala(s: SemHospital<NovaEscalaSgh>): Promise<number>;
  alterarCobertura(c: {
    readonly id: number;
    readonly versao: number;
    readonly cobertura: { readonly manha: number; readonly tarde: number; readonly noite: number };
    readonly por: string;
  }): Promise<void>;
  tocarEscala(t: { readonly id: number; readonly estado: string; readonly por: string }): Promise<void>;
  publicarEscala(p: {
    readonly id: number;
    readonly versao: number;
    readonly justificativaFuro: string | null;
    readonly por: string;
  }): Promise<void>;
  incluirPlantao(p: SemHospital<NovoPlantaoSgh>): Promise<number>;
  alterarPlantao(m: SemHospital<MudancaPlantaoSgh>): Promise<void>;
  cancelarPlantao(c: {
    readonly id: number;
    readonly versao: number;
    readonly motivo: string | null;
    readonly por: string;
  }): Promise<void>;
  evento(ev: SemHospital<EventoEscalaSgh>): Promise<number>;
  /** Evento na SGH_OUTBOX, na mesma transação (a F3 consome a publicação e as mudanças). */
  outbox(ev: { tipo: string; chave: string; carga: Record<string, string | number> }): Promise<string>;
  // ── F3 (M52.3): troca, acionamento e dimensionamento ──
  troca(id: number): Promise<TrocaPesLida | null>;
  plantoesEmTrocaAberta(plantoes: readonly number[]): Promise<Set<number>>;
  incluirTroca(t: SemHospital<NovaTrocaSgh>): Promise<number>;
  responderTroca(r: {
    readonly id: number;
    readonly versao: number;
    readonly estado: 'aceita' | 'recusada';
    readonly confirmacao: string | null;
    readonly por: string;
  }): Promise<void>;
  decidirTroca(d: {
    readonly id: number;
    readonly versao: number;
    readonly estado: 'aprovada' | 'reprovada';
    readonly motivo: string | null;
    readonly por: string;
  }): Promise<void>;
  cancelarTroca(c: {
    readonly id: number;
    readonly versao: number;
    readonly motivo: string;
    readonly por: string;
  }): Promise<void>;
  /** Na aprovação da troca: o plantão passa ao novo colaborador, com a versão lida. */
  transferirPlantao(t: {
    readonly id: number;
    readonly versao: number;
    readonly vinculo: number;
    readonly pessoa: number;
    readonly profissional: number | null;
    readonly registro: number | null;
    readonly alertaConselho: string | null;
    readonly redeNaoConferida: boolean;
    readonly motivo: string;
    readonly por: string;
  }): Promise<void>;
  acionamento(id: number): Promise<AcionamentoPesLido | null>;
  acionamentosDosPlantoes(plantoes: readonly number[]): Promise<AcionamentoPesLido[]>;
  incluirAcionamento(a: SemHospital<NovoAcionamentoSgh>): Promise<number>;
  registrarChegada(c: {
    readonly id: number;
    readonly versao: number;
    readonly chegouEm: string;
    readonly por: string;
  }): Promise<void>;
  cancelarAcionamento(c: {
    readonly id: number;
    readonly versao: number;
    readonly motivo: string;
    readonly por: string;
  }): Promise<void>;
  incluirDimensionamento(d: SemHospital<DimensionamentoSgh>): Promise<number>;
  // ── W0-06 (programa CRUD completo) ──
  /** As dependências (não próprias) da escala, contadas na transação (mapa de dependências da gestão de pessoas). */
  dependenciasEscala(escala: number): Promise<VinculoPessoasContado[]>;
  /** Exclui o rascunho (versão lida) sem vínculo, com o retrato de cada linha antes do DELETE. */
  excluirEscalaRascunho(x: {
    readonly id: number;
    readonly versao: number;
    readonly motivo: string;
    readonly por: string;
  }): Promise<{ retratos: number; plantoes: number }>;
  /** Cancela a publicada (versão lida) com motivo; devolve os plantões previstos cancelados. */
  cancelarEscala(x: {
    readonly id: number;
    readonly versao: number;
    readonly motivo: string;
    readonly por: string;
  }): Promise<number>;
  historicoVigencias(vinculo: number): Promise<VigenciaRegimeHistoricoLida[]>;
  anularVigencia(a: { readonly id: number; readonly motivo: string; readonly por: string }): Promise<void>;
  /**
   * Revisão W0-06: os eventos de período do ponto do vínculo lidos na MESMA transação (depois de travar a pessoa,
   * a mesma trava do fechamento). `null`: a porta não tem o ponto (memória); o serviço lê pela porta do ponto.
   */
  eventosPeriodo(vinculo: number): Promise<EventoPeriodoLidoSgh[] | null>;
}

export interface PortaEscala extends PortaGravacaoM18<GravadorEscala> {
  tiposJornada(c: ContextoEscala): Promise<OpcaoDominioLida[]>;
  temposParciais(c: ContextoEscala): Promise<TempoParcialLido[]>;
  tiposTrabalhoFolga(c: ContextoEscala): Promise<OpcaoDominioLida[]>;
  regimes(c: ContextoEscala): Promise<RegimePesLido[]>;
  regime(c: ContextoEscala, id: number): Promise<RegimePesLido | null>;
  vigencias(c: ContextoEscala, vinculos: readonly number[]): Promise<VigenciaRegimeLida[]>;
  escalas(c: ContextoEscala, f: FiltroEscalasSgh): Promise<EscalaPesLida[]>;
  escala(c: ContextoEscala, id: number): Promise<EscalaPesLida | null>;
  plantoesDaEscala(c: ContextoEscala, escala: number): Promise<PlantaoPesLido[]>;
  plantoesDaPessoa(c: ContextoEscala, pessoa: number, janela: JanelaPlantoes): Promise<PlantaoPesLido[]>;
  eventos(c: ContextoEscala, escala: number): Promise<EventoEscalaPesLido[]>;
  /**
   * Regra 7: os plantões da pessoa do vínculo nos OUTROS estabelecimentos da Rede (pelo HMAC do CPF). Só os que a porta
   * conhece (HS-1, no núcleo) e que `liberado` aceitar são consultados (D-ESCALA-REDE-52): um estabelecimento fora disso
   * não é lido nem conta como sem resposta.
   */
  plantoesNaRede(
    c: ContextoEscala,
    vinculo: number,
    janela: JanelaPlantoes,
    liberado?: (estabelecimento: string) => Promise<boolean>,
  ): Promise<PlantoesDaRede>;
  // ── F3 (M52.3) ──
  plantao(c: ContextoEscala, id: number): Promise<PlantaoPesLido | null>;
  trocas(c: ContextoEscala, f: FiltroTrocasSgh): Promise<TrocaPesLida[]>;
  troca(c: ContextoEscala, id: number): Promise<TrocaPesLida | null>;
  plantoesEmTrocaAberta(c: ContextoEscala, plantoes: readonly number[]): Promise<Set<number>>;
  /** Os plantões previstos da escala publicada em curso no instante (o início nas 24 h antes; regra 10). */
  plantoesNoInstante(
    c: ContextoEscala,
    instante: string,
    inicioDesde: string,
    f: FiltroInstanteSgh,
  ): Promise<PlantaoNoInstanteLido[]>;
  acionamentos(c: ContextoEscala, plantoes: readonly number[]): Promise<AcionamentoPesLido[]>;
  acionamento(c: ContextoEscala, id: number): Promise<AcionamentoPesLido | null>;
  dimensionamentos(c: ContextoEscala, f: { readonly unidade?: number }): Promise<DimensionamentoPesLido[]>;
  /** As unidades de internação com a contagem de internados (só a contagem; nada do paciente). */
  unidadesInternacao(c: ContextoEscala): Promise<UnidadeInternacaoLida[]>;
  /** A classificação de pacientes do turno (M45), para o dimensionamento: só a categoria e o total. */
  classificacoesDoTurno(
    c: ContextoEscala,
    unidadeInternacao: string,
    data: string,
    turno: string,
  ): Promise<readonly Pick<ClassificacaoLidaSgh, 'paciente' | 'instrumento' | 'categoria' | 'total'>[]>;
  // ── W0-06 ──
  dependenciasEscala(c: ContextoEscala, escala: number): Promise<VinculoPessoasContado[]>;
  /** Todas as vigências do vínculo, as anuladas inclusive (o histórico da tela). */
  historicoVigencias(c: ContextoEscala, vinculo: number): Promise<VigenciaRegimeHistoricoLida[]>;
  vigencia(c: ContextoEscala, id: number): Promise<VigenciaRegimeHistoricoLida | null>;
}

/** D-ESCALA-REDE-52: dos outros estabelecimentos, só os liberados (falha fechada: erro na conferência = não liberado). */
export async function soLiberados(
  lista: readonly string[],
  liberado?: (estabelecimento: string) => Promise<boolean>,
): Promise<readonly string[]> {
  if (!liberado) return lista;
  const ok = await Promise.all(lista.map((h) => liberado(h).catch(() => false)));
  return lista.filter((_h, i) => ok[i]);
}

export const METODOS_PORTA_ESCALA: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'tiposJornada',
  'temposParciais',
  'tiposTrabalhoFolga',
  'regimes',
  'regime',
  'vigencias',
  'escalas',
  'escala',
  'plantoesDaEscala',
  'plantoesDaPessoa',
  'eventos',
  'plantoesNaRede',
  'plantao',
  'trocas',
  'troca',
  'plantoesEmTrocaAberta',
  'plantoesNoInstante',
  'acionamentos',
  'acionamento',
  'dimensionamentos',
  'unidadesInternacao',
  'classificacoesDoTurno',
  'dependenciasEscala',
  'historicoVigencias',
  'vigencia',
]);
