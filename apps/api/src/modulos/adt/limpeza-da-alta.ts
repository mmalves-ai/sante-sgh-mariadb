// Regra da limpeza pedida pela alta (M21, regra 9), pura e testada (limpeza-da-alta.spec.ts): a saída do paciente pede
// a limpeza terminal do leito; a precaução aberta no leito, ou o isolamento ativo da internação, passa ao período de
// higienização e sobe a prioridade, para que a limpeza siga o protocolo da CCIH antes da liberação.
// Pedido ao orquestrador (lote 03-01): mover esta regra para @sgh/dominio-hotelaria (fora da lista do lote).
import { CODIGOS_PRECAUCAO, type Precaucao } from '@sgh/contratos';

export interface SituacaoNaAlta {
  /** A precaução do período de situação aberto no leito, quando houver. */
  readonly precaucaoAberta: string | null;
  /** O isolamento ativo da internação (código do tipo de precaução), quando houver. */
  readonly isolamento: { readonly codigo: string } | null;
}

export interface LimpezaDaAlta {
  readonly tipo: 'terminal';
  readonly motivoGeracao: 'alta';
  readonly prioridade: 'normal' | 'alta';
  readonly precaucao: Precaucao | null;
}

const ehPrecaucao = (c: string | null | undefined): c is Precaucao =>
  typeof c === 'string' && (CODIGOS_PRECAUCAO as readonly string[]).includes(c);

/** A limpeza que a alta pede: sempre terminal; a precaução herdada (a do leito antes da do isolamento) sobe a prioridade. */
export function limpezaDaAlta(s: SituacaoNaAlta): LimpezaDaAlta {
  const precaucao: Precaucao | null = ehPrecaucao(s.precaucaoAberta)
    ? s.precaucaoAberta
    : s.isolamento
      ? ehPrecaucao(s.isolamento.codigo)
        ? s.isolamento.codigo
        : 'contato'
      : null;
  return { tipo: 'terminal', motivoGeracao: 'alta', prioridade: precaucao ? 'alta' : 'normal', precaucao };
}
