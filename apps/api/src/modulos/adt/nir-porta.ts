// Porta do NIR (M44, etapa 2; ficha, seções 4 a 7): o que a fila, a reserva, a alta prevista, as barreiras, o quadro de
// permanência, a reunião de leitos e a calibragem leem e gravam, independente de onde (a API não escreve SQL; fronteira
// Nx):
//   - `legado`: leituras READ ONLY (SGH_INT_SOLIC_LEITO e companhia, as internações abertas com os trechos, a
//     calibragem agregada no banco, as cirurgias que pedem UTI) e as gravações só do novo numa transação SGH_ com a
//     SGH_TRILHA junto;
//   - `memoria`: a sessão sintética de dev/ci (E2E), com o estado compartilhado com a internação em memória;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// O mapa de leitos, o paciente (sexo e nascimento) e o profissional da sessão vêm da porta da internação (M21); a
// admissão e a transferência vindas do NIR são as operações do M21 (executor), com a solicitação na mesma transação.
import type {
  ConfiguracaoRegulacaoLida,
  RegulacaoLida,
  RegulacaoSgh,
  BarreiraLida,
  BarreiraSgh,
  DpaLida,
  DpaSgh,
  EventoSolicitacaoLido,
  HistogramasLidos,
  InternadoQuadroLido,
  LinhaTrilha,
  ReservaNirLida,
  ReservaSgh,
  SolicitacaoLeitoSgh,
  SolicitacaoNirLida,
  TransicaoSgh,
} from '@sgh/legado';
import type { ChaveLeito, EscopoLimitePermanencia, EstadoSolicitacaoNir, PerfilLeito } from '@sgh/contratos';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_NIR = Symbol('PORTA_NIR');

export type ContextoNir = ContextoPortaM18;

/** Gravações só do novo (SGH_), numa transação com a SGH_TRILHA junto. */
export interface GravadorNir {
  solicitar(s: Omit<SolicitacaoLeitoSgh, 'hospital'>): Promise<number>;
  transicionar(t: Omit<TransicaoSgh, 'hospital'>): Promise<number>;
  reservar(r: Omit<ReservaSgh, 'hospital'>): Promise<number>;
  confirmarReserva(r: { reserva: number; validadeMin: number; usuario: string }): Promise<number>;
  encerrarReserva(r: {
    reserva: number;
    situacao: 'cancelada' | 'expirada' | 'consumida';
    motivo?: string | null;
    vencidaEm?: string | null;
    usuario: string;
  }): Promise<number>;
  registrarDpa(d: Omit<DpaSgh, 'hospital'>): Promise<number>;
  registrarBarreira(b: Omit<BarreiraSgh, 'hospital'>): Promise<number>;
  resolverBarreira(b: {
    barreira: number;
    cancelar: boolean;
    observacao: string | null;
    usuario: string;
  }): Promise<number>;
  gravarLimite(l: {
    escopo: EscopoLimitePermanencia;
    chave: string;
    amareloDias: number;
    vermelhoDias: number;
    origem: 'manual' | 'calibrado';
    amostra: number | null;
    /** Obrigatório quando o limite próprio já existe e muda (o valor anterior vai à trilha). */
    motivo?: string | null;
    usuario: string;
  }): Promise<void>;
  aprovarDepara(d: {
    situacao: number;
    estado: EstadoSolicitacaoNir;
    observacao: string | null;
    usuario: string;
  }): Promise<void>;
  /** Evento próprio a mais na SGH_TRILHA, na mesma transação. */
  registrarEvento(linha: LinhaTrilha): Promise<void>;
  // ── W0-07: correção, alteração e exclusão (só SGH_, a versão anterior na SGH_INT_ALTERACAO) ──
  corrigirSolicitacao(c: {
    solicitacao: number;
    versaoVista: number;
    perfil: PerfilLeito;
    recursos: readonly string[];
    observacao: string | null;
    motivo: string;
    usuario: string;
  }): Promise<number>;
  /** Exclui a criada por engano, sem desdobramento (com retrato); com vínculo, recusa com a contagem. */
  excluirSolicitacao(x: { solicitacao: number; motivo: string; usuario: string }): Promise<number>;
  alterarReserva(r: {
    reserva: number;
    leito: ChaveLeito | null;
    validadeMin: number | null;
    motivo: string;
    usuario: string;
  }): Promise<{
    solicitacao: number;
    leitoAnterior: ChaveLeito;
    /** A reserva estava confirmada e o leito mudou: voltou a 'ativa' (o setor confirma o leito novo). */
    confirmacaoDesfeita: boolean;
  }>;
  /** Exclui a reserva ativa criada por engano (com retrato); a convertida em internação recusa 409. */
  /** Devolve também o ID do retrato na SGH_HIST_EXCLUSAO (o evento da solicitação o cita). */
  excluirReserva(r: {
    reserva: number;
    motivo: string;
    usuario: string;
  }): Promise<{ solicitacao: number; retrato: number }>;
  retirarDpa(d: {
    reg: number;
    anterior: number;
    motivo: string;
    vinculo: number;
    usuario: string;
  }): Promise<number>;
  alterarBarreira(b: {
    barreira: number;
    descricao: string | null;
    responsavel: string | null;
    prazo: string | null;
    motivo: string;
    usuario: string;
  }): Promise<number>;
  removerLimite(l: {
    escopo: EscopoLimitePermanencia;
    chave: string;
    motivo: string;
    usuario: string;
  }): Promise<number>;
  /** M44 (etapa 3): o registro da regulação (e, com o conector, o pedido na outbox na mesma transação). */
  registrarRegulacao(r: Omit<RegulacaoSgh, 'hospital'>): Promise<{ id: number; outbox: string | null }>;
}

