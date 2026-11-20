// Requisição transfusional (ficha do M47, regra 1; cap-05b §5.11 "Requisição transfusional" e §5.7 "hemoterapia"): a
// requisição nasce do item de hemoterapia da prescrição vigente (hemocomponente, dose, indicação), com a urgência da
// RDC 34/2014 (programada, rotina em 24 h, urgente em 3 h, extrema urgência) e o termo de consentimento. Na extrema
// urgência o termo pode vir depois, com a justificativa do médico (termo de responsabilidade) e sem provas
// pré-transfusionais. O prazo de atendimento sai da urgência.
import {
  classeDoHemocomponente,
  type ClasseHemocomponente,
  type EstadoRequisicaoTransfusao,
  HEMOCOMPONENTES_VISTOS,
  URGENCIAS_TRANSFUSAO,
  type UrgenciaTransfusao,
} from '@sgh/contratos';

export interface ItemHemoterapiaDaPrescricao {
  readonly hemocomponente: string;
  readonly dose: number;
  readonly unidadeDose: string;
  readonly indicacao: string | null;
  readonly iniciarAgora: boolean;
  /** Vigência da prescrição (ISO); null = sem fim. */
  readonly vigenteAte: string | null;
  readonly suspenso: boolean;
}

export interface PropostaDeRequisicao {
  readonly hemocomponente: string;
  readonly rotulo: string;
  readonly classe: ClasseHemocomponente;
  readonly quantidadeBolsas: number;
  readonly volumeMl: number | null;
  readonly urgencia: UrgenciaTransfusao;
  readonly indicacao: string;
}

/**
 * O que a tela já preenche a partir do item: o hemocomponente, a quantidade (dose em bolsa ou unidade; em mL vira
 * volume com uma bolsa) e a indicação escrita pelo médico. "Iniciar agora" sugere urgente; o médico confirma.
 */
export function propostaDoItem(item: ItemHemoterapiaDaPrescricao): PropostaDeRequisicao {
  const codigo = item.hemocomponente.trim().toUpperCase();
  const unidade = item.unidadeDose.trim().toUpperCase();
  const emMl = unidade === 'ML';
  const quantidade = emMl ? 1 : Math.max(1, Math.min(20, Math.round(item.dose)));
  return {
    hemocomponente: codigo,
    rotulo: HEMOCOMPONENTES_VISTOS[codigo]?.rotulo ?? codigo,
    classe: classeDoHemocomponente(codigo),
    quantidadeBolsas: quantidade,
    volumeMl: emMl ? Math.round(item.dose) : null,
    urgencia: item.iniciarAgora ? 'urgente' : 'rotina',
    indicacao: (item.indicacao ?? '').replace(/\s+/g, ' ').trim(),
  };
}

export type ProblemaRequisicao =
  | 'item-suspenso'
  | 'prescricao-vencida'
  | 'sem-indicacao'
  | 'sem-termo'
  | 'sem-justificativa-urgencia'
  | 'programada-no-passado'
  | 'requisicao-em-aberto';

export const MENSAGENS_REQUISICAO: Readonly<Record<ProblemaRequisicao, string>> = {
  'item-suspenso': 'O item de hemoterapia foi suspenso na prescrição.',
  'prescricao-vencida': 'A prescrição do item não está mais vigente: peça a renovação ao médico.',
  'sem-indicacao': 'Escreva a indicação clínica da transfusão (ao menos 10 caracteres).',
  'sem-termo': 'Anexe o termo de consentimento da transfusão assinado.',
  'sem-justificativa-urgencia': 'Na extrema urgência sem termo, escreva a justificativa do médico.',
  'programada-no-passado': 'A transfusão programada precisa de um dia e hora futuros.',
  'requisicao-em-aberto': 'Já há uma requisição em aberto para este item.',
};

