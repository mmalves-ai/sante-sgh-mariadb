// F7, 07-FIN linha 110: a guia de recolhimento (DARF, DAE ou guia do município) e a apuração do retido acompanham o
// título que as paga. O recolhimento (contabil-fiscal-propria.ts) grava a guia emitida e a apuração fechada; a baixa que
// quita o título passa a guia a paga (com a data) e a apuração a recolhida; a exclusão ou o cancelamento do título
// cancela as duas e devolve as retenções ao retido em aberto (a apuração cancelada guarda os itens como histórico).
// Quem muda o título chama acompanharGuiasDosTitulos na mesma transação e declara TABELAS_GUIA_DO_TITULO.
import { situacaoDoRecolhimento } from '@sgh/dominio-financeiro';
import type { TxOperacao } from '@sgh/nucleo';
import { dataIso, numero, texto } from './vocabulario.js';

/** As tabelas que o acompanhamento grava (entram na declaração da operação que chama). */
export const TABELAS_GUIA_DO_TITULO: readonly string[] = [
  'guia_recolhimento',
  'apuracao_retencao',
  'retencao_titulo',
];

/** Atualiza a guia e a apuração de cada título informado pela situação dele; devolve quantas guias mudaram. */
export async function acompanharGuiasDosTitulos(
  tx: TxOperacao,
  titulos: Iterable<number>,
  usuario: number | null,
): Promise<number> {
  const ids = [...new Set(titulos)].filter((t) => t > 0);
  if (ids.length === 0) return 0;
  const linhas = await tx.consultarParaAtualizar(
    `SELECT g.id, g.versao, g.situacao, g.titulo_pagar_id, t.excluido_em, t.situacao AS situacao_titulo,
            (SELECT COUNT(*) FROM parcela_pagar p WHERE p.titulo_pagar_id = t.id AND p.excluido_em IS NULL) AS parcelas,
            (SELECT COUNT(*) FROM parcela_pagar p WHERE p.titulo_pagar_id = t.id AND p.excluido_em IS NULL
                AND p.situacao <> 'paga') AS abertas,
            (SELECT MAX(p.quitada_em) FROM parcela_pagar p WHERE p.titulo_pagar_id = t.id AND p.excluido_em IS NULL) AS quitada
       FROM guia_recolhimento g JOIN titulo_pagar t ON t.id = g.titulo_pagar_id
      WHERE g.titulo_pagar_id IN (${ids.map(() => '?').join(', ')}) AND g.excluido_em IS NULL
        AND g.situacao IN ('emitida', 'paga')
      ORDER BY g.id`,
    ids,
    { teto: 500 },
  );
  let mudou = 0;
  const agora = new Date();
  for (const g of linhas) {
    const alvo = situacaoDoRecolhimento({
      excluido: g['excluido_em'] !== null && g['excluido_em'] !== undefined,
      cancelado: texto(g['situacao_titulo']) === 'cancelado',
      quitado: numero(g['parcelas']) > 0 && numero(g['abertas']) === 0,
      dataPagamento: dataIso(g['quitada']),
    });
    const guia = numero(g['id']);
    if (texto(g['situacao']) !== alvo.guia) {
      await tx.alterar('guia_recolhimento', guia, numero(g['versao']), {
        situacao: alvo.guia,
        data_pagamento: alvo.dataPagamento,
      });
      mudou += 1;
    }
    const apuracoes = await tx.consultarParaAtualizar(
      `SELECT id, versao, situacao FROM apuracao_retencao
        WHERE guia_recolhimento_id = ? AND excluido_em IS NULL AND situacao <> 'cancelada'`,
      [guia],
      { teto: 50 },
    );
    for (const a of apuracoes)
      if (texto(a['situacao']) !== alvo.apuracao)
        await tx.alterar('apuracao_retencao', numero(a['id']), numero(a['versao']), {
          situacao: alvo.apuracao,
        });
    // Guia cancelada: o retido volta ao aberto para um novo recolhimento.
    if (alvo.guia === 'cancelada')
      await tx.executar(
        `UPDATE retencao_titulo SET recolhimento_titulo_pagar_id = NULL, alterado_em = ?, alterado_por = ?,
                versao = versao + 1
          WHERE recolhimento_titulo_pagar_id = ? AND excluido_em IS NULL`,
        [agora, usuario, numero(g['titulo_pagar_id'])],
      );
  }
  return mudou;
}
