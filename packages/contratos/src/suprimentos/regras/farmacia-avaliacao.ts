// Avaliação farmacêutica da prescrição (ficha do M29, regras 7 e 8; cap-11 §11.2; DP-25): regras automáticas aprovam o
// baixo risco (o equivalente ao 5 "válido automaticamente" de hoje); a fila humana começa pelo alto risco e pelo
// antimicrobiano (recomendação da DP-25), com a prioridade pelos achados (alergia, duplicidade, via e dose do cadastro;
// a base de interações é a DP-24). A decisão e a intervenção ficam em SGH_; gravar 2, 3 ou 4 no outro sistema exige a
// decisão registrada (nunca vistos: regra 8).
import { recusa, type RecusaSuprimentos } from './recusa.js';
import type { ClasseMedicamento } from './farmacia-fila.js';

export type DecisaoAvaliacao = 'valido' | 'nao-aprovado' | 'pendencia-revisao-medica';

/** A situação que o outro sistema tem para cada decisão (2, 3, 4: nunca gravadas até a DP-25). */
export const SITUACAO_DA_DECISAO: Readonly<Record<DecisaoAvaliacao, number>> = {
  valido: 2,
  'nao-aprovado': 3,
  'pendencia-revisao-medica': 4,
};

export type AchadoAvaliacao =
  'alergia' | 'duplicidade' | 'via-incompativel' | 'dose-acima' | 'dose-abaixo' | 'sem-dose-cadastro';

export interface ItemParaAvaliar {
  readonly classe: ClasseMedicamento;
  /** O paciente tem alergia registrada ao princípio ou ao grupo do item. */
  readonly alergiaConflitante: boolean;
  /** O mesmo princípio em outro item vigente da prescrição. */
  readonly duplicado: boolean;
  /** A via prescrita não está entre as vias do cadastro do item (vazio: sem conferência). */
  readonly via: string | null;
  readonly viasDoCadastro: readonly string[];
  /** A dose prescrita e a faixa do cadastro (nula: o cadastro não tem a faixa). */
  readonly dose: number | null;
  readonly doseMinima: number | null;
  readonly doseMaxima: number | null;
  readonly urgente: boolean;
  /**
   * O cadastro do item manda à lista de avaliação (o tipo de envio do item: 2 "Sim"; 3 "Somente urgência" com o item
   * urgente), como o outro sistema parametriza; ausente: não.
   */
  readonly enviarParaAvaliacao?: boolean;
}

/** Classes que vão à fila humana (parâmetro SGH_); padrão: alto risco e antimicrobiano (DP-25). */
export const CLASSES_FILA_HUMANA_PADRAO: readonly ClasseMedicamento[] = ['alto-risco', 'antimicrobiano'];

/** Os achados das regras automáticas (alergia, duplicidade, via e dose do cadastro). */
export function achadosDoItem(i: ItemParaAvaliar): AchadoAvaliacao[] {
  const a: AchadoAvaliacao[] = [];
  if (i.alergiaConflitante) a.push('alergia');
  if (i.duplicado) a.push('duplicidade');
  if (i.via && i.viasDoCadastro.length > 0 && !i.viasDoCadastro.includes(i.via)) a.push('via-incompativel');
  if (i.dose !== null) {
    if (i.doseMaxima !== null && i.dose > i.doseMaxima) a.push('dose-acima');
    else if (i.doseMinima !== null && i.dose < i.doseMinima) a.push('dose-abaixo');
  }
  return a;
}

/** Peso de cada achado na prioridade da fila. */
const PESO: Readonly<Record<AchadoAvaliacao, number>> = {
  alergia: 50,
  'dose-acima': 30,
  duplicidade: 20,
  'via-incompativel': 20,
  'dose-abaixo': 10,
  'sem-dose-cadastro': 0,
};

/**
 * Regra 7: o destino do item (automática ou fila humana) e a prioridade. Qualquer achado manda à fila humana, mesmo
 * fora das classes da fila; sem achado e fora das classes, a regra automática aprova (o 5 de hoje).
 */
export function triarItem(
  i: ItemParaAvaliar,
  classesHumanas: readonly ClasseMedicamento[] = CLASSES_FILA_HUMANA_PADRAO,
): { destino: 'automatica' | 'humana'; prioridade: number; achados: AchadoAvaliacao[]; regra: string } {
  const achados = achadosDoItem(i);
  const humana = achados.length > 0 || classesHumanas.includes(i.classe) || i.enviarParaAvaliacao === true;
  let prioridade = achados.reduce((s, a) => s + PESO[a], 0);
  if (i.classe === 'alto-risco') prioridade += 25;
  if (i.classe === 'antimicrobiano') prioridade += 15;
  if (i.urgente) prioridade += 40;
  const regra = !humana
    ? 'baixo-risco-sem-achado'
    : achados.length > 0
      ? `achado:${achados.join(',')}`
      : classesHumanas.includes(i.classe)
        ? `classe:${i.classe}`
        : 'cadastro:envio-avaliacao';
  return { destino: humana ? 'humana' : 'automatica', prioridade: Math.min(prioridade, 200), achados, regra };
}

