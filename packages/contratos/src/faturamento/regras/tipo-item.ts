// Grupo do item da conta (ficha do M30, regra 6; ref 01 §2.3; Anexo A): o tipo do item é o único separador confiável da
// natureza do item: 1 diárias e taxas, 2 honorários, 3 SADT, 4 mat/med. A meta do teste de reprodução que libera o
// lançamento manual de cada grupo (cap-06b §6.5, Decisão; cap-11 §11.3): 99% em SADT e em diárias e taxas, 98% em
// mat/med, 97% em honorários.

export const TIPOS_ITEM = [1, 2, 3, 4] as const;
export type TipoItem = (typeof TIPOS_ITEM)[number];

export type GrupoItem = 'diarias-taxas' | 'honorarios' | 'sadt' | 'matmed';

export const GRUPO_DO_TIPO: Readonly<Record<TipoItem, GrupoItem>> = {
  1: 'diarias-taxas',
  2: 'honorarios',
  3: 'sadt',
  4: 'matmed',
};

export const ROTULO_GRUPO: Readonly<Record<GrupoItem, string>> = {
  'diarias-taxas': 'Diárias e taxas',
  honorarios: 'Honorários',
  sadt: 'Exames e terapias (SADT)',
  matmed: 'Materiais e medicamentos',
};

/** Meta de acerto (fração) do teste de reprodução para liberar o lançamento manual do grupo. */
export const META_REPRODUCAO: Readonly<Record<GrupoItem, number>> = {
  'diarias-taxas': 0.99,
  honorarios: 0.97,
  sadt: 0.99,
  matmed: 0.98,
};

export function ehTipoItem(n: unknown): n is TipoItem {
  return typeof n === 'number' && (TIPOS_ITEM as readonly number[]).includes(n);
}

/** Regra 6: o grupo pelo TIPO (nunca pelo código do procedimento nem pela origem). Tipo fora de 1..4: null. */
export function grupoDoItem(tipo: number | null | undefined): GrupoItem | null {
  return ehTipoItem(tipo) ? GRUPO_DO_TIPO[tipo] : null;
}

/** O grupo atinge a meta? (acerto = itens que conferem ÷ itens explicados; sem itens, não atinge.) */
export function grupoAtingeMeta(grupo: GrupoItem, conferem: number, total: number): boolean {
  if (total <= 0) return false;
  return conferem / total >= META_REPRODUCAO[grupo];
}

/** Origem do item (Anexo A): só valores já vistos; B, P e D com a legenda "a confirmar" (DP-46.5). */
export const ORIGEM_ITEM: Readonly<Record<string, { rotulo: string; aConfirmar: boolean }>> = {
  E: { rotulo: 'Saída do estoque', aConfirmar: false },
  S: { rotulo: 'Exames e terapias', aConfirmar: false },
  X: { rotulo: 'Recepção', aConfirmar: false },
  C: { rotulo: 'Lançamento manual na conta', aConfirmar: false },
  I: { rotulo: 'Internação (diárias e visitas)', aConfirmar: false },
  B: { rotulo: 'Materiais e medicamentos (a confirmar)', aConfirmar: true },
  P: { rotulo: 'Materiais e medicamentos (a confirmar)', aConfirmar: true },
  D: { rotulo: 'Diária (a confirmar)', aConfirmar: true },
};

export function origemDoItem(veio: string | null | undefined): { rotulo: string; aConfirmar: boolean } {
  const k = (veio ?? '').trim().toUpperCase();
  return ORIGEM_ITEM[k] ?? { rotulo: k ? `Origem ${k} (a confirmar)` : 'Sem origem', aConfirmar: true };
}