export interface PortaNir extends PortaGravacaoM18<GravadorNir> {
  relogio(c: ContextoNir): Promise<{ agora: string; hoje: string }>;
  abertas(c: ContextoNir): Promise<{ itens: SolicitacaoNirLida[]; cortada: boolean }>;
  solicitacao(c: ContextoNir, id: number): Promise<SolicitacaoNirLida | null>;
  eventos(c: ContextoNir, ids: readonly number[]): Promise<EventoSolicitacaoLido[]>;
  concluidas(
    c: ContextoNir,
    desde: string,
  ): Promise<{ solicitadoEm: string; internadoEm: string; prazoEm: string }[]>;
  reservasVigentes(c: ContextoNir): Promise<ReservaNirLida[]>;
  reservasEncerradas(c: ContextoNir): Promise<ReservaNirLida[]>;
  cirurgiasUti(
    c: ContextoNir,
  ): Promise<
    { agendamento: number; paciente: number | null; nome: string; dataHora: string; sala: number }[]
  >;
  cirurgiasComSolicitacao(c: ContextoNir, agendamentos: readonly number[]): Promise<Set<number>>;
  internados(c: ContextoNir): Promise<{ itens: InternadoQuadroLido[]; cortada: boolean }>;
  internacao(c: ContextoNir, reg: number): Promise<{ reg: number; pront: number; internado: boolean } | null>;
  dpas(c: ContextoNir, regs: readonly number[]): Promise<DpaLida[]>;
  barreiras(c: ContextoNir, regs: readonly number[]): Promise<BarreiraLida[]>;
  barreira(c: ContextoNir, id: number): Promise<{ id: number; reg: number; situacao: string } | null>;
  limites(c: ContextoNir): Promise<
    {
      escopo: EscopoLimitePermanencia;
      chave: string;
      amareloDias: number;
      vermelhoDias: number;
      origem: string;
      amostra: number | null;
    }[]
  >;
  depara(
    c: ContextoNir,
  ): Promise<{ situacao: number; estado: EstadoSolicitacaoNir; aprovadoPor: string; aprovadoEm: string }[]>;
  situacoes(c: ContextoNir): Promise<Map<number, string>>;
  histogramas(
    c: ContextoNir,
    o: { escopo: EscopoLimitePermanencia; inicio: string; fim: string; intensivas: readonly number[] },
  ): Promise<HistogramasLidos>;
  /** M44 (etapa 3): os registros de regulação das solicitações e a configuração de regulação (consulta). */
  regulacoes(c: ContextoNir, solicitacoes: readonly number[]): Promise<RegulacaoLida[]>;
  configuracaoRegulacao(c: ContextoNir): Promise<ConfiguracaoRegulacaoLida>;
}

export const METODOS_PORTA_NIR: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'relogio',
  'abertas',
  'solicitacao',
  'eventos',
  'concluidas',
  'reservasVigentes',
  'reservasEncerradas',
  'cirurgiasUti',
  'cirurgiasComSolicitacao',
  'internados',
  'internacao',
  'dpas',
  'barreiras',
  'barreira',
  'limites',
  'depara',
  'situacoes',
  'histogramas',
  'regulacoes',
  'configuracaoRegulacao',
]);
