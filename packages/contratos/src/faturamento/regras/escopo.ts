// Escopo por convênio (ficha do M30, regra 13; cap-06b §6.5, Perfis; cap-08 §8.4): o faturista só vê e opera contas
// dos convênios do seu escopo (os vínculos usuário × convênio, lidos pelo M06). Lista vazia = sem
// restrição, como o outro sistema trata a ausência de vínculo (POL-1).
import { recusaFat, type RecusaFaturamento } from './recusa.js';

export function convenioNoEscopo(escopo: readonly string[], convenio: number | null | undefined): boolean {
  if (escopo.length === 0) return true;
  return convenio !== null && convenio !== undefined && escopo.includes(String(convenio));
}

export function conferirEscopoConvenio(
  escopo: readonly string[],
  convenio: number | null | undefined,
): RecusaFaturamento | null {
  return convenioNoEscopo(escopo, convenio)
    ? null
    : recusaFat('fora-do-escopo', 'Esta conta é de um convênio fora do seu escopo de faturamento.');
}

/** Os convênios a filtrar na lista (null: sem filtro; o pedido fora do escopo fica vazio). */
export function filtroConvenios(escopo: readonly string[], pedido: number | null): readonly number[] | null {
  if (escopo.length === 0) return pedido ? [pedido] : null;
  const permitidos = escopo.map(Number).filter(Number.isFinite);
  if (pedido) return permitidos.includes(pedido) ? [pedido] : [];
  return permitidos;
}
