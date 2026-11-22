// Tipos de negócio da agência transfusional (M47, etapa 1): o que a porta (própria ou memória) recebe nas gravações e
// entrega nas leituras que não estão no contrato das telas. Vocabulário neutro: booleano, data ISO, id numérico.
// Melhoria: os tipos são do módulo (antes vinham do pacote do sistema de origem), sem o código do estabelecimento em
// texto (o estabelecimento vem do contexto da sessão).
import type { MomentoSinaisTransfusao, SinaisTransfusao } from '@sgh/contratos';

/** Horário do item de hemoterapia (a situação é a do horário da enfermagem). */
export interface HorarioHemoterapia {
  readonly id: number;
  readonly previsto: string | null;
  /** Situação do horário. */
  readonly situacao: string;
  readonly situacaoEm: string | null;
  readonly historico: number;
}

/** Termo de consentimento do paciente. */
export interface TermoConsentimentoLido {
  readonly id: number;
  readonly anterior: number | null;
  readonly atendimento: number;
  readonly tipo: number | null;
  readonly procedimento: string;
  readonly situacao: 'pendente' | 'assinado' | 'revogado';
  readonly motivo: string | null;
  readonly documento: number | null;
  readonly usuario: string;
  readonly em: string;
}

export interface RequisicaoTransfusaoNova {
  readonly item: number;
  readonly prescricao: number;
  readonly atendimento: number;
  readonly paciente: number;
  readonly hemocomponente: string;
  readonly quantidadeBolsas: number;
  readonly volumeMl: number | null;
  /** ID do tipo de transfusão (1 programada, 2 rotina, 3 urgente, 4 extrema urgência). */
  readonly urgencia: number;
  readonly programadaPara: string | null;
  readonly prazo: string | null;
  readonly indicacao: string;
  readonly examesDeApoio: string | null;
  readonly termo: number | null;
  readonly justificativaUrgencia: string | null;
  readonly transfusaoAnterior: string;
  readonly reacaoAnterior: string;
  readonly gestacaoAnterior: string;
  readonly usuario: string;
  readonly chave: string | null;
}

export interface AmostraTransfusionalNova {
  readonly requisicao: number;
  readonly pulseiraLida: boolean;
  readonly motivoSemPulseira: string | null;
  readonly coletadaEm: string;
  readonly validaAte: string;
  readonly usuario: string;
  readonly estacao: string | null;
  readonly chave: string | null;
  /** Atestados da coleta (nome e nascimento conferidos; tubo rotulado no leito): só o que a tela colheu (padrão: não). */
  readonly identificadoresConferidos?: boolean | undefined;
  readonly rotuladaNoLeito?: boolean | undefined;
}

export interface InicioTransfusaoNovo {
  readonly requisicao: number;
  /** O horário da enfermagem checado na mesma transação (null: o item não tem horário pendente). */
  readonly horario: number | null;
  readonly bolsa: {
    readonly numero: string;
    readonly hemocomponente: string;
    /** IDs do cadastro do estabelecimento (tipo 1 a 4; fator 1 positivo, 2 negativo). */
    readonly abo: number;
    readonly rh: number;
    readonly validade: string;
    readonly volumeMl: number;
  };
  readonly inicioEm: string;
  readonly pulseiraLida: boolean;
  readonly motivoSemPulseira: string | null;
  readonly profissional: string;
  readonly conferente: string;
  readonly alertas: readonly string[];
  readonly justificativaRh: string | null;
  readonly sinaisAntes: SinaisTransfusao;
  readonly sinaisAntesEm: string;
  readonly chave: string | null;
  /** Etapa 2 (agência própria): a bolsa conferida no estoque dentro da transação (liberada ou reservada para ela). */
  readonly estoque?: boolean | undefined;
  /** Atestados de segurança do ato: só o que a tela colheu (padrão: não conferido). */
  readonly etiquetaReceptorConferida?: boolean | undefined;
  readonly inspecaoVisualAprovada?: boolean | undefined;
}

export interface ConclusaoTransfusaoNova {
  readonly ato: number;
  readonly terminoEm: string;
  readonly volumeTransfundidoMl: number;
  readonly interrompida: boolean;
  readonly motivoInterrupcao: string | null;
  readonly usuario: string;
  /** O início da janela de 24 horas do balanço da unidade (hora de corte); null: sem balanço. */
  readonly janelaBalanco: string | null;
  /** A chave do pedido (a repetição é reconhecida); null: sem chave. */
  readonly chave?: string | null | undefined;
}

export interface ReacaoTransfusionalNova {
  readonly ato: number;
  readonly tipo: string;
  readonly descricaoOutra: string | null;
  readonly grau: number;
  readonly correlacao: string;
  readonly inicioEm: string;
  readonly sinaisESintomas: string;
  readonly condutas: readonly string[];
  readonly condutaOutra: string | null;
  readonly destinoBolsa: string;
  readonly prioridade: 'imediata' | 'rotina';
  readonly usuario: string;
  readonly chave: string | null;
  /** Os sinais medidos na reação (vão aos sinais vitais do paciente); null: não medidos. */
  readonly sinais: SinaisTransfusao | null;
  /** Com a transfusão em curso: a interrupção na mesma transação (a primeira conduta). */
  readonly interromper: Omit<ConclusaoTransfusaoNova, 'ato' | 'usuario' | 'interrompida'> | null;
}

export interface AlteracaoRequisicaoNova {
  readonly requisicao: number;
  readonly hemocomponente: string;
  readonly volumeMl: number | null;
  /** ID do tipo de transfusão (1 programada, 2 rotina, 3 urgente, 4 extrema urgência). */
  readonly urgencia: number;
  readonly programadaPara: string | null;
  readonly prazo: string | null;
  readonly motivo: string;
  readonly usuario: string;
}

export interface AdendoAtoNovo {
  readonly ato: number;
  readonly momento: MomentoSinaisTransfusao;
  readonly sinais: SinaisTransfusao;
  readonly motivo: string;
  readonly usuario: string;
}
