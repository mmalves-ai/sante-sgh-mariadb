// Regra 5 do M33: o beneficiário é o executante do item (equipe da nota de sala, laudo, consulta), porque o
// responsável da conta (CRM_RESP) está vazio em 100% das contas do pc (213.641, todas NULL; medido no preparo). O
// solicitante (CRM_REQ, preenchido em 29%) não é beneficiário. Item sem executante vira pendência.
import type { PendenciaApuracao } from '@sgh/contratos';

export type OrigemExecutante = 'lancamento' | 'equipe' | 'laudo' | 'consulta';

/** Ordem de precedência das fontes do executante: o lançamento do item primeiro. */
export const ORDEM_EXECUTANTE: readonly OrigemExecutante[] = ['lancamento', 'equipe', 'laudo', 'consulta'];

export interface FontesExecutante {
  readonly lancamento?: number | null;
  readonly equipe?: number | null;
  readonly laudo?: number | null;
  readonly consulta?: number | null;
}

export type ResultadoBeneficiario =
  | { readonly ok: true; readonly profissional: number; readonly origem: OrigemExecutante }
  | { readonly ok: false; readonly pendencia: PendenciaApuracao };

export function beneficiarioDoItem(f: FontesExecutante): ResultadoBeneficiario {
  for (const o of ORDEM_EXECUTANTE) {
    const p = f[o];
    if (typeof p === 'number' && p > 0) return { ok: true, profissional: p, origem: o };
  }
  return { ok: false, pendencia: 'sem-executante' };
}
