-- Recusas da carga (fase 2, K1b): adiantamento rateado. Idempotente.
ALTER TABLE rateio_lancamento ADD CONSTRAINT fk_rateio_lancamento_adiantamento_id FOREIGN KEY IF NOT EXISTS (adiantamento_id) REFERENCES adiantamento (id) ON DELETE RESTRICT;
