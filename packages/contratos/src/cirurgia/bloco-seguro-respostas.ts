// Respostas da API da cirurgia segura e do rastreio no bloco (ficha do M46, etapa 2): o checklist em três momentos, o
// quadro do bloco (o mapa do dia com o estado de segurança por cirurgia), o rastreio de um paciente e o painel para
// familiares. O painel leva só o código anônimo, a etapa e o horário (regra 5): nenhum nome, procedimento nem sala.
import type { GravacaoAgenda } from '../agenda/respostas.js';
import type { ContextoAnestesiaResposta } from './anestesia-respostas.js';
import type { ConclusaoApa, SituacaoFicha } from './anestesia-vocabulario.js';
import type {
  DestinoSaidaBloco,
  EtapaPainelFamilia,
  MomentoChecklist,
  RecusaBlocoSeguro,
  RespostaChecklist,
  SituacaoChecklist,
  TipoItemChecklist,
  TipoMovimentoBloco,
} from './bloco-seguro-vocabulario.js';

export interface ItemChecklistResposta {
  readonly codigo: string;
  readonly rotulo: string;
  readonly tipo: TipoItemChecklist;
  readonly observacaoSe: RespostaChecklist | null;
  readonly resposta: RespostaChecklist | null;
  readonly observacao: string | null;
  readonly confirmadoEm: string | null;
  /** O login de quem confirmou (o circulante). */
  readonly confirmadoPor: string | null;
  readonly alerta: boolean;
}

export interface MomentoChecklistResposta {
  readonly momento: MomentoChecklist;
  readonly rotulo: string;
  readonly concluidoEm: string | null;
  readonly concluidoPor: string | null;
  readonly itens: readonly ItemChecklistResposta[];
  /** Os itens sem resposta válida para concluir (o rótulo de cada um). */
  readonly pendentes: readonly string[];
  /** O que impede concluir agora (null: pode concluir). */
  readonly impedimento: RecusaBlocoSeguro | null;
}

export interface ExcecaoIncisaoResposta {
  readonly em: string;
  readonly por: string;
  readonly motivo: string;
}

export interface ChecklistResposta {
  /** null: nenhum item confirmado ainda (o checklist nasce na primeira confirmação). */
  readonly id: number | null;
  readonly versao: number;
  /** A versão da lista de itens usada (a gravada no checklist). */
  readonly lista: number;
  readonly situacao: SituacaoChecklist | null;
  readonly momentos: readonly MomentoChecklistResposta[];
  readonly excecao: ExcecaoIncisaoResposta | null;
  /** A incisão pode ser registrada no novo (pausa cirúrgica concluída ou exceção registrada). */
  readonly incisaoLiberada: boolean;
  /** Os itens em alerta (alergia, via aérea difícil, sangramento, problema de equipamento). */
  readonly alertas: readonly string[];
  /** O registro no prontuário (o formulário do bloco publicado); null até a publicação (DP-27). */
  readonly registroProntuario: number | null;
}

export interface TravaIncisaoResposta {
  /** A trava da incisão está ligada para o bloco deste estabelecimento? */
  readonly ligada: boolean;
  readonly motivo: string | null;
}

export interface TelaChecklistResposta {
  readonly contexto: ContextoAnestesiaResposta;
  readonly checklist: ChecklistResposta;
  /** O caráter do agendamento (1 urgência, 2 eletiva, 3 acidente; null: não informado). */
  readonly carater: number | null;
  readonly trava: TravaIncisaoResposta;
  readonly agora: string;
  readonly gravacao: GravacaoAgenda;
}

/** O estado de segurança de uma cirurgia no quadro do bloco (três momentos, exceção e alertas). */
export interface SegurancaNoQuadro {
  readonly inducao: boolean;
  readonly incisao: boolean;
  readonly saida: boolean;
  readonly excecao: boolean;
  readonly alertas: number;
}

export interface LocalNoQuadro {
  readonly id: number;
  readonly rotulo: string;
  readonly desde: string;
  readonly salaCirurgica: number | null;
}

/** Uma cirurgia do dia no quadro do bloco (o mapa do dia com o estado de segurança, ficha seção 4). */
export interface LinhaQuadroBloco {
  readonly agendamento: number;
  readonly sala: number;
  readonly inicio: string;
  /** O nome do paciente (quadro da equipe do bloco; leitura auditada). */
  readonly paciente: string;
  readonly procedimento: string | null;
  /** O estado do agendamento (solicitado, confirmado, no bloco, em sala, realizado...). */
  readonly estado: string;
  readonly apa: ConclusaoApa | null;
  readonly ficha: SituacaoFicha | null;
  readonly checklist: SegurancaNoQuadro | null;
  readonly local: LocalNoQuadro | null;
  readonly saiu: { readonly em: string; readonly destino: DestinoSaidaBloco | null } | null;
  readonly codigoPainel: string | null;
  readonly ultimoMovimento: number;
}

export interface QuadroBlocoResposta {
  readonly data: string;
  readonly agora: string;
  readonly linhas: readonly LinhaQuadroBloco[];
  readonly truncado: boolean;
  /** Contagens do dia (com as parcelas impressas na tela). */
  readonly totais: {
    readonly cirurgias: number;
    readonly noBloco: number;
    readonly emSala: number;
    readonly naRecuperacao: number;
    readonly pausaConcluida: number;
  };
  readonly gravacao: GravacaoAgenda;
}

export interface MovimentoBlocoResposta {
  readonly id: number;
  readonly sequencia: number;
  readonly tipo: TipoMovimentoBloco;
  readonly rotulo: string;
  readonly local: number | null;
  readonly localRotulo: string | null;
  readonly salaCirurgica: number | null;
  readonly em: string;
  readonly destino: DestinoSaidaBloco | null;
  readonly observacao: string | null;
  readonly usuario: string;
}

export interface TelaRastreioResposta {
  readonly agendamento: number;
  readonly sala: number;
  readonly inicio: string;
  readonly paciente: string;
  readonly movimentos: readonly MovimentoBlocoResposta[];
  readonly local: LocalNoQuadro | null;
  readonly dentro: boolean;
  readonly codigoPainel: string | null;
  readonly codigoValidoAte: string | null;
  /** Os movimentos que cabem agora (a tela mostra só estes). */
  readonly permitidos: readonly TipoMovimentoBloco[];
  readonly ultimoMovimento: number;
  readonly agora: string;
  readonly gravacao: GravacaoAgenda;
}

export interface DominiosRastreioResposta {
  readonly locais: readonly { readonly id: number; readonly rotulo: string; readonly nome: string }[];
  readonly tipos: readonly {
    readonly id: number;
    readonly codigo: TipoMovimentoBloco;
    readonly rotulo: string;
  }[];
  readonly salas: readonly { readonly codigo: number; readonly nome: string }[];
}

/** Uma linha do painel para familiares: só o código anônimo, a etapa e o horário (regra 5). */
export interface LinhaPainelFamilia {
  readonly codigo: string;
  readonly etapa: EtapaPainelFamilia;
  readonly rotuloEtapa: string;
  /** "HH:mm" desde quando o paciente está na etapa. */
  readonly desde: string;
}

export interface PainelFamiliaResposta {
  readonly nome: string;
  readonly atualizadoEm: string;
  readonly linhas: readonly LinhaPainelFamilia[];
}

export interface ResultadoBlocoSeguro {
  readonly ok: true;
  readonly id: number;
  readonly mensagem: string;
  /** O código do painel para familiares criado na entrada no bloco. */
  readonly codigoPainel?: string | null;
}
