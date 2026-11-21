// Porta da etapa 2 do portal do paciente (M50): a configuração da agenda online, o pré-check-in, a intenção de pagamento
// e a pesquisa de satisfação. A marcação em si não passa por aqui: vai pelas portas da agenda de consultas e de exames;
// o cadastro conferido, pela porta do cadastro.
//   - `banco`: a porta própria (agenda/porta-propria.ts), hoje sem modelo para a etapa 2 (recusa nomeada, 503);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas recusas;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo.
import type { RegistroTrilhaPortal } from '../tipos.js';
import type {
  ConciliacaoPortal,
  ConfigAgendaOnline,
  ConfigAgendaOnlineParaGravar,
  FiltroPreCheckins,
  NovaConciliacaoPortal,
  NovaIntencaoPagamento,
  PagamentoPortal,
  PagamentoTesourariaPortal,
  PesquisaPortal,
  PreCheckinOnline,
  PreCheckinParaGravar,
  RespostaPesquisaParaGravar,
  ResultadoConfirmacaoPortal,
  TipoAgendaOnline,
} from './tipos.js';

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
  registrarConciliacao(n: Omit<NovaConciliacaoPortal, 'hospital'>): Promise<ConciliacaoPortal>;
}

export type TrilhaAgendaOnline<T> = RegistroTrilhaPortal | ((r: T) => RegistroTrilhaPortal | null) | null;

export interface PortaAgendaOnline {
  readonly destino: 'banco' | 'memoria';
  gravar<T>(
    c: ContextoAgendaOnline,
    fn: (g: GravadorAgendaOnline) => Promise<T>,
    trilha: TrilhaAgendaOnline<T>,
  ): Promise<T>;
  configs(c: ContextoAgendaOnline): Promise<ConfigAgendaOnline[]>;
  config(c: ContextoAgendaOnline, tipo: TipoAgendaOnline, agenda: number): Promise<ConfigAgendaOnline | null>;
  preCheckinDaMarcacao(
    c: ContextoAgendaOnline,
    tipo: TipoAgendaOnline,
    marcacao: number,
  ): Promise<PreCheckinOnline | null>;
  preCheckinPorId(c: ContextoAgendaOnline, id: number): Promise<PreCheckinOnline | null>;
  preCheckinsDoPaciente(c: ContextoAgendaOnline, paciente: number): Promise<PreCheckinOnline[]>;
  filaPreCheckin(
    c: ContextoAgendaOnline,
    f: FiltroPreCheckins,
  ): Promise<{ itens: PreCheckinOnline[]; haMais: boolean }>;
  pagamentoPorTransacao(c: ContextoAgendaOnline, transacao: string): Promise<PagamentoPortal | null>;
  pagamentoPorId(c: ContextoAgendaOnline, id: number): Promise<PagamentoPortal | null>;
  pagamentosDoPaciente(c: ContextoAgendaOnline, paciente: number): Promise<PagamentoPortal[]>;
  pesquisasDoPaciente(c: ContextoAgendaOnline, paciente: number): Promise<PesquisaPortal[]>;
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
