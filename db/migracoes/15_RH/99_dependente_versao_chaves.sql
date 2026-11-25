-- Chaves da 99_dependente_versao (só para frente e idempotente).
ALTER TABLE dependente ADD CONSTRAINT fk_dependente_dependente_anterior_id FOREIGN KEY IF NOT EXISTS (dependente_anterior_id) REFERENCES dependente (id) ON DELETE RESTRICT;
