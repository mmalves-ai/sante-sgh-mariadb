-- Chave do estabelecimento do bloqueio pelo último resultado (10_SADT/95). Idempotente.
ALTER TABLE bloqueio_exame_resultado ADD CONSTRAINT fk_bloqueio_exame_resultado_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
