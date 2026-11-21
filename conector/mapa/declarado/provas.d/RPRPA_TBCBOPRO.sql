SELECT o.chave_original, CAST(MIN(oi.chave_original) AS SIGNED)
FROM {ctl}.conector_origem o
JOIN rpa r ON r.id = o.id_destino
JOIN inscricao_conselho ic ON ic.profissional_id = r.profissional_id
JOIN {ctl}.conector_origem oi ON oi.tabela_origem = 'TBCBOPRO' AND oi.entidade_destino = 'inscricao_conselho'
  AND oi.id_destino = ic.id AND oi.excluido_em IS NULL
WHERE o.tabela_origem = 'RPRPA' AND o.entidade_destino = 'rpa' AND o.excluido_em IS NULL
GROUP BY o.chave_original
HAVING COUNT(DISTINCT ic.id) = 1
-- prova de não copiar (ADR 0006, 1) de RPRPA_TBCBOPRO: a inscrição (TBCBOPRO) de cada RPA é recalculada no destino
-- pelo profissional gravado no RPA (rpa.profissional_id, lido pela referência encadeada desta tabela na fatia L8-02)
-- e pela inscrição única desse profissional (inscricao_conselho, conector_origem). Profissional com mais de uma
-- inscrição não determina a inscrição do RPA: a linha fica faltando e a prova falha (prova_nao_conferida, alta),
-- visível até o RPA guardar a inscrição (pedido em docs/obra/fatias/f4/saida/L8-05.json).
