-- Cadastro, chaves da condição de incapacidade do paciente (F3.1, 02-CAD linha 4): só para frente e idempotente, do
-- 96_incapacidade_paciente_tabelas.
ALTER TABLE incapacidade_paciente ADD CONSTRAINT fk_incapacidade_paciente_paciente_id FOREIGN KEY IF NOT EXISTS (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT;
ALTER TABLE incapacidade_paciente ADD CONSTRAINT fk_incapacidade_paciente_comprovante_arquivo_id FOREIGN KEY IF NOT EXISTS (comprovante_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
