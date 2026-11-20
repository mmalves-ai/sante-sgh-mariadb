// Renovação (regra 14 da ficha do M24; cap-11 §11.2, "Renovação"): aviso de prescrição pendente para o período
// seguinte (paridade com o aviso de planejamento pendente do legado) e a lista das que vencem no turno, para a
// worklist do M27. Renovar abre a prescrição do período seguinte a partir da vigente, item a item confirmado.
import { minLocal } from './tempo.js';
import type { Periodo } from './vigencia.js';

export interface PrescricaoDoAtendimento {
  readonly id: number;
  readonly atendimento: number;
  readonly vigencia: Periodo;
  readonly suspensa: boolean;
}

/** Horas antes do fim do período em que o aviso aparece (padrão de mercado; o turno da tarde, 6 h). */
export const ANTECEDENCIA_AVISO_HORAS = 6;

/** A vigente do atendimento vence em até N horas e não há prescrição para o período seguinte? */
export function renovacaoPendente(
  prescricoes: readonly PrescricaoDoAtendimento[],
  agora: string,
  antecedenciaHoras = ANTECEDENCIA_AVISO_HORAS,
): PrescricaoDoAtendimento | null {
  const a = minLocal(agora);
  const ativas = prescricoes.filter((p) => !p.suspensa);
  const vigente = ativas.find((p) => minLocal(p.vigencia.inicio) <= a && a <= minLocal(p.vigencia.fim));
  if (!vigente) return null;
  const fim = minLocal(vigente.vigencia.fim);
  if (fim - a > antecedenciaHoras * 60) return null;
  const temSeguinte = ativas.some((p) => minLocal(p.vigencia.inicio) > fim);
  return temSeguinte ? null : vigente;
}

/** As que vencem entre agora e o fim do turno (sem prescrição seguinte), por atendimento. */
export function vencemNoTurno(
  prescricoes: readonly PrescricaoDoAtendimento[],
  agora: string,
  fimDoTurno: string,
): PrescricaoDoAtendimento[] {
  const a = minLocal(agora);
  const t = minLocal(fimDoTurno);
  const porAtendimento = new Map<number, PrescricaoDoAtendimento[]>();
  for (const p of prescricoes.filter((x) => !x.suspensa))
    porAtendimento.set(p.atendimento, [...(porAtendimento.get(p.atendimento) ?? []), p]);
  const r: PrescricaoDoAtendimento[] = [];
  for (const lista of porAtendimento.values()) {
    for (const p of lista) {
      const fim = minLocal(p.vigencia.fim);
      if (fim < a || fim > t) continue;
      if (lista.some((q) => minLocal(q.vigencia.inicio) > fim)) continue;
      r.push(p);
    }
  }
  return r.sort((x, y) => x.vigencia.fim.localeCompare(y.vigencia.fim));
}
