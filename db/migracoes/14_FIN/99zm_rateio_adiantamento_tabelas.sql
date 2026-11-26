-- Recusas da carga (fase 2, K1b): o rateio do adiantamento por natureza e centro de custo. O adiantamento passa a ser
-- um pai válido do rateio (exatamente um pai por linha, como antes). Idempotente e válida em qualquer ordem (ADR 0002):
-- ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS antes de recriar, ADD UNIQUE KEY IF NOT EXISTS.

ALTER TABLE rateio_lancamento
  ADD COLUMN IF NOT EXISTS adiantamento_id BIGINT UNSIGNED NULL COMMENT 'Adiantamento rateado' AFTER movimento_caixa_id,
  DROP CONSTRAINT IF EXISTS ck_rateio_lancamento_pai;
ALTER TABLE rateio_lancamento
  ADD CONSTRAINT ck_rateio_lancamento_pai CHECK ((titulo_pagar_id IS NOT NULL) + (titulo_receber_id IS NOT NULL) + (baixa_titulo_id IS NOT NULL) + (movimento_bancario_id IS NOT NULL) + (movimento_caixa_id IS NOT NULL) + (adiantamento_id IS NOT NULL) = 1);
-- A chave única também é o índice da FK (adiantamento_id é a primeira coluna).
ALTER TABLE rateio_lancamento
  ADD UNIQUE KEY IF NOT EXISTS uq_rateio_lancamento_adiantamento (adiantamento_id, sequencia);
