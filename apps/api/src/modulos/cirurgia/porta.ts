// Porta do centro cirúrgico (M18): o que as telas do mapa, do registro e das salas leem e gravam, independente de onde
// (a API não escreve SQL; fronteira Nx):
//   - `banco`: o banco do cliente pelo @sgh/nucleo (porta-propria), com o Executor e a trilha na mesma transação;
//   - `memoria`: a sessão sintética de dev/ci (E2E): salas, agendamentos e cirurgias SINTÉTICOS em memória, com as
//     mesmas validações (Zod dos contratos) e as mesmas recusas das receitas; nada vai à cópia;
//   - `indisponivel`: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type {
  AgendamentoDaSala,
  AlteracaoPedidoDoPortal,
  AtoRealizado,
  CancelamentoDaAgenda,
  FiltroRealizadas,
  HistoricoDaAgenda,
  HistoricoDaAgendaNoPeriodo,
  LigacaoDoAto,
  OpcoesDaCirurgia,
  PedidoCirurgia,
  PendenciaDoPedido,
  ProfissionalDoBloco,
  RegistroComplementarAto,
  RelogioDoEstabelecimento,
  SalaDoBloco,
  UsuarioDaSala,
  VersaoDoPedido,
} from './tipos.js';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';
import type { EstadoAgendamento } from '@sgh/dominio-cirurgia';

/**
 * Contexto da gravação direta com a chave de idempotência da requisição. O apoio do M18 (PortaGravacaoM18) ainda não a
 * carrega no contrato: o controlador a põe aqui (pedido do lote 03-01 para levá-la ao apoio).
 */
export type ContextoGravacaoCirurgia = ContextoPortaM18 & { readonly chaveIdempotencia?: string | null };

export const PORTA_CIRURGIA = Symbol('PORTA_CIRURGIA');

/** Gravações diretas no banco, numa transação com a trilha de auditoria junto. */
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
  alterarPedidoPortal(r: Omit<AlteracaoPedidoDoPortal, 'hospital'>): Promise<number>;
  /**
   * Muda o estado do agendamento. `visto`: o estado e a versão que a tela leu; a gravação os confere sob a transação
   * (diferença: 409 conflito-versao) e aplica a regra de transição do domínio.
   */
  mudarEstado(r: {
    id: number;
    estado: EstadoAgendamento;
    visto?: { readonly estado: EstadoAgendamento; readonly versao: number | null } | null;
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
  relogio(c: ContextoPortaM18): Promise<RelogioDoEstabelecimento>;
  salas(c: ContextoPortaM18, login: string): Promise<SalaDoBloco[]>;
  usuariosDaSala(c: ContextoPortaM18, sala: number): Promise<UsuarioDaSala[]>;
  agendamentos(
    c: ContextoPortaM18,
    de: string,
    ate: string,
    salas: readonly number[] | null,
  ): Promise<{ itens: AgendamentoDaSala[]; truncado: boolean }>;
  agendamento(c: ContextoPortaM18, id: number): Promise<AgendamentoDaSala | null>;
  adicionais(c: ContextoPortaM18, sala: number, inicio: string): Promise<number[]>;
  historico(c: ContextoPortaM18, sala: number, inicio: string): Promise<HistoricoDaAgenda[]>;
  historicoDoPeriodo(
    c: ContextoPortaM18,
    de: string,
    ate: string,
  ): Promise<{ itens: HistoricoDaAgendaNoPeriodo[]; truncado: boolean }>;
  cancelados(
    c: ContextoPortaM18,
    de: string,
    ate: string,
  ): Promise<{ itens: CancelamentoDaAgenda[]; truncado: boolean }>;
  realizadas(c: ContextoPortaM18, f: FiltroRealizadas): Promise<{ itens: AtoRealizado[]; truncado: boolean }>;
  realizada(c: ContextoPortaM18, id: number): Promise<AtoRealizado | null>;
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
  opcoes(c: ContextoPortaM18): Promise<OpcoesDaCirurgia>;
  pacientePorProntuario(c: ContextoPortaM18, pront: number): Promise<{ id: number; nome: string } | null>;
  pacientes(c: ContextoPortaM18, ids: readonly number[]): Promise<PacienteDaCirurgia[]>;
  estadosDoPeriodo(c: ContextoPortaM18, de: string, ate: string): Promise<PedidoCirurgia[]>;
  estadosDosAgendamentos(c: ContextoPortaM18, ids: readonly number[]): Promise<Map<number, PedidoCirurgia>>;
  estado(c: ContextoPortaM18, id: number): Promise<PedidoCirurgia | null>;
  /** M50 (etapa 3): os pedidos de uma conta do portal do médico externo desde a data. */
  estadosDoPortal(c: ContextoPortaM18, acesso: number, desde: string): Promise<PedidoCirurgia[]>;
  /** W0-10: as versões anteriores dos pedidos do portal (a mais nova primeiro em cada pedido). */
  versoesDosPedidos(c: ContextoPortaM18, ids: readonly number[]): Promise<VersaoDoPedido[]>;
  /** M50 (etapa 3): a agenda do cirurgião (os agendamentos em que ele é o cirurgião), no período. */
  agendamentosDoCirurgiao(
    c: ContextoPortaM18,
    cirurgioes: readonly number[],
    de: string,
    ate: string,
  ): Promise<{ itens: AgendamentoDaSala[]; truncado: boolean }>;
  pendencias(c: ContextoPortaM18, idEstado: number): Promise<PendenciaDoPedido[]>;
  ligacoes(c: ContextoPortaM18, realizadas: readonly number[]): Promise<Map<number, LigacaoDoAto>>;
  registrosExt(
    c: ContextoPortaM18,
    realizadas: readonly number[],
  ): Promise<Map<number, RegistroComplementarAto>>;
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
