-- F2.4 (dívida da migração), 3ª etapa, 4ª leva: DDL pedido pelos lotes das portas (p-*), só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v4.md

-- TPS (Taxa de Saúde Suplementar): a GRU (guia de recolhimento da União) do envio e o pagamento dela.
ALTER TABLE envio_ans
  ADD COLUMN IF NOT EXISTS numero_gru VARCHAR(30) NULL COMMENT 'Número da GRU da TPS' AFTER cobranca_ressarcimento_sus_id,
  ADD COLUMN IF NOT EXISTS valor_gru DECIMAL(15,2) NULL COMMENT 'Valor da GRU da TPS' AFTER numero_gru,
  ADD COLUMN IF NOT EXISTS gru_paga_em DATE NULL COMMENT 'Data do pagamento da GRU' AFTER valor_gru,
  ADD COLUMN IF NOT EXISTS valor_pago_gru DECIMAL(15,2) NULL COMMENT 'Valor pago da GRU' AFTER gru_paga_em,
  DROP CONSTRAINT IF EXISTS ck_envio_ans_gru,
  ADD CONSTRAINT ck_envio_ans_gru CHECK ((obrigacao = 'tps' OR (numero_gru IS NULL AND valor_gru IS NULL AND gru_paga_em IS NULL AND valor_pago_gru IS NULL)) AND (valor_gru IS NULL OR valor_gru >= 0) AND (valor_pago_gru IS NULL OR valor_pago_gru >= 0) AND ((gru_paga_em IS NULL) = (valor_pago_gru IS NULL)) AND (gru_paga_em IS NULL OR numero_gru IS NOT NULL));
