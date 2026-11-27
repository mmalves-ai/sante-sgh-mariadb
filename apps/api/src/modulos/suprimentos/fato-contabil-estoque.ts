// Fato contábil do estoque (C2-093; ADR 0003): o movimento e a nota de entrada publicam, na mesma transação do
// documento, o fato que a contabilização automática lê. A saída de consumo (sem local de contrapartida e fora do
// consignado, que não é do hospital) publica `saidaEstoque` pelo valor do custo que saiu; o movimento de estorno estorna
// o fato do movimento original e republica o saldo não devolvido. A nota confirmada publica `notaEntrada` pelo total; a desconsolidação o estorna. A
// entrada pela nota não publica fato próprio: o efeito é o da nota. Toda operação que chama `movimentar` declara
// TABELAS_PUBLICACAO_FATO.
import { estornarFatosDaOrigem, publicarFatos } from '../contabil/publicacao-fato.js';
import type { TxOperacao } from '@sgh/nucleo';

const centavos = (reais: number): number => Math.round(Math.abs(reais) * 100);

export interface MovimentoComFato {
  readonly id: number;
  readonly natureza: 'entrada' | 'saida';
  /** Valor do movimento em reais (o custo que entrou ou saiu). */
  readonly valor: number;
  readonly hoje: string;
  readonly tipoMovimento: number;
  readonly insumo: number;
  readonly centroCusto?: number | null;
  readonly contrapartida?: number | null;
  readonly consignado?: boolean;
  readonly estorno?: number | null;
  /** A saída que esta entrada de devolução reduz (devolução de dose da farmácia, sem vínculo de estorno; C2-093). */
  readonly devolve?: number | null;
}

/** Publica (ou estorna) o fato do movimento de estoque gravado agora. */
export async function publicarFatoDoMovimento(
  tx: TxOperacao,
  est: number,
  m: MovimentoComFato,
): Promise<void> {
  const original = m.estorno ?? m.devolve ?? null;
  if (original) {
    const estornados = await estornarFatosDaOrigem(
      tx,
      est,
      'movimento_estoque',
      [original],
      m.hoje,
      `${m.estorno ? 'estorno' : 'devolução'} no movimento ${m.id}`,
    );
    if (estornados.length === 0) return;
    // A devolução pode ser parcial: o fato estorna sempre o efeito inteiro, então o saldo ainda não devolvido do
    // movimento original volta como fato novo, na data do estorno (valor zero: devolução total, sem fato vivo).
    const o = await tx.uma(
      `SELECT o.valor_total, o.centro_custo_id, o.insumo_id, o.tipo_movimento_estoque_id,
              (SELECT COALESCE(SUM(x.valor_total), 0) FROM movimento_estoque x
                WHERE x.excluido_em IS NULL
                  AND (x.estorno_movimento_estoque_id = o.id
                       OR (x.estorno_movimento_estoque_id IS NULL AND x.natureza = 'entrada'
                           AND x.dispensacao_item_id = o.dispensacao_item_id))) AS estornado
         FROM movimento_estoque o WHERE o.id = ? AND o.estabelecimento_id = ?`,
      [original, est],
    );
    if (!o) return;
    const saldo = Math.max(0, centavos(Number(o['valor_total'])) - centavos(Number(o['estornado'])));
    await publicarFatos(tx, est, [
      {
        tipo: 'saidaEstoque',
        entidade: 'movimento_estoque',
        entidadeId: original,
        data: m.hoje,
        valorCentavos: saldo,
        centroCusto: o['centro_custo_id'] == null ? null : Number(o['centro_custo_id']),
        documento: `saída de estoque movimento ${original} saldo`,
        campos: { item: Number(o['insumo_id']), tipoMovimento: Number(o['tipo_movimento_estoque_id']) },
      },
    ]);
    return;
  }
  if (m.natureza !== 'saida' || m.contrapartida || m.consignado) return;
  await publicarFatos(tx, est, [
    {
      tipo: 'saidaEstoque',
      entidade: 'movimento_estoque',
      entidadeId: m.id,
      data: m.hoje,
      valorCentavos: centavos(m.valor),
      centroCusto: m.centroCusto ?? null,
      documento: `saída de estoque movimento ${m.id}`,
      campos: { item: m.insumo, tipoMovimento: m.tipoMovimento },
    },
  ]);
}

/** Publica o fato da nota de entrada confirmada (o total da nota). */
export async function publicarFatoDaNota(
  tx: TxOperacao,
  est: number,
  n: { id: number; hoje: string; valorTotal: number; tipoEntrada: number; fornecedor: number },
): Promise<void> {
  await publicarFatos(tx, est, [
    {
      tipo: 'notaEntrada',
      entidade: 'nota_entrada',
      entidadeId: n.id,
      data: n.hoje,
      valorCentavos: centavos(n.valorTotal),
      centroCusto: null,
      documento: `nota de entrada ${n.id}`,
      campos: { tipoEntrada: n.tipoEntrada, fornecedor: n.fornecedor },
    },
  ]);
}

/** Estorna o fato da nota desconsolidada. */
export async function estornarFatoDaNota(
  tx: TxOperacao,
  est: number,
  nota: number,
  hoje: string,
): Promise<void> {
  await estornarFatosDaOrigem(tx, est, 'nota_entrada', [nota], hoje, `desconsolidação da nota ${nota}`);
}
