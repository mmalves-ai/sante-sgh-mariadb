-- Recusas da carga (fase 2, K1): profissional da trilha de impressão e exportação. Idempotente.
ALTER TABLE exportacao_documento ADD CONSTRAINT fk_exportacao_documento_profissional_id FOREIGN KEY IF NOT EXISTS (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
