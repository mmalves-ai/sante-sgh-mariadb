// Tipos de negócio da porta da farmácia hospitalar e da farmácia clínica (M29): o que a porta lê e grava, no
// vocabulário do produto (id do atendimento, booleanos, datas ISO), sem os tipos do sistema de origem.
// Melhoria: o horário prescrito diz se está suspenso (booleano), em vez de letras de situação; a dose da fila diz se
// já foi validada pela avaliação farmacêutica registrada (não "validada no outro sistema"); o atendimento pelo nome
// de negócio (atendimento), não pela coluna antiga.
// Pendência de contrato (pedido do lote 02-06): a situação da entrega ainda é o número do contrato das telas
// (7 dispensada, 8 entregue, 9 estornada) e o documento de saída ainda leva ano, mês e número; a porta própria os
// traduz do modelo (dose_dispensada.situacao, dispensacao.numero) na borda.
import type { AchadoAvaliacao, ClasseMedicamento } from '@sgh/contratos/regras-suprimentos';

/** O item de estoque com o que a farmácia precisa para classificar e rastrear a dose. */
export interface ItemFarmacia {
  readonly codigo: number;
  readonly rastreavel: boolean;
  /** A lista de controle especial (ex.: "C1", "B1"), ou null. */
  readonly portaria: string | null;
  readonly psico: boolean;
  readonly antimicrobiano: boolean;
  readonly barras: string | null;
  /** Regra de envio à avaliação farmacêutica (1 nunca, 2 sempre, 3 só urgente), ou null. */
  readonly envioAvaliacao: number | null;
}

/** O horário prescrito que a farmácia dispensa. */
export interface HorarioDaFila {
  readonly id: number;
  /** Id do item prescrito. */
  readonly item: number;
  readonly prescricao: number;
  readonly atendimento: number;
  /** "AAAA-MM-DDTHH:MM" no fuso do estabelecimento. */
  readonly previsto: string;
  readonly suspenso: boolean;
  readonly tipo: 'medicamento' | 'material' | 'solucao' | string;
  readonly descricao: string;
  readonly dose: number | null;
  readonly unidadeDose: string | null;
  readonly via: string | null;
  /** O item de estoque (insumo) da dose, ou null. */
  readonly produto: number | null;
  readonly altaVigilancia: boolean;
  readonly antimicrobiano: boolean;
}

export interface DoseDaFila {
  readonly horario: HorarioDaFila;
  readonly atendimento: number;
  readonly paciente: number;
  readonly leito: string;
  readonly iniciais: string;
  readonly alergia: boolean;
  readonly dispensada: boolean;
  /** Já liberada pela avaliação farmacêutica registrada antes. */
  readonly validadaAntes: boolean;
  readonly urgente: boolean;
}

export interface AvaliacaoRegistrada {
  readonly id: number;
  readonly item: number;
  readonly estado: 'pendente' | 'decidido' | 'automatico';
  readonly decisao: string | null;
  readonly destino: 'automatica' | 'humana';
  readonly prioridade: number;
  readonly achados: string[];
  readonly desde: string;
  readonly farmaceutico: string | null;
}

/** O documento de saída do estoque (número por ano e mês, no contrato das telas). */
export interface DocumentoSaida {
  readonly id: number;
  readonly ano: number;
  readonly mes: number;
  readonly doc: number;
}

export interface DoseDispensada {
  readonly dose: number;
  readonly horario: number | null;
  readonly item: number;
  readonly descricao: string;
  readonly quantidade: number;
  readonly dispensadaEm: string;
  readonly etiquetaEmitida: boolean;
  readonly saida: DocumentoSaida | null;
  readonly itemSaida: number | null;
  readonly lote: string | null;
  readonly validade: string | null;
  readonly loteSaida: number | null;
  readonly situacaoEntrega: number | null;
  readonly barras: string | null;
  readonly devolvido: number;
}

export interface EntregaRegistrada {
  readonly controle: number;
  readonly situacao: number;
  readonly desde: string;
  readonly saida: DocumentoSaida | null;
  readonly atendimento: number;
  readonly centroCusto: number;
  readonly usuario: string;
  readonly itens: number;
}

export interface IntervencaoRegistrada {
  readonly id: number;
  readonly avaliacao: number | null;
  readonly item: number;
  readonly tipo: string;
  readonly texto: string;
  readonly autor: string;
  readonly prescritor: string | null;
  readonly criadaEm: string;
  readonly estado: 'aberta' | 'respondida';
  readonly resposta: 'aceita' | 'recusada' | null;
  readonly justificativa: string | null;
  readonly respondente: string | null;
  readonly respondidaEm: string | null;
  readonly atendimento: number;
}

export interface ItemControlado {
  readonly item: number;
  readonly nome: string;
  readonly portaria: string;
  readonly estoque: number;
}

export interface MovimentoControlado {
  readonly item: number;
  readonly data: string;
  readonly tipo: 'entrada' | 'saida' | 'devolucao' | 'perda' | 'transferencia-entrada' | 'transferencia-saida';
  readonly quantidade: number;
  readonly documento: string;
  readonly documentoId: number;
  readonly prescritor: number | null;
}

/** A triagem automática de um item para a fila da farmácia clínica. */
export interface Triagem {
  readonly item: number;
  readonly horario: number | null;
  readonly classe: ClasseMedicamento;
  readonly destino: 'automatica' | 'humana';
  readonly prioridade: number;
  readonly achados: readonly AchadoAvaliacao[];
  readonly regra: string;
}
