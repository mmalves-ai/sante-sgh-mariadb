// Porta da notificação de incidentes (M48, etapa 1; ADR 0031): as leituras do outro sistema (o contexto do atendimento
// da tela de origem, as unidades, os feriados e o relógio do banco) e as gravações e leituras só do novo
// (SGH_QUA_NOTIFICACAO, SGH_QUA_NOTIF_EVENTO, SGH_QUA_NOTIF_PROTOCOLO) numa transação SGH_ com a SGH_TRILHA junto.
// Duas implementações: sobre o núcleo do legado (a cópia) e em memória (dev/ci e os testes; dados sintéticos).
import type { ContextoNotificacaoLido, EstagioLpp, ExpostoAoLote, UnidadeNotificacao } from '@sgh/contratos';
import type {
  Acao5w2hSgh,
  AcaoPlanoSghLida,
  AnaliseSgh,
  AnaliseSghLida,
  ContagemNotificacoesSgh,
  EventoQueixaSghLido,
  ProtocoloPacienteLido,
  QueixaTecnicaSgh,
  QueixaTecnicaSghLida,
  VersaoGerenciadoLida,
  EventoNotificacaoSgh,
  EventoNotificacaoSghLido,
  FiltroNotificacoesSgh,
  NotificacaoIncidenteSgh,
  NotificacaoSghLida,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_QUALIDADE = Symbol('PORTA_QUALIDADE');

export type ContextoQualidade = ContextoPortaM18;
type SemHospital<T> = Omit<T, 'hospital'>;

interface BaseFluxo {
  readonly id: number;
  readonly versao: number;
  readonly usuario: string;
  readonly agora: string;
}

/** Gravações só do novo, numa transação com a SGH_TRILHA junto (as regras puras conferidas sobre a linha travada). */
export interface GravadorQualidade {
  notificar(
    n: SemHospital<NotificacaoIncidenteSgh>,
  ): Promise<{ id: number; protocolo: string; repetida: boolean }>;
  /** A notificação travada (recusa 404 se não existe). */
  travar(id: number): Promise<NotificacaoSghLida>;
  triar(
    t: BaseFluxo & {
      readonly tipo: string;
      readonly tipoOutro: string | null;
      readonly classificacao: string;
      readonly dano: string;
      readonly neverEvent: boolean;
      readonly justificativa: string | null;
      readonly eventos: readonly ('triada' | 'reclassificada')[];
      readonly antes: Readonly<Record<string, unknown>>;
    },
  ): Promise<{ versao: number }>;
  descartar(
    d: BaseFluxo & {
      readonly motivo: string;
      readonly justificativa: string;
      readonly duplicadaDe: string | null;
    },
  ): Promise<{ versao: number }>;
  distribuir(
    d: BaseFluxo & {
      readonly gestor: string;
      readonly unidade: number;
      readonly prazoAnalise: string;
      readonly orientacao: string | null;
    },
  ): Promise<{ versao: number }>;
  devolver(d: BaseFluxo & { readonly texto: string }): Promise<{ versao: number }>;
  notivisaExportada(m: { readonly id: number; readonly usuario: string; readonly agora: string }): Promise<{
    marcou: boolean;
  }>;
  transcricao(
    t: BaseFluxo & { readonly numeroNotivisa: string; readonly transcritaEm: string },
  ): Promise<{ versao: number }>;
  // ── Etapa 2: análise, plano de ação, sugestão resolvida e vigilância de produto ──
  /** A análise travada da notificação (a notificação travada antes; null: ainda não existe). */
  travarAnalise(notificacao: number): Promise<AnaliseSghLida | null>;
  /** As ações do plano lidas na transação (a conclusão conta as ativas). */
  acoesNaTransacao(notificacao: number): Promise<AcaoPlanoSghLida[]>;
  registrarAnalise(
    a: SemHospital<AnaliseSgh>,
  ): Promise<{ id: number; versao: number; versaoNotificacao: number }>;
  travarAcao(notificacao: number, id: number): Promise<AcaoPlanoSghLida>;
  incluirAcao(a: {
    readonly notificacao: number;
    readonly usuario: string;
    readonly agora: string;
    readonly acao: Acao5w2hSgh;
  }): Promise<{ id: number; sequencia: number; versao: number }>;
  alterarAcao(a: BaseAcao & { readonly acao: Acao5w2hSgh }): Promise<{ versao: number }>;
  situacaoAcao(
    a: BaseAcao & { readonly situacao: string; readonly encerra: boolean; readonly texto: string | null },
  ): Promise<{ versao: number }>;
  eficaciaAcao(
    a: BaseAcao & { readonly eficacia: string; readonly texto: string },
  ): Promise<{ versao: number }>;
  /** Marca a sugestão como resolvida pelo resumo (SHA-256 da origem com o login; regra 1). */
  resolverSugestao(r: { readonly resumo: string; readonly dia: string }): Promise<{ gravou: boolean }>;
  abrirQueixa(q: SemHospital<QueixaTecnicaSgh>): Promise<{ id: number; versao: number }>;
  travarQueixa(id: number): Promise<QueixaTecnicaSghLida>;
  andamentoQueixa(a: {
    readonly id: number;
    readonly versao: number;
    readonly situacao: string;
    readonly conduta: string;
    readonly notivisaNumero: string | null;
    readonly encerra: boolean;
    readonly texto: string;
    readonly usuario: string;
    readonly agora: string;
  }): Promise<{ versao: number }>;
}

interface BaseAcao {
  readonly id: number;
  readonly versao: number;
  readonly usuario: string;
  readonly agora: string;
}

/** Os candidatos à sugestão automática que o usuário registrou (M25, M46 e M47). */
export interface CandidatosSugestao {
  readonly checagens: readonly {
    id: number;
    situacao: string;
    motivo: string | null;
    avisos: string | null;
    horaReal: string;
    atendimento: number | null;
  }[];
  readonly reacoes: readonly { id: number; inicioEm: string; grau: number; enviada: boolean }[];
  readonly checklists: readonly { id: number; excecaoEm: string }[];
  /** Os horários da prescrição marcados como não administrados por fora do Sante (sem o registro próprio da checagem). */
  readonly horarios?: readonly { id: number; quando: string; atendimento: number | null }[];
  /** A LPP com a ficha vigente finalizada pelo usuário (W0-03 M4); a regra confere a origem e a inativação. */
  readonly lesoes?: readonly {
    id: number;
    estagio: EstagioLpp | null;
    presenteNaAdmissao: boolean;
    inativada: boolean;
    identificadaEm: string;
    atendimento: number | null;
  }[];
}

/** As contagens de adesão do painel (os registros do novo no período). */
export interface ContagensAdesaoLidas {
  readonly checagens: number;
  readonly checagensComPulseira: number;
  readonly checklists: number;
  readonly checklistsConcluidos: number;
  readonly checklistsComPausa: number;
  readonly reavaliacoes: readonly {
    escala: 'morse' | 'braden';
    devidas: number;
    cumpridasNoPrazo: number;
  }[];
}

export interface PortaQualidade extends PortaGravacaoM18<GravadorQualidade> {
  /** O relógio do banco do estabelecimento (instante local `AAAA-MM-DDTHH:mm:ss`). */
  relogio(c: ContextoQualidade): Promise<string>;
  /** O contexto do atendimento da tela de origem (relido pelo servidor; nunca devolvido a quem notifica). */
  contexto(c: ContextoQualidade, atendimento: number): Promise<ContextoNotificacaoLido | null>;
  unidades(c: ContextoQualidade): Promise<UnidadeNotificacao[]>;
  /** Feriados do cadastro do período (AAAA-MM-DD; ano 9999 = todo ano). */
  feriados(c: ContextoQualidade, de: string, ate: string): Promise<{ data: string; nome: string }[]>;
  /** O login existe e está ativo no estabelecimento (o gestor da distribuição). */
  usuarioAtivo(c: ContextoQualidade, login: string): Promise<boolean>;
  /** Contas ativas e não bloqueadas cujo login ou nome contém o termo (a escolha do gestor da área; teto 20). */
  gestores(c: ContextoQualidade, termo: string): Promise<{ login: string; nome: string }[]>;
  notificacao(c: ContextoQualidade, id: number): Promise<NotificacaoSghLida | null>;
  porProtocolo(c: ContextoQualidade, protocolo: string): Promise<NotificacaoSghLida | null>;
  eventos(c: ContextoQualidade, id: number): Promise<EventoNotificacaoSghLido[]>;
  lista(
    c: ContextoQualidade,
    f: SemHospital<FiltroNotificacoesSgh>,
  ): Promise<{ itens: NotificacaoSghLida[]; temMais: boolean }>;
  comPrazo(c: ContextoQualidade): Promise<{ itens: NotificacaoSghLida[]; cortada: boolean }>;
  // ── Etapa 2 ──
  analise(c: ContextoQualidade, notificacao: number): Promise<AnaliseSghLida | null>;
  acoes(c: ContextoQualidade, notificacao: number): Promise<AcaoPlanoSghLida[]>;
  /** As ações abertas de que o login é o responsável (teto 200). */
  acoesDoResponsavel(c: ContextoQualidade, login: string): Promise<AcaoPlanoSghLida[]>;
  queixas(
    c: ContextoQualidade,
    f: {
      readonly situacao?: string;
      readonly area?: string;
      readonly pagina: number;
      readonly porPagina: number;
    },
  ): Promise<{ itens: QueixaTecnicaSghLida[]; temMais: boolean }>;
  queixa(c: ContextoQualidade, id: number): Promise<QueixaTecnicaSghLida | null>;
  eventosQueixa(c: ContextoQualidade, id: number): Promise<EventoQueixaSghLido[]>;
  /** Dos resumos, os de sugestões já resolvidas. */
  resolvidas(c: ContextoQualidade, resumos: readonly string[]): Promise<Set<string>>;
  candidatos(c: ContextoQualidade, login: string, desde: string): Promise<CandidatosSugestao>;
  painelNotificacoes(
    c: ContextoQualidade,
    de: string,
    fimExclusivo: string,
  ): Promise<ContagemNotificacoesSgh[]>;
  painelAnalises(
    c: ContextoQualidade,
    de: string,
    fimExclusivo: string,
    hoje: string,
  ): Promise<{ comPrazo: number; concluidas: number; noPrazo: number; vencidas: number }>;
  painelAcoes(
    c: ContextoQualidade,
    hoje: string,
  ): Promise<{ situacao: string; eficacia: string | null; vencida: boolean; quantidade: number }[]>;
  painelAdesao(
    c: ContextoQualidade,
    de: string,
    fimExclusivo: string,
    agora: string,
  ): Promise<ContagensAdesaoLidas>;
  /** O histórico do modelo de gerenciamento de riscos do prontuário (formulários por ano). */
  historicoRiscos(c: ContextoQualidade): Promise<{ ano: number; registros: number }[]>;
  /** Os protocolos gerenciados (M44): as versões publicadas e as inclusões do período (teto do M44 + 1). */
  protocolosGerenciados(
    c: ContextoQualidade,
    inicio: string,
    fim: string,
  ): Promise<{ versoes: VersaoGerenciadoLida[]; protocolos: ProtocoloPacienteLido[] }>;
  /** Os pacientes expostos ao item e ao lote (as saídas do lote no estoque e os consumos em sala). */
  expostos(
    c: ContextoQualidade,
    item: number,
    lote: string,
  ): Promise<{ itemNome: string | null; expostos: ExpostoAoLote[]; cortada: boolean }>;
  /** A busca de produtos do cadastro (código ou parte do nome; teto da busca do estoque). */
  itens(c: ContextoQualidade, termo: string): Promise<{ codigo: number; nome: string }[]>;
  nomesDosItens(c: ContextoQualidade, codigos: readonly number[]): Promise<Map<number, string>>;
}

export type { EventoNotificacaoSgh };

export const METODOS_PORTA_QUALIDADE: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'relogio',
  'contexto',
  'unidades',
  'feriados',
  'usuarioAtivo',
  'gestores',
  'notificacao',
  'porProtocolo',
  'eventos',
  'lista',
  'comPrazo',
  'analise',
  'acoes',
  'acoesDoResponsavel',
  'queixas',
  'queixa',
  'eventosQueixa',
  'resolvidas',
  'candidatos',
  'painelNotificacoes',
  'painelAnalises',
  'painelAcoes',
  'painelAdesao',
  'historicoRiscos',
  'protocolosGerenciados',
  'expostos',
  'itens',
  'nomesDosItens',
]);
