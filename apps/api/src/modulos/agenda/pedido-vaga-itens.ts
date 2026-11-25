// Os procedimentos pedidos (lista_espera_item) acompanham o pedido de vaga (02-AGE linha 53) da entrada até a marcação:
//   - leitura: quem pediu (o profissional ou o pedido da central de regulação) e os itens de cada pedido, para a aba do
//     prontuário e para a fila da agenda (quem marca vê o que foi pedido, não só o item principal);
//   - encerramento: quando a fila marca ou cancela o pedido, os itens ainda aguardando passam a 'marcado' (com a
//     marcação) ou 'cancelado' na mesma transação, pela regra do domínio (`itensNoEncerramentoDaEspera`). O item já
//     encerrado fica como está; nada se apaga.
import { itensNoEncerramentoDaEspera } from '@sgh/dominio-agenda';
import type { Leitor, TxOperacao } from '@sgh/nucleo';

const num = (v: unknown): number => Number(v);
const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const marcadores = (n: number): string => Array.from({ length: n }, () => '?').join(', ');

export interface ItemPedidoLido {
  readonly sequencia: number;
  readonly descricao: string;
  readonly quantidade: number;
  readonly situacao: string;
  readonly marcacao: number | null;
}

export interface ComplementoPedido {
  /** Profissional que pediu, ou o número do pedido da central de regulação, ou nada (pedido da própria agenda). */
  readonly solicitante: string | null;
  readonly regulacao: string | null;
  readonly itens: readonly ItemPedidoLido[];
}

/** Quem pediu e os itens de cada pedido da lista de espera (por id do pedido). */
export async function complementoDosPedidos(
  l: Pick<Leitor, 'consultar'>,
  ids: readonly number[],
): Promise<Map<number, ComplementoPedido>> {
  const m = new Map<number, ComplementoPedido>();
  if (ids.length === 0) return m;
  const ps = await l.consultar(
    `SELECT le.id, pf.nome AS solicitante, sr.numero AS regulacao
       FROM lista_espera le
       LEFT JOIN profissional pr ON pr.id = le.solicitante_profissional_id
       LEFT JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
       LEFT JOIN solicitacao_regulacao sr ON sr.id = le.solicitacao_regulacao_id
      WHERE le.id IN (${marcadores(ids.length)})`,
    [...ids],
  );
  const its = await l.consultar(
    `SELECT i.lista_espera_id, i.sequencia, i.quantidade, i.situacao, i.marcacao_horario_id,
        COALESCE(ia.descricao, fv.descricao) AS descricao
       FROM lista_espera_item i
       LEFT JOIN item_agendavel ia ON ia.id = i.item_agendavel_id
       LEFT JOIN item_faturavel fv ON fv.id = i.item_faturavel_id
      WHERE i.excluido_em IS NULL AND i.lista_espera_id IN (${marcadores(ids.length)})
      ORDER BY i.lista_espera_id, i.sequencia`,
    [...ids],
  );
  for (const p of ps) {
    const id = num(p['id']);
    m.set(id, {
      solicitante: txt(p['solicitante']),
      regulacao: txt(p['regulacao']),
      itens: its
        .filter((i) => num(i['lista_espera_id']) === id)
        .map((i) => ({
          sequencia: num(i['sequencia']),
          descricao: String(i['descricao'] ?? ''),
          quantidade: num(i['quantidade']),
          situacao: String(i['situacao']),
          marcacao: i['marcacao_horario_id'] === null ? null : num(i['marcacao_horario_id']),
        })),
    });
  }
  return m;
}

/**
 * Leva os itens ainda aguardando do pedido à situação do encerramento (marcado com a marcação, ou cancelado), na
 * transação de quem encerra. Devolve quantos itens mudaram (vai ao histórico do pedido).
 */
export async function encerrarItensDoPedido(
  tx: TxOperacao,
  pedido: number,
  situacao: 'atendido' | 'cancelado' | 'aguardando',
  marcacao: number | null,
): Promise<number> {
  const alvo = itensNoEncerramentoDaEspera(situacao, marcacao);
  if (!alvo) return 0;
  const its = await tx.consultarParaAtualizar(
    `SELECT id, versao FROM lista_espera_item
      WHERE lista_espera_id = ? AND excluido_em IS NULL AND situacao = 'aguardando' ORDER BY sequencia`,
    [pedido],
  );
  for (const i of its)
    await tx.alterar('lista_espera_item', num(i['id']), num(i['versao']), {
      situacao: alvo.situacao,
      marcacao_horario_id: alvo.marcacao,
    });
  return its.length;
}
