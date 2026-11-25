-- Cadastro, chaves do histórico da transferência do profissional provisório (F8, 02-CAD linha 21): só para frente e
-- idempotente, do 99_provisorio_uso_transferencia_tabelas.
ALTER TABLE profissional_provisorio_uso ADD CONSTRAINT fk_profissional_provisorio_uso_substituto_profissional_id FOREIGN KEY IF NOT EXISTS (substituto_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE profissional_provisorio_uso ADD CONSTRAINT fk_profissional_provisorio_uso_anterior_profissional_id FOREIGN KEY IF NOT EXISTS (anterior_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
