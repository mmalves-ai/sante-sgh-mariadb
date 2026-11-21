// Porta da cirurgia segura e do rastreio no bloco (M46, etapa 2: checklist em três momentos, trava da incisão, rastreio e
// painel para familiares; ficha, seções 4, 5 e 7), independente de onde (a API não escreve SQL; fronteira Nx):
//   - `banco`: o banco do cliente pelo @sgh/nucleo (porta-propria), com o Executor e a trilha na mesma transação;
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas regras e recusas; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// O agendamento, a sala, o estado do M18 e os nomes vêm da porta do centro cirúrgico; o contexto do paciente, da porta da
// anestesia (M46.1).
import type {
  AberturaChecklist,
  ChecklistDaCirurgia,
  CodigoDoPainel,
  ConfirmacaoChecklist,
  DominiosRastreio,
  MovimentoDoBloco,
  MovimentoNoBloco,
} from './tipos.js';
import type { MomentoChecklist } from '@sgh/contratos';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_BLOCO_SEGURO = Symbol('PORTA_BLOCO_SEGURO');

type SemHospital<T> = Omit<T, 'hospital'>;

/** Gravações diretas no banco, numa transação com a trilha de auditoria junto; as leituras aqui são da mesma transação. */
export interface GravadorBlocoSeguro {
  /** O agendamento relido na transação (a linha da agenda existe? o estado do novo). */
  agendamentoNaTransacao(agendamento: number): Promise<{ existe: boolean; estado: string | null }>;
  /** O checklist relido na transação (travado até o fim), ou null. */
  checklist(agendamento: number): Promise<ChecklistDaCirurgia | null>;
  /** O pedido já gravado (o reenvio da mesma chave): a confirmação do primeiro item, ou o movimento. */
  confirmacaoPelaChave(chave: string, item: string): Promise<{ id: number; checklist: number } | null>;
  movimentoPelaChave(chave: string): Promise<{ id: number; agendamento: number; sequencia: number } | null>;
  abrirChecklist(a: SemHospital<AberturaChecklist>): Promise<{ id: number; versao: number }>;
  confirmarItens(
    c: SemHospital<ConfirmacaoChecklist>,
  ): Promise<{ ids: number[]; versao: number; repetida: boolean }>;
  concluirMomento(c: {
    readonly checklist: number;
    readonly versaoVista: number;
    readonly momento: MomentoChecklist;
    readonly em: string;
    readonly usuario: string;
    /** A cirurgia do checklist: liga o ato registrado pelo atendimento, pela sala e pelo dia, quando há. */
    readonly cirurgia?: {
      readonly agendamento: number;
      readonly sala: number;
      readonly dataHora: string;
      readonly reg: number;
    };
  }): Promise<{ versao: number }>;
  registrarExcecao(x: {
    readonly checklist: number;
    readonly versaoVista: number;
    readonly em: string;
    readonly motivo: string;
    readonly usuario: string;
  }): Promise<{ versao: number }>;
  /** Os movimentos relidos na transação. */
  movimentos(agendamento: number): Promise<MovimentoDoBloco[]>;
  /** O estado do M18 do agendamento relido na transação (a marcação "no bloco" e "em sala"). */
  estadoDoAgendamento(agendamento: number): Promise<{ id: number; estado: string } | null>;
  mover(
    m: SemHospital<MovimentoNoBloco>,
  ): Promise<{ id: number; sequencia: number; repetida: boolean; codigo: string | null }>;
}

export interface PortaBlocoSeguro extends PortaGravacaoM18<GravadorBlocoSeguro> {
  dominios(c: ContextoPortaM18): Promise<DominiosRastreio>;
  checklist(c: ContextoPortaM18, agendamento: number): Promise<ChecklistDaCirurgia | null>;
  checklists(c: ContextoPortaM18, agendamentos: readonly number[]): Promise<Map<number, ChecklistDaCirurgia>>;
  movimentos(c: ContextoPortaM18, agendamento: number): Promise<MovimentoDoBloco[]>;
  movimentosDe(
    c: ContextoPortaM18,
    agendamentos: readonly number[],
  ): Promise<Map<number, MovimentoDoBloco[]>>;
  /** Os agendamentos com movimento desde o instante (o painel e os pacientes de outro dia ainda no bloco). */
  movidosDesde(c: ContextoPortaM18, desde: string): Promise<number[]>;
  codigos(
    c: ContextoPortaM18,
    agora: string,
    agendamentos?: readonly number[],
  ): Promise<Map<number, CodigoDoPainel>>;
}

export const METODOS_PORTA_BLOCO_SEGURO: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'dominios',
  'checklist',
  'checklists',
  'movimentos',
  'movimentosDe',
  'movidosDesde',
  'codigos',
]);
