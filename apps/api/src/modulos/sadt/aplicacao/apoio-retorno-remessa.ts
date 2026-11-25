// O retorno do laboratório de apoio na remessa (F3.5, 05-SADT linha 14): quando o resultado conferido é gravado no
// exame, o item da remessa que levou a amostra fica com o resultado recebido (data e o resultado gravado) e a remessa
// passa a recebida, ou a concluída quando todos os itens ativos voltaram. Roda na transação de quem grava o resultado
// (a operação declara as duas tabelas). A regra da situação é do domínio (situacaoDaRemessaDepoisDoRetorno).
import { situacaoDaRemessaDepoisDoRetorno, type SituacaoRemessa } from '@sgh/dominio-sadt';
import type { TxOperacao } from '@sgh/nucleo';

export const TABELAS_RETORNO_REMESSA = [
  'remessa_laboratorio_apoio',
  'remessa_laboratorio_apoio_item',
] as const;

/** Marca o item da remessa enviada do exame e acerta a situação da remessa; devolve a remessa tocada (ou nulo). */
export async function marcarRetornoNaRemessa(
  tx: TxOperacao,
  estabelecimento: number,
  exameItem: number,
  resultado: number,
  agora: Date,
): Promise<{ remessa: number; situacao: SituacaoRemessa } | null> {
  const [item] = await tx.consultarParaAtualizar(
    `SELECT ri.id, ri.versao, ri.remessa_laboratorio_apoio_id AS remessa
       FROM remessa_laboratorio_apoio_item ri
       JOIN remessa_laboratorio_apoio r ON r.id = ri.remessa_laboratorio_apoio_id
      WHERE ri.exame_item_id = ? AND ri.excluido_em IS NULL AND ri.situacao IN ('enviado', 'recebido', 'em_analise')
        AND r.estabelecimento_id = ? AND r.excluido_em IS NULL AND r.situacao IN ('enviada', 'recebida')
      ORDER BY r.enviada_em DESC, ri.id DESC LIMIT 1`,
    [exameItem, estabelecimento],
  );
  if (!item) return null;
  const remessa = Number(item['remessa']);
  await tx.alterar('remessa_laboratorio_apoio_item', Number(item['id']), Number(item['versao']), {
    situacao: 'resultado_recebido',
    resultado_recebido_em: agora,
    resultado_exame_id: resultado,
  });
  const [r] = await tx.consultarParaAtualizar(
    'SELECT id, versao, situacao FROM remessa_laboratorio_apoio WHERE id = ? AND excluido_em IS NULL',
    [remessa],
  );
  if (!r) return null;
  const q = await tx.uma(
    `SELECT SUM(situacao NOT IN ('cancelado', 'recusado')) AS ativos, SUM(situacao = 'resultado_recebido') AS com
       FROM remessa_laboratorio_apoio_item WHERE remessa_laboratorio_apoio_id = ? AND excluido_em IS NULL`,
    [remessa],
  );
  const atual = String(r['situacao']) as SituacaoRemessa;
  const nova = situacaoDaRemessaDepoisDoRetorno(atual, {
    ativos: Number(q?.['ativos'] ?? 0),
    comResultado: Number(q?.['com'] ?? 0),
  });
  if (nova !== atual)
    await tx.alterar('remessa_laboratorio_apoio', remessa, Number(r['versao']), { situacao: nova });
  return { remessa, situacao: nova };
}