/** Regra 1: o que impede requisitar (lista vazia = pode). */
export function conferirRequisicao(c: {
  readonly item: ItemHemoterapiaDaPrescricao;
  readonly agora: string;
  readonly urgencia: UrgenciaTransfusao;
  readonly programadaPara: string | null;
  readonly indicacao: string;
  readonly termoAssinado: boolean;
  readonly justificativaUrgencia: string | null;
  readonly requisicaoEmAberto: boolean;
}): readonly ProblemaRequisicao[] {
  const p: ProblemaRequisicao[] = [];
  if (c.item.suspenso) p.push('item-suspenso');
  if (c.item.vigenteAte !== null && c.item.vigenteAte < c.agora) p.push('prescricao-vencida');
  if (c.indicacao.replace(/\s+/g, ' ').trim().length < 10) p.push('sem-indicacao');
  if (!c.termoAssinado) {
    if (c.urgencia !== 'extremaUrgencia') p.push('sem-termo');
    else if ((c.justificativaUrgencia ?? '').trim().length < 10) p.push('sem-justificativa-urgencia');
  }
  if (c.urgencia === 'programada' && (c.programadaPara === null || c.programadaPara <= c.agora))
    p.push('programada-no-passado');
  if (c.requisicaoEmAberto) p.push('requisicao-em-aberto');
  return p;
}

/** A extrema urgência dispensa as provas pré-transfusionais (bolsa O na falta da tipagem; regra 3). */
export function dispensaProvas(u: UrgenciaTransfusao): boolean {
  return u === 'extremaUrgencia';
}

function somarHoras(iso: string, horas: number): string {
  const d = new Date(`${iso.length === 16 ? `${iso}:00` : iso.slice(0, 19)}Z`);
  return new Date(d.getTime() + horas * 3_600_000).toISOString().slice(0, 19);
}

/** O prazo de atendimento da requisição (ISO sem fuso): programada no dia marcado; as outras pelo prazo da urgência. */
export function prazoDaRequisicao(
  urgencia: UrgenciaTransfusao,
  requisitadaEm: string,
  programadaPara: string | null,
): string | null {
  if (urgencia === 'programada') return programadaPara;
  const u = URGENCIAS_TRANSFUSAO.find((x) => x.codigo === urgencia);
  return somarHoras(requisitadaEm, u?.prazoHoras ?? 0);
}

/** A requisição está atrasada: passou do prazo sem ser atendida nem cancelada. */
export function requisicaoAtrasada(c: {
  readonly estado: EstadoRequisicaoTransfusao;
  readonly prazo: string | null;
  readonly agora: string;
}): boolean {
  if (c.estado === 'atendida' || c.estado === 'cancelada' || c.prazo === null) return false;
  return c.prazo < c.agora;
}

/** Passagens da requisição (a amostra pode ser dispensada na extrema urgência). */
const TRANSICOES: Readonly<Record<EstadoRequisicaoTransfusao, readonly EstadoRequisicaoTransfusao[]>> = {
  requisitada: ['amostraColetada', 'emAtendimento', 'cancelada'],
  amostraColetada: ['emAtendimento', 'cancelada'],
  emAtendimento: ['atendida'],
  atendida: [],
  cancelada: [],
};

export function podeMudarRequisicao(
  de: EstadoRequisicaoTransfusao,
  para: EstadoRequisicaoTransfusao,
  urgencia: UrgenciaTransfusao,
): { readonly pode: boolean; readonly motivo: string | null } {
  if (de === 'requisitada' && para === 'emAtendimento' && !dispensaProvas(urgencia))
    return { pode: false, motivo: 'Colete a amostra pré-transfusional antes de iniciar a transfusão.' };
  if (TRANSICOES[de].includes(para)) return { pode: true, motivo: null };
  if (de === para) return { pode: false, motivo: 'A requisição já está nessa situação.' };
  if (de === 'cancelada') return { pode: false, motivo: 'A requisição foi cancelada.' };
  if (para === 'cancelada')
    return { pode: false, motivo: 'A transfusão já começou: a requisição não é mais cancelável.' };
  return { pode: false, motivo: 'Passagem de situação não permitida para a requisição.' };
}

/** Situação depois de um ato concluído ou interrompido: atendida quando todas as bolsas pedidas foram transfundidas. */
export function estadoDepoisDoAto(
  quantidadeBolsas: number,
  bolsasTransfundidas: number,
): EstadoRequisicaoTransfusao {
  return bolsasTransfundidas >= quantidadeBolsas ? 'atendida' : 'emAtendimento';
}
