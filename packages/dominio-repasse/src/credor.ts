// Regra 8 do M33: tipo de credor do título que nasce do repasse (MFCONPAG.TIPO com ONDE='R'; ref 01 §2.5). M: médico
// pessoa física, exige o vínculo com o profissional (TBCBOPRO) e recebe RPA. E: empresa médica e cooperativa, recebem
// demonstrativo para emitir nota (título tipo E, sem RPA). Os demais tipos de prestador (fornecedor, prestador PF,
// vendedor, tomador) não têm título de repasse no pc (5.458 títulos: 5.027 M e 431 E) e são recusados até o setor dizer
// como entram.
import type { TipoCredorRepasse, TipoPrestadorRepasse } from '@sgh/contratos';

export type DestinoRepasse =
  | { readonly ok: true; readonly credor: TipoCredorRepasse; readonly documento: 'rpa' | 'demonstrativo' }
  | { readonly ok: false; readonly motivo: string };

export function destinoDoRepasse(
  prestador: TipoPrestadorRepasse | 'cooperativa',
  vinculoProfissional: number | null,
): DestinoRepasse {
  if (prestador === 'M') {
    if (vinculoProfissional === null || vinculoProfissional <= 0)
      return { ok: false, motivo: 'Médico sem vínculo com o cadastro de profissional.' };
    return { ok: true, credor: 'M', documento: 'rpa' };
  }
  if (prestador === 'E' || prestador === 'cooperativa')
    return { ok: true, credor: 'E', documento: 'demonstrativo' };
  return { ok: false, motivo: 'Tipo de prestador sem título de repasse.' };
}

/** Lançamento já em RPA (RPLANRPA) não entra em outro RPA (cenário recusa-ja-em-rpa). */
export function lancamentosLivres(
  pedidos: readonly number[],
  jaEmRpa: ReadonlySet<number>,
): { ok: true } | { ok: false; emRpa: number[] } {
  const em = pedidos.filter((l) => jaEmRpa.has(l));
  return em.length ? { ok: false, emRpa: em } : { ok: true };
}
