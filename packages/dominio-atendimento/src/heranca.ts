// Herança do atendimento anterior: as marcas dizem o que a nova ficha copia do atendimento anterior do paciente
// (fonte pagadora, profissional, carteira, plano, clínica, empresa, validade da carteira…). A pessoa confere antes de
// gravar. Melhoria: a regra tem escopo (todo o cliente, o estabelecimento, um usuário); a mais específica vence,
// campo a campo, e quem nunca configurou nada recebe o padrão que poupa redigitar a cobertura.
import { type CampoHerdado, HERANCAS } from '@sgh/contratos';

/** As marcas por chave da regra (`HERANCAS[].chave`): true herda, false não herda. */
export type MarcasHeranca = Readonly<Record<string, boolean | null | undefined>>;

/** Sem nenhuma regra gravada: a cobertura e o profissional do atendimento anterior. */
export const HERANCA_PADRAO: ReadonlySet<string> = new Set([
  'fonte_pagadora',
  'plano',
  'carteira',
  'validade_carteira',
  'profissional',
]);

/** Uma linha de regra lida do banco: escopo (nulo = todos) e a marca. */
export interface RegraHeranca {
  readonly campo: string;
  readonly herda: boolean;
  readonly estabelecimento: number | null;
  readonly usuario: number | null;
}

/**
 * As marcas em vigor para o usuário no estabelecimento: para cada campo, a regra mais específica (do usuário vence a
 * do estabelecimento, que vence a de todo o cliente); campo sem regra fica com o padrão. Regras de outro
 * estabelecimento ou de outro usuário são ignoradas.
 */
export function resolverHeranca(
  regras: readonly RegraHeranca[],
  contexto: { readonly estabelecimento: number | null; readonly usuario: number | null },
): Record<string, boolean> {
  const peso = new Map<string, number>();
  const r: Record<string, boolean> = {};
  for (const h of HERANCAS) r[h.chave] = HERANCA_PADRAO.has(h.chave);
  for (const g of regras) {
    if (!(g.campo in r)) continue;
    if (g.estabelecimento !== null && g.estabelecimento !== contexto.estabelecimento) continue;
    if (g.usuario !== null && g.usuario !== contexto.usuario) continue;
    const p = (g.usuario !== null ? 2 : 0) + (g.estabelecimento !== null ? 1 : 0);
    if ((peso.get(g.campo) ?? -1) >= p) continue;
    peso.set(g.campo, p);
    r[g.campo] = g.herda;
  }
  return r;
}

/** Controle otimista da alteração: as chaves herdadas, em ordem; "nenhum" quando nada é herdado. */
export function versaoHeranca(marcas: MarcasHeranca): string {
  const h = HERANCAS.filter((x) => marcas[x.chave] === true).map((x) => x.chave);
  return h.length ? h.join(',') : 'nenhum';
}

/** Os campos que a configuração manda herdar. */
export function camposHerdados(marcas: MarcasHeranca): CampoHerdado[] {
  return HERANCAS.filter((h) => marcas[h.chave] === true).map((h) => h.campo);
}

/** Os valores a pré-preencher: só os campos herdados com valor no atendimento anterior. */
export function aplicarHeranca(
  marcas: MarcasHeranca,
  anterior: Readonly<Partial<Record<CampoHerdado, string | number | null>>> | null,
): Partial<Record<CampoHerdado, string | number>> {
  if (!anterior) return {};
  const r: Partial<Record<CampoHerdado, string | number>> = {};
  for (const c of camposHerdados(marcas)) {
    const v = anterior[c];
    if (v !== null && v !== undefined && v !== '' && v !== 0) r[c] = v;
  }
  return r;
}
