// Escopo do usuário do estoque (ficha do M28, regra 13; cap-08 §8.4): o usuário só movimenta os locais e os tipos de
// movimento que tem no cadastro de usuários do estoque e só requisita para os centros de custo dele. As flags do usuário
// do estoque (autorizar requisição, autorizar pedido, desbloquear fechamento) concedem as ações de alçada.
import { recusa, type RecusaSuprimentos } from './recusa.js';

/** Tipos de movimento por local (como o cadastro do usuário do estoque guarda). */
export type TipoMovimento =
  | 'saida'
  | 'entrada'
  | 'devolucao'
  | 'transferenciaOrigem'
  | 'transferenciaDestino'
  | 'inventario'
  | 'requisicao'
  | 'venda';

/** Tipos de movimento do escopo do usuário no estoque (uma linha por usuário, local e tipo). */
export const TIPOS_MOVIMENTO_CADASTRO: Readonly<Record<string, TipoMovimento>> = {
  S: 'saida',
  E: 'entrada',
  D: 'devolucao',
  TO: 'transferenciaOrigem',
  TD: 'transferenciaDestino',
  I: 'inventario',
  R: 'requisicao',
  V: 'venda',
};

export interface EscopoEstoque {
  /** Local → tipos permitidos. */
  readonly locais: ReadonlyMap<number, ReadonlySet<TipoMovimento>>;
  readonly centrosCusto: ReadonlySet<number>;
  /** Sem restrição de centro de custo cadastrada: todos (como o outro sistema trata). */
  readonly todosCentros: boolean;
  readonly flags: {
    readonly autorizarRequisicao: boolean;
    readonly autorizarPedido: boolean;
    readonly desbloquearFechamento: boolean;
  };
}

export function podeMovimentar(e: EscopoEstoque, local: number, tipo: TipoMovimento): boolean {
  return e.locais.get(local)?.has(tipo) ?? false;
}

export function conferirLocal(
  e: EscopoEstoque,
  local: number,
  tipo: TipoMovimento,
  campo = 'local',
): RecusaSuprimentos | null {
  return podeMovimentar(e, local, tipo)
    ? null
    : recusa('local-fora-do-escopo', 'Seu usuário não movimenta este local de estoque.', [campo]);
}

export function conferirCentroCusto(e: EscopoEstoque, cdc: number): RecusaSuprimentos | null {
  return e.todosCentros || e.centrosCusto.has(cdc)
    ? null
    : recusa('centro-fora-do-escopo', 'Seu usuário não requisita para este centro de custo.', [
        'centroCusto',
      ]);
}

/** A transferência: os dois locais no escopo (saída da origem, entrada no destino). */
export function conferirTransferencia(
  e: EscopoEstoque,
  origem: number,
  destino: number,
): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (origem === destino)
    r.push(recusa('mesmo-local', 'A origem e o destino são o mesmo local.', ['destino']));
  const a = conferirLocal(e, origem, 'transferenciaOrigem', 'origem');
  const b = conferirLocal(e, destino, 'transferenciaDestino', 'destino');
  if (a) r.push(a);
  if (b) r.push(b);
  return r;
}

/** Monta o escopo a partir das linhas do cadastro (local, tipo) — tipo desconhecido é ignorado. */
export function escopoDasLinhas(
  linhas: readonly { local: number; tipo: string }[],
  centros: readonly number[],
  flags: EscopoEstoque['flags'],
): EscopoEstoque {
  const locais = new Map<number, Set<TipoMovimento>>();
  for (const l of linhas) {
    const t = TIPOS_MOVIMENTO_CADASTRO[l.tipo.trim().toUpperCase()];
    if (!t) continue;
    if (!locais.has(l.local)) locais.set(l.local, new Set());
    locais.get(l.local)!.add(t);
  }
  return { locais, centrosCusto: new Set(centros), todosCentros: centros.length === 0, flags };
}
