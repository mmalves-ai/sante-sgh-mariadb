// Porta da etapa 2 do portal do paciente (M50): a configuração da agenda online, o pré-check-in, a intenção de pagamento
// e a pesquisa de satisfação, todas SÓ do novo (scripts 0503 a 0506), com a SGH_TRILHA na mesma transação. A marcação
// em si não passa por aqui: vai pelas portas da agenda de consultas (M17) e de exames (M18), pelo executor; o cadastro
// conferido, pela porta do cadastro (M11).
//   - `legado`: o núcleo (READ ONLY nas leituras; transação SGH_ nas gravações);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas recusas;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo.
import type {
  ConciliacaoPortalLida,
  ConfigAgendaOnlineLida,
  ConfigAgendaOnlineParaGravar,
  FiltroFilaPreCheckin,
  LinhaTrilha,
  NovaConciliacaoPortal,
  NovaIntencaoPagamento,
  PagamentoPortalLido,
  PagamentoTesourariaPortal,
  PesquisaPortalLida,
  PreCheckinLido,
  PreCheckinParaGravar,
  RespostaPesquisaParaGravar,
  ResultadoConfirmacaoPortal,
  TipoAgendaOnline,
} from '@sgh/legado';

export const PORTA_AGENDA_ONLINE = Symbol('PORTA_AGENDA_ONLINE');

export interface ContextoAgendaOnline {
  readonly rede: string;
  readonly hospital: string;
}

export interface ConfirmacaoParaGravar {
  readonly transacao: string;
  readonly resultado: 'aprovado' | 'recusado' | 'expirado';
  readonly comprovante: string;
  readonly por: 'retorno' | 'conferencia';
}

/** As gravações (o estabelecimento vem do contexto). */
export interface GravadorAgendaOnline {
  gravarConfig(c: Omit<ConfigAgendaOnlineParaGravar, 'hospital'>): Promise<{ id: number; versao: number }>;
  enviarPreCheckin(p: Omit<PreCheckinParaGravar, 'hospital'>): Promise<{ id: number; versao: number }>;
  decidirPreCheckin(
    id: number,
    versao: number,
    d:
      | { conferido: true; campos: readonly string[]; por: string }
      | { conferido: false; motivo: string; por: string },
  ): Promise<void>;
  /** A reserva da conferência antes da receita do M11 (o paciente não reenvia enquanto vale). */
  reservarConferencia(id: number, versao: number, por: string): Promise<{ versao: number }>;
  /** A receita do M11 recusou: desfaz a reserva. */
  liberarConferencia(id: number, versao: number): Promise<void>;
  cancelarPreCheckin(tipo: TipoAgendaOnline, marcacao: number): Promise<number>;
  iniciarPagamento(p: Omit<NovaIntencaoPagamento, 'hospital'>): Promise<{ id: number }>;
  confirmarPagamento(c: ConfirmacaoParaGravar): Promise<ResultadoConfirmacaoPortal>;
  responderPesquisa(r: Omit<RespostaPesquisaParaGravar, 'hospital'>): Promise<{ id: number }>;
  /** W0-10: o ato da tesouraria (só inclusão; a regra conferida com o pagamento travado). */
  registrarConciliacao(n: Omit<NovaConciliacaoPortal, 'hospital'>): Promise<ConciliacaoPortalLida>;
}

export type TrilhaAgendaOnline<T> = LinhaTrilha | ((r: T) => LinhaTrilha | null) | null;

export interface PortaAgendaOnline {
  readonly destino: 'legado' | 'memoria';
  gravar<T>(
    c: ContextoAgendaOnline,
    fn: (g: GravadorAgendaOnline) => Promise<T>,
    trilha: TrilhaAgendaOnline<T>,
  ): Promise<T>;
  configs(c: ContextoAgendaOnline): Promise<ConfigAgendaOnlineLida[]>;
  config(
    c: ContextoAgendaOnline,
    tipo: TipoAgendaOnline,
    agenda: number,
  ): Promise<ConfigAgendaOnlineLida | null>;
  preCheckinDaMarcacao(
    c: ContextoAgendaOnline,
    tipo: TipoAgendaOnline,
    marcacao: number,
  ): Promise<PreCheckinLido | null>;
  preCheckinPorId(c: ContextoAgendaOnline, id: number): Promise<PreCheckinLido | null>;
  preCheckinsDoPaciente(c: ContextoAgendaOnline, paciente: number): Promise<PreCheckinLido[]>;
  filaPreCheckin(
    c: ContextoAgendaOnline,
    f: FiltroFilaPreCheckin,
  ): Promise<{ itens: PreCheckinLido[]; haMais: boolean }>;
  pagamentoPorTransacao(c: ContextoAgendaOnline, transacao: string): Promise<PagamentoPortalLido | null>;
  pagamentoPorId(c: ContextoAgendaOnline, id: number): Promise<PagamentoPortalLido | null>;
  pagamentosDoPaciente(c: ContextoAgendaOnline, paciente: number): Promise<PagamentoPortalLido[]>;
  pesquisasDoPaciente(c: ContextoAgendaOnline, paciente: number): Promise<PesquisaPortalLida[]>;
  /** W0-10: a fila da tesouraria (confirmados e duplicados no período, com os atos). */
  tesouraria(c: ContextoAgendaOnline, de: string, ate: string): Promise<PagamentoTesourariaPortal[]>;
  pagamentoTesouraria(c: ContextoAgendaOnline, id: number): Promise<PagamentoTesourariaPortal | null>;
}

export const METODOS_PORTA_AGENDA_ONLINE: ReadonlySet<string> = new Set([
  'gravar',
  'configs',
  'config',
  'preCheckinDaMarcacao',
  'preCheckinPorId',
  'preCheckinsDoPaciente',
  'filaPreCheckin',
  'pagamentoPorTransacao',
  'pagamentoPorId',
  'pagamentosDoPaciente',
  'pesquisasDoPaciente',
  'tesouraria',
  'pagamentoTesouraria',
]);
