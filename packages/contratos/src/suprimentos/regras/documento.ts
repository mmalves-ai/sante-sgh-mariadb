// Documento de estoque (ficha do M28, regras 1 e 2): cabeçalho e itens nascem não consolidados (`CONSOL='F'`) e sem
// número (`DOC=0`: o banco numera por ano, mês e tipo); só o consolidado mexe no estoque; consolidado não aceita item
// novo; o cabeçalho só consolida com todos os itens consolidados e com ao menos um item. Número informado à mão é
// recusado.
import { recusa, type RecusaSuprimentos } from './recusa.js';

export type TipoDocumento = 'saida' | 'devolucao' | 'transferencia' | 'nota' | 'balanco' | 'requisicao';

/** O tipo de lançamento do documento na numeração por ano, mês e tipo (o que cada gatilho usa). */
export const TIPO_NUMERACAO: Readonly<Record<Exclude<TipoDocumento, 'requisicao'>, number>> = {
  balanco: 1,
  nota: 2,
  saida: 3,
  devolucao: 4,
  transferencia: 5,
};

export interface EstadoDocumento {
  readonly consolidado: boolean;
  readonly itens: readonly { readonly consolidado: boolean }[];
}

/** O documento novo: sem número e não consolidado. */
export function cabecalhoNovo(): { readonly DOC: 0; readonly CONSOL: 'F' } {
  return { DOC: 0, CONSOL: 'F' };
}

/** Regra 1: número digitado é recusado (o banco numera). */
export function conferirNumeroInformado(doc: number | null | undefined): RecusaSuprimentos | null {
  return doc && doc > 0
    ? recusa('numero-informado', 'O número do documento é dado pelo sistema na gravação.', ['documento'])
    : null;
}

/** Regra 1: consolidado não aceita item novo. */
export function podeIncluirItem(d: Pick<EstadoDocumento, 'consolidado'>): RecusaSuprimentos | null {
  return d.consolidado
    ? recusa('documento-consolidado', 'O documento já foi consolidado: não aceita item novo.')
    : null;
}

/** Regra 2: o cabeçalho só consolida com todos os itens consolidados (e ao menos um). */
export function podeConsolidarCabecalho(d: EstadoDocumento): RecusaSuprimentos | null {
  if (d.itens.length === 0)
    return recusa('documento-sem-itens', 'O documento não tem item: inclua os itens antes de gravar.');
  if (d.itens.some((i) => !i.consolidado))
    return recusa(
      'itens-nao-consolidados',
      'Há item do documento ainda não consolidado: o documento só fecha com todos os itens.',
    );
  return null;
}

/**
 * A ordem da consolidação (como o programa do outro sistema): primeiro cada item F → T (os gatilhos do item valorizam e
 * mexem no saldo), depois o cabeçalho F → T (o gatilho do cabeçalho confere os itens).
 */
export function ordemDaConsolidacao(
  ids: readonly number[],
): readonly ({ alvo: 'item'; id: number } | { alvo: 'cabecalho' })[] {
  return [
    ...[...ids].sort((a, b) => a - b).map((id) => ({ alvo: 'item' as const, id })),
    { alvo: 'cabecalho' as const },
  ];
}

/** Competência (ano e mês) do documento pela data dele. */
export function competenciaDaData(dataIso: string): { ano: number; mes: number } {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(dataIso);
  if (!m) throw new Error('Data inválida.');
  return { ano: Number(m[1]), mes: Number(m[2]) };
}
