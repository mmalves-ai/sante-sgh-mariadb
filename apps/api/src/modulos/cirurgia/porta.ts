// Porta do centro cirúrgico (M18): o que as telas do mapa, do registro e das salas leem e gravam, independente de onde
// (a API não escreve SQL; fronteira Nx):
//   - `legado`: o núcleo do legado (leituras READ ONLY dos repositórios de @sgh/legado; gravações pelo EXECUTOR do
//     M04, com a trilha na mesma transação; a solicitação, o andamento, as pendências e a revisão da ligação, só do
//     novo, em transação SGH_ com a SGH_TRILHA junto);
//   - `memoria`: a sessão sintética de dev/ci (E2E): salas, agendamentos e cirurgias SINTÉTICOS em memória, com as
//     mesmas validações (Zod dos contratos) e as mesmas recusas das receitas; nada vai à cópia;
//   - `indisponivel`: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type {
  AgendamentoLido,
  CancelamentoCirurgiaLido,
  EstadoCirurgiaLido,
  AlteracaoPedidoPortal,
  VersaoPedidoLida,
  FiltroRealizadas,
  HistoricoDoPeriodoLido,
  HistoricoLido,
  LigacaoCirurgiaLida,
  OpcoesCirurgiaLidas,
  PendenciaLida,
  ProfissionalDoBloco,
  RealizadaLida,
  RegistroExtLido,
  RelogioLido,
  SalaLida,
  UsuarioDaSalaLido,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_CIRURGIA = Symbol('PORTA_CIRURGIA');

/** Gravações só do novo (SGH_), numa transação com a SGH_TRILHA junto. */
export interface GravadorSghCirurgia {
  solicitar(r: {
    sala: number;
    data: string;
    hora: string;
    duracaoMin: number;
    reg: number;
    pront: number;
    /** Nulo só no pedido do portal do médico externo (o cadastro é localizado ao confirmar). */
    idPaciente: number | null;
    procedimento: number;
    convenio: number;
    cirurgiao: number | null;
    carater: number;
    anestesia: number;
    observacao: string | null;
    usuario: string;
    /** M50 (etapa 3): o pedido feito pelo médico externo no portal. */
    portal?: { acesso: number; paciente: string; nascimento: string | null } | null;
  }): Promise<number>;
  /** M50 (etapa 3): o médico externo retira o próprio pedido ainda solicitado. */
  retirarPedidoPortal(r: {
    id: number;
    acesso: number;
    complemento: string | null;
    usuario: string;
  }): Promise<void>;
  /** W0-10 (script 1147): o médico externo altera o próprio pedido ainda solicitado (devolve a versão nova). */
  alterarPedidoPortal(r: Omit<AlteracaoPedidoPortal, 'hospital'>): Promise<number>;
  mudarEstado(r: {
    id: number;
    estado: string;
    motivo?: string;
    complemento?: string | null;
    solicitante?: string | null;
    usuario: string;
  }): Promise<void>;
  gravarPendencia(r: {
    idEstado: number;
    idCcagenda: number | null;
    tipo: string;
    situacao: string;
    observacao: string | null;
    usuario: string;
  }): Promise<number>;
  gravarLigacao(r: {
    idCccadcir: number;
    idCcagenda: number | null;
    reg: number;
    sala: number;
    data: string;
    usuario: string;
  }): Promise<void>;
}

export interface PacienteDaCirurgia {
  readonly id: number;
  readonly nome: string;
  readonly prontuario: number;
}

