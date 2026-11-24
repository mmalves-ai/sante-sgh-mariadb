-- PEP, porta própria dos documentos (família exames, anexos e termo de consentimento): chaves estrangeiras
-- (idempotentes) do 97_exames_tabelas.

ALTER TABLE termo_consentimento_paciente ADD CONSTRAINT fk_termo_consentimento_paciente_termo_anterior_id FOREIGN KEY IF NOT EXISTS (termo_anterior_id) REFERENCES termo_consentimento_paciente (id) ON DELETE RESTRICT;
