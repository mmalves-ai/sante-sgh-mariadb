// Porta da cirurgia segura e do rastreio no bloco (M46, etapa 2: checklist em três momentos, trava da incisão, rastreio e
// painel para familiares; ficha, seções 4, 5 e 7), independente de onde (a API não escreve SQL; fronteira Nx):
//   - `legado`: as leituras READ ONLY (os domínios do bloco, as SGH_CC_CHECKLIST*, SGH_CC_MOVIMENTO e
//     SGH_CC_PAINEL_CODIGO) e as gravações só do novo numa transação SGH_ com a SGH_TRILHA junto; a gravação relê na
//     MESMA transação o checklist (travado) e a sequência do rastreio, e o domínio confere de novo ali;
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas regras e recusas; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// O agendamento, a sala, o estado do M18 e os nomes vêm da porta do centro cirúrgico; o contexto do paciente, da porta da
// anestesia (M46.1).
import type {
  AberturaChecklistSgh,
  ChecklistLidoSgh,
  CodigoPainelLido,
  ConfirmacaoChecklistSgh,
  DominiosRastreioLidos,
  MovimentoBlocoSgh,
  MovimentoLidoSgh,
} from '@sgh/legado';
import type { MomentoChecklist } from '@sgh/contratos';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_BLOCO_SEGURO = Symbol('PORTA_BLOCO_SEGURO');

type SemHospital<T> = Omit<T, 'hospital'>;

/** Gravações só do novo (SGH_), numa transação com a SGH_TRILHA junto; as leituras aqui são da mesma transação. */
export interface GravadorBlocoSeguro {
  /** O agendamento relido na transação (a linha da agenda existe? o estado do novo). */
  agendamentoNaTransacao(agendamento: number): Promise<{ existe: boolean; estado: string | null }>;
  /** O checklist relido na transação (travado até o fim), ou null. */
  checklist(agendamento: number): Promise<ChecklistLidoSgh | null>;
  /** O pedido já gravado (o reenvio da mesma chave): a confirmação do primeiro item, ou o movimento. */
  confirmacaoPelaChave(chave: string, item: string): Promise<{ id: number; checklist: number } | null>;
  movimentoPelaChave(chave: string): Promise<{ id: number; agendamento: number; sequencia: number } | null>;
  abrirChecklist(a: SemHospital<AberturaChecklistSgh>): Promise<{ id: number; versao: number }>;
  confirmarItens(
    c: SemHospital<ConfirmacaoChecklistSgh>,
  ): Promise<{ ids: number[]; versao: number; repetida: boolean }>;
  concluirMomento(c: {
    readonly checklist: number;
    readonly versaoVista: number;
    readonly momento: MomentoChecklist;
    readonly em: string;
    readonly usuario: string;
    /** A chave natural da cirurgia: liga o ato registrado (CCCADCIR pelo REG), quando há. */
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
  movimentos(agendamento: number): Promise<MovimentoLidoSgh[]>;
  /** O estado do M18 do agendamento relido na transação (a marcação "no bloco" e "em sala"). */
  estadoDoAgendamento(agendamento: number): Promise<{ id: number; estado: string } | null>;
  mover(
    m: SemHospital<MovimentoBlocoSgh>,
  ): Promise<{ id: number; sequencia: number; repetida: boolean; codigo: string | null }>;
}

export interface PortaBlocoSeguro extends PortaGravacaoM18<GravadorBlocoSeguro> {
  dominios(c: ContextoPortaM18): Promise<DominiosRastreioLidos>;
  checklist(c: ContextoPortaM18, agendamento: number): Promise<ChecklistLidoSgh | null>;
  checklists(c: ContextoPortaM18, agendamentos: readonly number[]): Promise<Map<number, ChecklistLidoSgh>>;
  movimentos(c: ContextoPortaM18, agendamento: number): Promise<MovimentoLidoSgh[]>;
  movimentosDe(
    c: ContextoPortaM18,
    agendamentos: readonly number[],
  ): Promise<Map<number, MovimentoLidoSgh[]>>;
  /** Os agendamentos com movimento desde o instante (o painel e os pacientes de outro dia ainda no bloco). */
  movidosDesde(c: ContextoPortaM18, desde: string): Promise<number[]>;
  codigos(
    c: ContextoPortaM18,
    agora: string,
    agendamentos?: readonly number[],
  ): Promise<Map<number, CodigoPainelLido>>;
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
