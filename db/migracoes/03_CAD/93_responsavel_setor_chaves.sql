-- Cadastro, chaves do histórico do responsável pelo setor (F3.1, 02-CAD linha 27): só para frente e idempotente, do
-- 93_responsavel_setor_tabelas.
ALTER TABLE responsavel_setor_funcional ADD CONSTRAINT fk_responsavel_setor_funcional_setor_funcional_id FOREIGN KEY IF NOT EXISTS (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE responsavel_setor_funcional ADD CONSTRAINT fk_responsavel_setor_funcional_profissional_id FOREIGN KEY IF NOT EXISTS (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
