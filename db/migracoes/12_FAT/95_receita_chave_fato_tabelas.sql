-- Chave do fato do evento contábil da receita (06-FAT linha 37, F3.7, 24/11/2026): só para frente e idempotente
-- (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio (@sgh/dominio-faturamento, conta/receita-contabil.ts).
--   - lancamento_contabil_receita.chave_fato: a chave estável do fato do faturamento que gerou o evento (conta, ciclo de
--     fechamento, item e fato). A apuração compara por ela e não duplica o evento.
--   - chave_fato_viva: a mesma chave só enquanto o evento vive (não cancelado e não excluído). O índice único sobre ela
--     garante no banco um único evento vivo por fato no estabelecimento; o cancelado sai da unicidade e fica no histórico.

ALTER TABLE lancamento_contabil_receita
  ADD COLUMN IF NOT EXISTS chave_fato VARCHAR(150) NULL COMMENT 'Chave estável do fato do faturamento que gerou o evento' AFTER tipo_acao,
  ADD COLUMN IF NOT EXISTS chave_fato_viva VARCHAR(150) AS (IF(situacao <> 'cancelado' AND excluido_em IS NULL, chave_fato, NULL)) PERSISTENT COMMENT 'Só para a unicidade: um evento vivo por fato' AFTER chave_fato,
  ADD UNIQUE KEY IF NOT EXISTS uq_lancamento_contabil_receita_chave_fato_viva (estabelecimento_id, chave_fato_viva),
  ADD KEY IF NOT EXISTS ix_lancamento_contabil_receita_chave_fato (estabelecimento_id, chave_fato);
