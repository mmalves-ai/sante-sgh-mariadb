// Fila priorizada do NIR (M44, etapa 2; ficha, regra 9; mina M41, regra 13): o prazo de cada solicitação pela
// prioridade (parâmetro do estabelecimento), o estouro do prazo sem leito (alerta ao NIR) e a ordem da fila: a
// prioridade primeiro, depois o prazo estourado, depois a espera (a mais antiga primeiro). Regras puras.
import { PRIORIDADES_NIR, type PrioridadeNir } from '@sgh/contratos';

const ms = (iso: string) => Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
const isoSemFuso = (t: number) => new Date(t).toISOString().slice(0, 19);

export type PrazosNir = Readonly<Record<PrioridadeNir, number>>;

/** Os prazos padrão (minutos) quando o estabelecimento não definiu os seus. */
export const PRAZOS_PADRAO_NIR: PrazosNir = Object.fromEntries(
  PRIORIDADES_NIR.map((p) => [p.codigo, p.prazoPadraoMin]),
) as Record<PrioridadeNir, number>;

export function ordemDaPrioridade(p: PrioridadeNir): number {
  return PRIORIDADES_NIR.find((x) => x.codigo === p)?.ordem ?? 99;
}

/** O prazo da solicitação (hora local sem fuso, como o banco grava): a hora do pedido mais o prazo da prioridade. */
export function prazoDaSolicitacao(
  solicitadoEm: string,
  prioridade: PrioridadeNir,
  prazos: PrazosNir,
): string {
  return isoSemFuso(ms(solicitadoEm) + (prazos[prioridade] ?? PRAZOS_PADRAO_NIR[prioridade]) * 60_000);
}

/** Minutos desde o pedido (nunca negativo). */
export function minutosDeEspera(solicitadoEm: string, agora: string): number {
  return Math.max(0, Math.floor((ms(agora) - ms(solicitadoEm)) / 60_000));
}

/** Passou do prazo sem leito? Só nos estados em que a solicitação ainda espera (sem reserva). */
export function prazoEstourado(s: { estado: string; prazoEm: string }, agora: string): boolean {
  return (s.estado === 'solicitado' || s.estado === 'em_analise') && ms(agora) > ms(s.prazoEm);
}

export interface ItemFilaNir {
  readonly id: number;
  readonly prioridade: PrioridadeNir;
  readonly estado: string;
  readonly solicitadoEm: string;
  readonly prazoEm: string;
}

/** A ordem da fila: prioridade, estouro do prazo, espera (mais antiga primeiro) e, por fim, o número. */
export function ordenarFilaNir<T extends ItemFilaNir>(itens: readonly T[], agora: string): T[] {
  return [...itens].sort((a, b) => {
    const p = ordemDaPrioridade(a.prioridade) - ordemDaPrioridade(b.prioridade);
    if (p !== 0) return p;
    const ea = prazoEstourado(a, agora) ? 0 : 1;
    const eb = prazoEstourado(b, agora) ? 0 : 1;
    if (ea !== eb) return ea - eb;
    const t = ms(a.solicitadoEm) - ms(b.solicitadoEm);
    return t !== 0 ? t : a.id - b.id;
  });
}

/** Contagem por estado (as abertas da fila). */
export function contagemPorEstado(itens: readonly { estado: string }[]): Record<string, number> {
  const r: Record<string, number> = {};
  for (const i of itens) r[i.estado] = (r[i.estado] ?? 0) + 1;
  return r;
}
