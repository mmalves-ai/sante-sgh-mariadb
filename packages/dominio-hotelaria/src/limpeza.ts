// Higienização (M21; ficha, seção 5 e regra 9): os estados no novo — Solicitado → Atribuído → Em execução (pausas) →
// Concluído → Inspecionado → Liberado, com a reprovação na inspeção que volta à execução e o cancelamento —, quem,
// quando e de qual aparelho (cada mudança é uma linha), o cronômetro sem as pausas, o prazo por tipo de limpeza ×
// criticidade da área (SGH_CFG_PARAMETRO) e a precaução de contato que exige a limpeza terminal com o protocolo da
// CCIH antes da liberação. A situação de origem (1 Alta hospitalar, 2 Aguardando higienização, 3 Em
// higienização, 4 Liberado) acompanha só nos valores gravados (1 e 2): 3 e 4 ficam no novo até a decisão registrada.
import type { EtapaLimpeza, Precaucao } from '@sgh/contratos';

/** As transições permitidas (regra 9). */
export const TRANSICOES_LIMPEZA: Readonly<Record<EtapaLimpeza, readonly EtapaLimpeza[]>> = {
  solicitado: ['atribuido', 'emExecucao', 'cancelado'],
  atribuido: ['atribuido', 'emExecucao', 'cancelado'],
  emExecucao: ['pausado', 'concluido'],
  pausado: ['emExecucao', 'cancelado'],
  concluido: ['inspecionado', 'reprovado'],
  reprovado: ['emExecucao', 'atribuido'],
  inspecionado: ['liberado'],
  liberado: [],
  cancelado: [],
};

/** A etapa pedida vale a partir da atual? */
export function podeTransitar(de: EtapaLimpeza, para: EtapaLimpeza): boolean {
  return TRANSICOES_LIMPEZA[de].includes(para);
}

export const ETAPAS_ABERTAS: readonly EtapaLimpeza[] = [
  'solicitado',
  'atribuido',
  'emExecucao',
  'pausado',
  'concluido',
  'reprovado',
  'inspecionado',
];

export function limpezaAberta(etapa: EtapaLimpeza): boolean {
  return ETAPAS_ABERTAS.includes(etapa);
}

/** Tipo de limpeza terminal do cadastro (o da alta). */
export const TIPO_TERMINAL = 4;

/** O item do checklist que registra o protocolo da CCIH (exigido na precaução, antes da liberação). */
export const ITEM_PROTOCOLO_CCIH = 'protocoloCcih';

/** O checklist mínimo da limpeza (o do cadastro de checklist completa por tipo). */
export const CHECKLIST_PADRAO = ['superficies', 'piso', 'banheiro', 'enxoval', 'residuos'] as const;

export interface PedidoEtapa {
  readonly atual: EtapaLimpeza;
  readonly pedida: EtapaLimpeza;
  readonly tipoLimpeza: number | null;
  readonly precaucao: Precaucao | null;
  readonly checklist: readonly string[];
  readonly profissional: number | null;
}

/**
 * A etapa pode ser registrada? O motivo, quando não. A conclusão exige o checklist mínimo; na precaução, a limpeza é a
 * terminal e o checklist tem o protocolo da CCIH; a atribuição e o início exigem o profissional.
 */
export function conferirEtapa(p: PedidoEtapa): string | null {
  if (!podeTransitar(p.atual, p.pedida)) return `A limpeza está "${p.atual}": não passa para "${p.pedida}".`;
  if ((p.pedida === 'atribuido' || p.pedida === 'emExecucao') && p.profissional === null)
    return 'Informe o profissional da limpeza.';
  if (p.pedida === 'concluido') {
    const faltam = CHECKLIST_PADRAO.filter((i) => !p.checklist.includes(i));
    if (faltam.length > 0) return `Complete o checklist: ${faltam.join(', ')}.`;
    if (p.precaucao && p.tipoLimpeza !== TIPO_TERMINAL)
      return 'Leito em precaução: a limpeza é a terminal, com o protocolo da CCIH.';
    if (p.precaucao && !p.checklist.includes(ITEM_PROTOCOLO_CCIH))
      return 'Leito em precaução: marque o protocolo da CCIH no checklist.';
  }
  return null;
}

/** A situação do legado que acompanha a etapa (só os valores gravados: 1 e 2); null = o legado fica como está. */
export function situacaoLegadoDaEtapa(e: EtapaLimpeza): 2 | null {
  return e === 'atribuido' || e === 'emExecucao' ? 2 : null;
}

export interface MarcaEtapa {
  readonly etapa: EtapaLimpeza;
  /** Instante (ms). */
  readonly em: number;
}

/** Minutos em execução: a soma dos intervalos em execução (as pausas não contam), até agora se ainda em execução. */
export function minutosEmExecucao(marcas: readonly MarcaEtapa[], agora: number): number {
  let total = 0;
  let inicio: number | null = null;
  for (const m of [...marcas].sort((a, b) => a.em - b.em)) {
    if (m.etapa === 'emExecucao') inicio ??= m.em;
    else if (inicio !== null) {
      total += m.em - inicio;
      inicio = null;
    }
  }
  if (inicio !== null) total += agora - inicio;
  return Math.max(0, Math.round(total / 60_000));
}

export interface ParametrosPrazo {
  readonly terminalMinutos: number;
  readonly concorrenteMinutos: number;
  /** Porcentagem do prazo nas áreas críticas (criticidade 1 do cadastro). */
  readonly fatorCritica: number;
}

/** Criticidade "Crítica" do cadastro de criticidades da área. */
export const CRITICIDADE_CRITICA = 1;

/** O prazo (SLA) da solicitação em minutos: pelo tipo (terminal ou concorrente) e o fator da área crítica. */
export function prazoMinutos(
  tipoLimpeza: number | null,
  criticidade: number | null,
  p: ParametrosPrazo,
): number {
  const base = tipoLimpeza === TIPO_TERMINAL ? p.terminalMinutos : p.concorrenteMinutos;
  const fator = criticidade === CRITICIDADE_CRITICA ? p.fatorCritica : 100;
  return Math.max(1, Math.round((base * fator) / 100));
}

/** A solicitação passou do prazo sem ser liberada? */
export function atrasada(prazo: number | null, etapa: EtapaLimpeza, agora: number): boolean {
  return prazo !== null && limpezaAberta(etapa) && agora > prazo;
}

/**
 * A fila do profissional: as abertas não liberadas, as atrasadas primeiro, depois pelo prazo (as sem prazo no fim) e
 * pela solicitação mais antiga.
 */
export function ordenarFila<T extends { etapa: EtapaLimpeza; prazo: number | null; solicitadaEm: number }>(
  itens: readonly T[],
  agora: number,
): T[] {
  return itens
    .filter((i) => limpezaAberta(i.etapa))
    .sort((a, b) => {
      const aa = atrasada(a.prazo, a.etapa, agora) ? 0 : 1;
      const bb = atrasada(b.prazo, b.etapa, agora) ? 0 : 1;
      if (aa !== bb) return aa - bb;
      const pa = a.prazo ?? Number.MAX_SAFE_INTEGER;
      const pb = b.prazo ?? Number.MAX_SAFE_INTEGER;
      return pa - pb || a.solicitadaEm - b.solicitadaEm;
    });
}