/** Ordena a fila humana: prioridade maior primeiro; empate pelo mais antigo. */
export function ordenarFilaAvaliacao<T extends { prioridade: number; desde: string; id: number }>(
  fila: readonly T[],
): T[] {
  return [...fila].sort(
    (a, b) => b.prioridade - a.prioridade || a.desde.localeCompare(b.desde) || a.id - b.id,
  );
}

/** A decisão do farmacêutico: "não aprovado" e "pendência" exigem a justificativa ao médico. */
export function conferirDecisaoAvaliacao(c: {
  decisao: DecisaoAvaliacao;
  justificativa: string;
  estado: 'pendente' | 'decidido' | 'automatico';
}): RecusaSuprimentos | null {
  if (c.estado === 'decidido')
    return recusa('ja-avaliado', 'Este item já foi avaliado por outro farmacêutico.', ['item']);
  if (c.decisao !== 'valido' && c.justificativa.trim().length < 10)
    return recusa('sem-justificativa', 'Escreva a justificativa ao prescritor (ao menos 10 caracteres).', [
      'justificativa',
    ]);
  return null;
}

/**
 * Regra 8: gravar a decisão no outro sistema (2, 3 ou 4 em `PREXTRATOITEM_TBSITFARM`) só com a decisão registrada
 * (DP-25) e a conferência de que o outro sistema mostra e trata essas situações. Sem ela, recusa.
 */
export function conferirGravacaoNoLegado(c: {
  decisao: DecisaoAvaliacao;
  decisaoRegistrada: boolean;
  conferidoNoOutroSistema: boolean;
}): RecusaSuprimentos | null {
  if (!c.decisaoRegistrada || !c.conferidoNoOutroSistema)
    return recusa(
      'valor-nunca-visto',
      `A situação ${SITUACAO_DA_DECISAO[c.decisao]} nunca foi gravada pelo outro sistema: a gravação espera a decisão da farmácia clínica (DP-25) e a conferência no outro sistema.`,
      ['decisao'],
    );
  return null;
}

export type TipoIntervencao =
  'ajuste-dose' | 'troca-via' | 'suspensao' | 'substituicao' | 'alergia' | 'duplicidade' | 'outra';

export const TIPOS_INTERVENCAO: readonly { id: TipoIntervencao; rotulo: string }[] = [
  { id: 'ajuste-dose', rotulo: 'Ajuste de dose' },
  { id: 'troca-via', rotulo: 'Troca de via' },
  { id: 'suspensao', rotulo: 'Suspensão do item' },
  { id: 'substituicao', rotulo: 'Substituição do item' },
  { id: 'alergia', rotulo: 'Alergia do paciente' },
  { id: 'duplicidade', rotulo: 'Duplicidade terapêutica' },
  { id: 'outra', rotulo: 'Outra' },
];

/** A intervenção: o texto ao médico, a resposta (aceita, recusada) só do prescritor do item. */
export function conferirRespostaIntervencao(c: {
  estado: 'aberta' | 'respondida';
  resposta: 'aceita' | 'recusada';
  justificativa: string;
  respondente: string;
  autorIntervencao: string;
}): RecusaSuprimentos | null {
  if (c.estado !== 'aberta')
    return recusa('intervencao-respondida', 'A intervenção já foi respondida.', ['intervencao']);
  if (c.respondente.trim().toUpperCase() === c.autorIntervencao.trim().toUpperCase())
    return recusa('resposta-do-autor', 'Quem fez a intervenção não pode respondê-la.', ['resposta']);
  if (c.resposta === 'recusada' && c.justificativa.trim().length < 10)
    return recusa('sem-justificativa', 'Justifique a recusa da intervenção (ao menos 10 caracteres).', [
      'justificativa',
    ]);
  return null;
}

/** Indicador "intervenções aceitas" (uso racional): aceitas / respondidas, em %. */
export function taxaAceitacao(i: { aceitas: number; recusadas: number }): number | null {
  const total = i.aceitas + i.recusadas;
  return total === 0 ? null : Math.round((i.aceitas / total) * 1000) / 10;
}