export interface PortaCirurgia extends PortaGravacaoM18<GravadorSghCirurgia> {
  relogio(c: ContextoPortaM18): Promise<RelogioLido>;
  salas(c: ContextoPortaM18, login: string): Promise<SalaLida[]>;
  usuariosDaSala(c: ContextoPortaM18, sala: number): Promise<UsuarioDaSalaLido[]>;
  agendamentos(
    c: ContextoPortaM18,
    de: string,
    ate: string,
    salas: readonly number[] | null,
  ): Promise<{ itens: AgendamentoLido[]; truncado: boolean }>;
  agendamento(c: ContextoPortaM18, id: number): Promise<AgendamentoLido | null>;
  adicionais(c: ContextoPortaM18, sala: number, inicio: string): Promise<number[]>;
  historico(c: ContextoPortaM18, sala: number, inicio: string): Promise<HistoricoLido[]>;
  historicoDoPeriodo(
    c: ContextoPortaM18,
    de: string,
    ate: string,
  ): Promise<{ itens: HistoricoDoPeriodoLido[]; truncado: boolean }>;
  cancelados(
    c: ContextoPortaM18,
    de: string,
    ate: string,
  ): Promise<{ itens: CancelamentoCirurgiaLido[]; truncado: boolean }>;
  realizadas(
    c: ContextoPortaM18,
    f: FiltroRealizadas,
  ): Promise<{ itens: RealizadaLida[]; truncado: boolean }>;
  realizada(c: ContextoPortaM18, id: number): Promise<RealizadaLida | null>;
  agendamentosDosRegs(
    c: ContextoPortaM18,
    regs: readonly number[],
  ): Promise<{ id: number; reg: number; sala: number; dia: string }[]>;
  profissionaisDoBloco(c: ContextoPortaM18): Promise<ProfissionalDoBloco[]>;
  buscarProfissionais(c: ContextoPortaM18, texto: string): Promise<ProfissionalDoBloco[]>;
  nomesProfissionais(c: ContextoPortaM18, ids: readonly number[]): Promise<Map<number, string>>;
  /** Os registros dados com o código e o nome, mesmo fora dos profissionais do bloco (o cirurgião do pedido do portal). */
  profissionaisPorRegistro(c: ContextoPortaM18, ids: readonly number[]): Promise<ProfissionalDoBloco[]>;
  nomesProcedimentos(c: ContextoPortaM18, codigos: readonly number[]): Promise<Map<number, string>>;
  buscarProcedimentos(c: ContextoPortaM18, texto: string): Promise<{ codigo: number; nome: string }[]>;
  opcoes(c: ContextoPortaM18): Promise<OpcoesCirurgiaLidas>;
  pacientePorProntuario(c: ContextoPortaM18, pront: number): Promise<{ id: number; nome: string } | null>;
  pacientes(c: ContextoPortaM18, ids: readonly number[]): Promise<PacienteDaCirurgia[]>;
  estadosDoPeriodo(c: ContextoPortaM18, de: string, ate: string): Promise<EstadoCirurgiaLido[]>;
  estadosDosAgendamentos(
    c: ContextoPortaM18,
    ids: readonly number[],
  ): Promise<Map<number, EstadoCirurgiaLido>>;
  estado(c: ContextoPortaM18, id: number): Promise<EstadoCirurgiaLido | null>;
  /** M50 (etapa 3): os pedidos de uma conta do portal do médico externo desde a data. */
  estadosDoPortal(c: ContextoPortaM18, acesso: number, desde: string): Promise<EstadoCirurgiaLido[]>;
  /** W0-10: as versões anteriores dos pedidos do portal (a mais nova primeiro em cada pedido). */
  versoesDosPedidos(c: ContextoPortaM18, ids: readonly number[]): Promise<VersaoPedidoLida[]>;
  /** M50 (etapa 3): a agenda do cirurgião (os registros dele em CCAGENDA.ID_CRM), no período. */
  agendamentosDoCirurgiao(
    c: ContextoPortaM18,
    cirurgioes: readonly number[],
    de: string,
    ate: string,
  ): Promise<{ itens: AgendamentoLido[]; truncado: boolean }>;
  pendencias(c: ContextoPortaM18, idEstado: number): Promise<PendenciaLida[]>;
  ligacoes(c: ContextoPortaM18, realizadas: readonly number[]): Promise<Map<number, LigacaoCirurgiaLida>>;
  registrosExt(c: ContextoPortaM18, realizadas: readonly number[]): Promise<Map<number, RegistroExtLido>>;
}

export const METODOS_PORTA_CIRURGIA: ReadonlySet<string> = new Set([
  'executar',
  'gravarSgh',
  'relogio',
  'salas',
  'usuariosDaSala',
  'agendamentos',
  'agendamento',
  'adicionais',
  'historico',
  'historicoDoPeriodo',
  'cancelados',
  'realizadas',
  'realizada',
  'agendamentosDosRegs',
  'profissionaisDoBloco',
  'buscarProfissionais',
  'nomesProfissionais',
  'profissionaisPorRegistro',
  'nomesProcedimentos',
  'buscarProcedimentos',
  'opcoes',
  'pacientePorProntuario',
  'pacientes',
  'estadosDoPeriodo',
  'estadosDosAgendamentos',
  'estado',
  'estadosDoPortal',
  'versoesDosPedidos',
  'agendamentosDoCirurgiao',
  'pendencias',
  'ligacoes',
  'registrosExt',
]);
