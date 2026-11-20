// Ordem da fila do guichê (M19; ficha, regra 3, e cap-05a §5.2): a fila normal não pode parar. Três ordens
// configuráveis por gerador no novo (SGH_REC_FILA_CFG): prioritárias primeiro (0 antes de 1, depois as normais), a
// intercalada (N prioritárias para cada normal, contando as chamadas já feitas) e só pela chegada. Empate: a emissão
// e o número da senha (a ordem do legado, que chama pelo número dentro da prioridade).
import type { OrdemFila } from './vocabulario.js';

/** É prioritária (0 ou 1)? */
export function prioritaria(p: string): boolean {
  return p.trim() === '0' || p.trim() === '1';
}

export interface SenhaNaFila {
  readonly id: number;
  readonly numero: number;
  readonly prioridade: string;
  /** Emissão em ISO (relógio do banco). */
  readonly emitidaEm: string;
}

export interface ConfigFila {
  readonly ordem: OrdemFila;
  /** Na intercalada: prioritárias por normal (1 a 9). */
  readonly intercalar: number;
}

export const CONFIG_FILA_PADRAO: ConfigFila = { ordem: 'prioridade', intercalar: 2 };

const porChegada = (a: SenhaNaFila, b: SenhaNaFila) =>
  a.emitidaEm.localeCompare(b.emitidaEm) || a.numero - b.numero || a.id - b.id;
const peso = (p: string) => (p.trim() === '0' ? 0 : p.trim() === '1' ? 1 : 2);

/**
 * A fila na ordem em que será chamada. `prioritariasSeguidas`: quantas prioritárias o guichê chamou desde a última
 * normal (para a intercalada continuar de onde parou).
 */
export function ordenarFila<T extends SenhaNaFila>(
  senhas: readonly T[],
  cfg: ConfigFila = CONFIG_FILA_PADRAO,
  prioritariasSeguidas = 0,
): T[] {
  if (cfg.ordem === 'chegada') return [...senhas].sort(porChegada);
  const prio = senhas
    .filter((s) => prioritaria(s.prioridade))
    .sort((a, b) => peso(a.prioridade) - peso(b.prioridade) || porChegada(a, b));
  const normais = senhas.filter((s) => !prioritaria(s.prioridade)).sort(porChegada);
  if (cfg.ordem === 'prioridade') return [...prio, ...normais];
  const n = Math.min(9, Math.max(1, Math.trunc(cfg.intercalar)));
  const r: T[] = [];
  let seguidas = Math.max(0, prioritariasSeguidas);
  let i = 0;
  let j = 0;
  while (i < prio.length || j < normais.length) {
    const vezDaNormal = seguidas >= n || i >= prio.length;
    if (vezDaNormal && j < normais.length) {
      r.push(normais[j++] as T);
      seguidas = 0;
    } else if (i < prio.length) {
      r.push(prio[i++] as T);
      seguidas++;
    } else {
      r.push(normais[j++] as T);
    }
  }
  return r;
}

/** Prioritárias chamadas em seguida desde a última normal (as chamadas mais recentes primeiro). */
export function prioritariasSeguidas(chamadasRecentes: readonly { readonly prioridade: string }[]): number {
  let n = 0;
  for (const c of chamadasRecentes) {
    if (!prioritaria(c.prioridade)) break;
    n++;
  }
  return n;
}
