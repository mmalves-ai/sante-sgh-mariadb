// Duas réguas de data (ficha do M30, regra 11; cap-06b §6.5): a competência da conta (ANOPRO*100+MESPRO) e a data do
// item. Toda tela declara a régua e usa a competência como padrão.

export type ReguaData = 'competencia' | 'data-item';
export const REGUA_PADRAO: ReguaData = 'competencia';

export const ROTULO_REGUA: Readonly<Record<ReguaData, string>> = {
  competencia: 'Competência da conta',
  'data-item': 'Data do item',
};

/** A competência AAAAMM (ANOPRO*100+MESPRO). */
export function competencia(ano: number, mes: number): number {
  if (!Number.isInteger(ano) || !Number.isInteger(mes) || mes < 1 || mes > 12)
    throw new RangeError('competência inválida');
  return ano * 100 + mes;
}

/** "2026-10" → { ano, mes } (null se inválida). */
export function lerCompetencia(t: string | null | undefined): { ano: number; mes: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec((t ?? '').trim());
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  return mes >= 1 && mes <= 12 ? { ano, mes } : null;
}

export function textoCompetencia(ano: number, mes: number): string {
  return `${String(mes).padStart(2, '0')}/${ano}`;
}

/** O item pertence ao filtro na régua escolhida? */
export function noFiltro(
  regua: ReguaData,
  conta: { readonly ano: number; readonly mes: number },
  item: { readonly data: string },
  filtro: { readonly ano: number; readonly mes: number },
): boolean {
  if (regua === 'competencia')
    return competencia(conta.ano, conta.mes) === competencia(filtro.ano, filtro.mes);
  return item.data.slice(0, 7) === `${filtro.ano}-${String(filtro.mes).padStart(2, '0')}`;
}

/** Idade da conta desde a alta (dias), para a lista e a fila de trabalho. */
export function diasDesde(data: string | null, hoje: string): number | null {
  if (!data || data.slice(0, 10) < '1900-01-01') return null;
  const a = Date.parse(`${data.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${hoje.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / 86_400_000)) : null;
}
