// Apoio das telas da fatia F1 da operadora (M56.2): as opções dos combos a partir do vocabulário dos contratos (o
// rótulo de produto, nunca o código cru), a conversão dos campos de texto em número e as datas para a tela.
import type { TelaBeneficiarios } from '@sgh/contratos';

export interface Opcao<V> {
  readonly valor: V;
  readonly rotulo: string;
}

/** Opções de um vocabulário `{código: rótulo}` (códigos numéricos ou de texto). */
export function opcoesDe<K extends string | number>(
  o: Readonly<Record<K, string>>,
  numerico: boolean,
): Opcao<K>[] {
  return Object.entries(o).map(([k, v]) => ({
    valor: (numerico ? Number(k) : k) as K,
    rotulo: String(v),
  }));
}

/** Texto do campo em número (vírgula decimal aceita); vazio ou inválido: null. */
export function numeroDe(v: string): number | null {
  const b = v.trim();
  const t = b.includes(',') ? b.replace(/\./g, '').replace(',', '.') : b;
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** AAAA-MM-DD em DD/MM/AAAA. */
export function dataBr(v: string | null | undefined): string {
  if (!v) return '';
  const [a, m, d] = v.slice(0, 10).split('-');
  return a && m && d ? `${d}/${m}/${a}` : v;
}

/** Hoje (AAAA-MM-DD) no fuso do navegador. */
export function hoje(): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export type Tela = TelaBeneficiarios;
