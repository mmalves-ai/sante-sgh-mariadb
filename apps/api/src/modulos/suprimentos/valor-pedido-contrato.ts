// 05-SUP linha 20: o valor que cada pedido compromete do contrato do fornecedor, pela regra valorPedidoNoContrato,
// lido do mesmo jeito no detalhe do contrato, na lista de candidatos, na conferência do vínculo e na gestão do pedido.
// O item cancelado inteiro antes da aprovação, no pedido valorado pelos próprios itens (sem proposta vencedora na
// cotação), já ficou fora do valor aprovado (valorDoPedido conta só os itens sem cancelado_em) e não é descontado de novo.
import { valorPedidoNoContrato } from '@sgh/contratos';
import type { Leitor } from '@sgh/nucleo';

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const verdadeiro = (v: unknown): boolean => v === true || v === 1 || v === '1' || num(v) === 1;

/** O valor comprometido de cada pedido (pelo id); o pedido que não existe no estabelecimento fica fora do mapa. */
export async function valoresPedidosNoContrato(
  l: Pick<Leitor, 'consultar'>,
  est: number,
  ids: readonly number[],
): Promise<Map<number, number>> {
  const m = new Map<number, number>();
  const unicos = [...new Set(ids)];
  if (!unicos.length) return m;
  const em = unicos.map(() => '?').join(', ');
  const pedidos = await l.consultar(
    `SELECT p.id, p.situacao, p.valor_total
       FROM pedido_compra p
      WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND p.id IN (${em})`,
    [est, ...unicos],
    { teto: unicos.length },
  );
  const itens = await l.consultar(
    `SELECT x.pedido_compra_id, x.quantidade_cancelada, x.valor_unitario,
            CASE WHEN x.cancelado_em IS NOT NULL AND p.aprovado_em IS NOT NULL AND x.cancelado_em < p.aprovado_em
                  AND NOT EXISTS (SELECT 1 FROM cotacao_fornecedor cf
                                    JOIN cotacao_resposta_item r ON r.cotacao_fornecedor_id = cf.id
                                   WHERE cf.cotacao_id = p.cotacao_id AND cf.excluido_em IS NULL
                                     AND r.excluido_em IS NULL AND r.vencedor = TRUE)
                 THEN 1 ELSE 0 END AS fora
       FROM pedido_compra_item x JOIN pedido_compra p ON p.id = x.pedido_compra_id
      WHERE x.excluido_em IS NULL AND x.quantidade_cancelada > 0 AND x.pedido_compra_id IN (${em})`,
    unicos,
    { teto: 200_000 },
  );
  for (const p of pedidos) {
    const id = num(p['id']);
    m.set(
      id,
      valorPedidoNoContrato({
        situacao: String(p['situacao']),
        valorAprovado: num(p['valor_total']),
        itens: itens
          .filter((x) => num(x['pedido_compra_id']) === id)
          .map((x) => ({
            cancelada: num(x['quantidade_cancelada']),
            valorUnitario: num(x['valor_unitario']),
            foraDoValorAprovado: verdadeiro(x['fora']),
          })),
      }),
    );
  }
  return m;
}
