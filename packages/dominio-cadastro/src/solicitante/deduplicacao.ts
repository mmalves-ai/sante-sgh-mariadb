// Solicitante externo (ficha do M11, regra 12; cap-06a §6.1): deduplicação por conselho + UF + número;
// conselho, número, UF e CBO obrigatórios quando o cadastro for construído (a guia TISS exige). Nesta fase o
// cadastro é consulta: a tela marca os duplicados e os incompletos.
import { normalizarChave } from '@sgh/contratos';

export interface SolicitanteComparavel {
  readonly id: number;
  readonly conselho: string | null;
  readonly uf: string | null;
  readonly numero: number | null;
  readonly cbo: string | null;
}

/** Chave de deduplicação, ou null se faltar conselho, UF ou número. */
export function chaveSolicitante(
  s: Pick<SolicitanteComparavel, 'conselho' | 'uf' | 'numero'>,
): string | null {
  const conselho = normalizarChave(s.conselho).replace(/ /g, '');
  const uf = normalizarChave(s.uf).replace(/ /g, '');
  if (!conselho || !/^[A-Z]{2}$/.test(uf) || s.numero === null || !(s.numero > 0)) return null;
  return `${conselho}|${uf}|${s.numero}`;
}

/** IDs que dividem a chave com outro solicitante. */
export function duplicados(lista: readonly SolicitanteComparavel[]): Set<number> {
  const porChave = new Map<string, number[]>();
  for (const s of lista) {
    const k = chaveSolicitante(s);
    if (!k) continue;
    porChave.set(k, [...(porChave.get(k) ?? []), s.id]);
  }
  const r = new Set<number>();
  for (const ids of porChave.values()) if (ids.length > 1) ids.forEach((i) => r.add(i));
  return r;
}

/** Faltam os campos que a guia TISS exige (conselho, número, UF e CBO). */
export function incompleto(s: SolicitanteComparavel): boolean {
  return chaveSolicitante(s) === null || !s.cbo || String(s.cbo).replace(/\D+/g, '').length < 4;
}
