// O perfil sugerido por cargo no provisionamento pelo RH (W1-01, parte 11a2): do histórico de decisões (a mais nova de
// cada cargo vale), só os cargos com sugestão vigente. Regra pura, sem banco.
import type { PerfilCargoRhLido } from './tipos-gestao-acesso.js';

/** Cargo (chave normalizada) → código do perfil sugerido, pela decisão mais nova de cada cargo. */
export function perfilPorCargoVigente(historico: readonly PerfilCargoRhLido[]): Record<string, string> {
  const visto = new Set<string>();
  const r: Record<string, string> = {};
  for (const x of [...historico].sort((a, b) => Number(b.id) - Number(a.id))) {
    if (visto.has(x.cargo)) continue;
    visto.add(x.cargo);
    if (x.situacao === 'vigente' && x.perfil) r[x.cargo] = x.perfil;
  }
  return r;
}
