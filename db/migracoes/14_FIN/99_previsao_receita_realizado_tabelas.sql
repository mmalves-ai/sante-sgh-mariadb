-- Previsão de receita realizada pelo título a receber e motivo do cancelamento da ocorrência (07-FIN linha 68, F8,
-- 25/11/2026): só para frente e idempotente (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio
-- (@sgh/dominio-financeiro, previsao-provisao.ts: conferirLadoRealizacao e conferirTituloReceberConciliacao) e na
-- operação (apps/api/src/modulos/financeiro/compensacao-previsao-propria.ts). A conciliação liga a ocorrência ou a
-- provisão a UM título: a pagar (despesa, provisão) ou a receber (receita); a provisão só pelo título a pagar.
ALTER TABLE conciliacao_previsao_realizado
  MODIFY COLUMN titulo_pagar_id BIGINT UNSIGNED NULL COMMENT 'Título a pagar que realizou a previsão de despesa ou liquidou a provisão',
  ADD COLUMN IF NOT EXISTS titulo_receber_id BIGINT UNSIGNED NULL COMMENT 'Título a receber que realizou a previsão de receita' AFTER titulo_pagar_id;

ALTER TABLE conciliacao_previsao_realizado
  ADD CONSTRAINT IF NOT EXISTS ck_conciliacao_previsao_realizado_titulo CHECK ((titulo_pagar_id IS NULL) <> (titulo_receber_id IS NULL)),
  ADD CONSTRAINT IF NOT EXISTS ck_conciliacao_previsao_realizado_provisao_pagar CHECK (provisao_passivo_id IS NULL OR titulo_pagar_id IS NOT NULL),
  ADD UNIQUE KEY IF NOT EXISTS uq_conciliacao_previsao_realizado_previsao_receber (parcela_previsao_financeira_id, titulo_receber_id),
  ADD KEY IF NOT EXISTS ix_conciliacao_previsao_realizado_titulo_receber (titulo_receber_id);

ALTER TABLE parcela_previsao_financeira
  ADD COLUMN IF NOT EXISTS motivo_cancelamento VARCHAR(500) NULL COMMENT 'Motivo do cancelamento da ocorrência (cancelamento avulso ou encerramento da previsão)' AFTER titulo_receber_id;

ALTER TABLE parcela_previsao_financeira
  ADD CONSTRAINT IF NOT EXISTS ck_parcela_previsao_financeira_motivo_cancelamento CHECK (motivo_cancelamento IS NULL OR situacao = 'cancelada');
