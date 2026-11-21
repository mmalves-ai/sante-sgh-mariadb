// Fila do consultório (ficha do M20, seção 4): os atendimentos do dia do local do profissional — agendados e
// espontâneos — na ordem de chamada: quem está em atendimento no topo, depois os chamados, depois os que aguardam
// por prioridade legal e pela hora (a marcada, para o agendado que já chegou, ou a chegada); os liberados no fim.
// A situação vem das letras do fluxo da senha no local (C chamar, A atender, L liberar, X cancelar a
// chamada, N não localizado), como o outro sistema grava; sem senha, da extensão do novo.

export type SituacaoFila = 'aguardando' | 'chamado' | 'emAtendimento' | 'liberado';

/** A situação no local pela última letra do fluxo naquele local. */
export function situacaoPelaLetra(letra: string | null | undefined): SituacaoFila {
  switch ((letra ?? '').trim().toUpperCase()) {
    case 'C':
      return 'chamado';
    case 'A':
      return 'emAtendimento';
    case 'L':
      return 'liberado';
    default:
      return 'aguardando';
  }
}

export interface ItemParaFila {
  readonly reg: number;
  readonly situacao: SituacaoFila;
  readonly prioridade: '0' | '1' | '2';
  readonly chegada: string;
  readonly agendadoPara: string | null;
}

const PESO: Record<SituacaoFila, number> = { emAtendimento: 0, chamado: 1, aguardando: 2, liberado: 3 };

export function ordenarFilaConsultorio<T extends ItemParaFila>(itens: readonly T[]): T[] {
  const hora = (i: ItemParaFila) => i.agendadoPara ?? i.chegada;
  return [...itens].sort(
    (a, b) =>
      PESO[a.situacao] - PESO[b.situacao] ||
      (a.situacao === 'aguardando' ? a.prioridade.localeCompare(b.prioridade) : 0) ||
      hora(a).localeCompare(hora(b)) ||
      a.reg - b.reg,
  );
}

export function esperaMinutos(chegada: string, agora: string): number {
  const z = (s: string) => Date.parse(s.endsWith('Z') ? s : `${s}Z`);
  const d = (z(agora) - z(chegada)) / 60_000;
  return Number.isFinite(d) ? Math.max(0, Math.floor(d)) : 0;
}

/** Pode chamar ao consultório: quem aguarda ou foi chamado (chamar de novo); não quem está em atendimento ou saiu. */
export function podeChamar(s: SituacaoFila): boolean {
  return s === 'aguardando' || s === 'chamado';
}
