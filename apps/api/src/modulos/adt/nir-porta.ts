// Porta do NIR (M44, etapa 2; ficha, seções 4 a 7): o que a fila, a reserva, a alta prevista, as barreiras, o quadro de
// permanência, a reunião de leitos e a calibragem leem e gravam, independente de onde (a API não escreve SQL; fronteira
// Nx):
//   - `banco`: a porta própria (nir-porta-propria.ts), leituras somente leitura (pedido_leito e companhia, as internações abertas com os trechos, a
//     calibragem agregada no banco, as cirurgias que pedem UTI) e as gravações só do novo numa transação com a
//     trilha de auditoria junto;
//   - `memoria`: a sessão sintética de dev/ci (E2E), com o estado compartilhado com a internação em memória;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// O mapa de leitos, o paciente (sexo e nascimento) e o profissional da sessão vêm da porta da internação (M21); a
// admissão e a transferência vindas do NIR são as operações do M21 (executor), com a solicitação na mesma transação.
import {
  type AltaPrevistaRegistrada,
  type BarreiraDaAlta,
  type ConfiguracaoRegulacaoNir,
  type EventoSolicitacaoNir,
  type HistogramasPermanencia,
  type InternadoDoQuadro,
  type NovaAltaPrevista,
  type NovaBarreira,
  type NovaRegulacao,
  type NovaReserva,
  type NovaSolicitacaoLeito,
  type RegistroRegulacaoNir,
  type ReservaLeitoNir,
  type SolicitacaoLeitoNir,
  type TransicaoSolicitacao,
} from './tipos.js';
import { type LinhaTrilha } from '@sgh/nucleo';
import type { ChaveLeito, EscopoLimitePermanencia, EstadoSolicitacaoNir, PerfilLeito } from '@sgh/contratos';
import { type PortaGravacaoM18, portaIndisponivel } from '../exames/public-api.js';
import type { ContextoAdt } from './porta.js';

export const PORTA_NIR = Symbol('PORTA_NIR');

export type ContextoNir = ContextoAdt;

/** Gravações do NIR numa transação com a linha da trilha junto. */
export interface GravadorNir {
  solicitar(s: Omit<NovaSolicitacaoLeito, 'hospital'>): Promise<number>;
  transicionar(t: Omit<TransicaoSolicitacao, 'hospital'>): Promise<number>;
  reservar(r: Omit<NovaReserva, 'hospital'>): Promise<number>;
  confirmarReserva(r: { reserva: number; validadeMin: number; usuario: string }): Promise<number>;
  encerrarReserva(r: {
    reserva: number;
    situacao: 'cancelada' | 'expirada' | 'consumida';
    motivo?: string | null;
    vencidaEm?: string | null;
    usuario: string;
  }): Promise<number>;
  registrarDpa(d: Omit<NovaAltaPrevista, 'hospital'>): Promise<number>;
  registrarBarreira(b: Omit<NovaBarreira, 'hospital'>): Promise<number>;
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
  /** Evento próprio a mais na trilha, na mesma transação. */
  registrarEvento(linha: LinhaTrilha): Promise<void>;
  // ── W0-07: correção, alteração e exclusão (a versão anterior na trilha de auditoria) ──
  corrigirSolicitacao(c: {
    solicitacao: number;
    versaoVista: number;
    perfil: PerfilLeito;
    recursos: readonly string[];
    observacao: string | null;
    motivo: string;
    usuario: string;
  }): Promise<number>;
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
  registrarRegulacao(r: Omit<NovaRegulacao, 'hospital'>): Promise<{ id: number; outbox: string | null }>;
}

export interface PortaNir extends PortaGravacaoM18<GravadorNir> {
  relogio(c: ContextoNir): Promise<{ agora: string; hoje: string }>;
  abertas(c: ContextoNir): Promise<{ itens: SolicitacaoLeitoNir[]; cortada: boolean }>;
  solicitacao(c: ContextoNir, id: number): Promise<SolicitacaoLeitoNir | null>;
  eventos(c: ContextoNir, ids: readonly number[]): Promise<EventoSolicitacaoNir[]>;
  concluidas(
    c: ContextoNir,
    desde: string,
  ): Promise<{ solicitadoEm: string; internadoEm: string; prazoEm: string }[]>;
  reservasVigentes(c: ContextoNir): Promise<ReservaLeitoNir[]>;
  reservasEncerradas(c: ContextoNir): Promise<ReservaLeitoNir[]>;
  cirurgiasUti(
    c: ContextoNir,
  ): Promise<
    { agendamento: number; paciente: number | null; nome: string; dataHora: string; sala: number }[]
  >;
  cirurgiasComSolicitacao(c: ContextoNir, agendamentos: readonly number[]): Promise<Set<number>>;
  internados(c: ContextoNir): Promise<{ itens: InternadoDoQuadro[]; cortada: boolean }>;
  internacao(c: ContextoNir, reg: number): Promise<{ reg: number; pront: number; internado: boolean } | null>;
  dpas(c: ContextoNir, regs: readonly number[]): Promise<AltaPrevistaRegistrada[]>;
  barreiras(c: ContextoNir, regs: readonly number[]): Promise<BarreiraDaAlta[]>;
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
  ): Promise<HistogramasPermanencia>;
  /** M44 (etapa 3): os registros de regulação das solicitações e a configuração de regulação (consulta). */
  regulacoes(c: ContextoNir, solicitacoes: readonly number[]): Promise<RegistroRegulacaoNir[]>;
  configuracaoRegulacao(c: ContextoNir): Promise<ConfiguracaoRegulacaoNir>;
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

/** Porta indisponível (fora de dev/ci sem o núcleo): 503 em tudo (falha fechada). */
export function portaNirIndisponivel(): PortaNir {
  return portaIndisponivel<PortaNir>(METODOS_PORTA_NIR);
}
