-- PEP, registro do fechamento da checagem do turno no prontuário (03-PEP L113, C1-023): chaves estrangeiras
-- (idempotentes) do 99_fechamento_checagem_documento_tabelas.

ALTER TABLE fechamento_checagem_paciente ADD CONSTRAINT fk_fechamento_checagem_paciente_fechamento_id FOREIGN KEY IF NOT EXISTS (fechamento_horario_checagem_id) REFERENCES fechamento_horario_checagem (id) ON DELETE RESTRICT;
ALTER TABLE fechamento_checagem_paciente ADD CONSTRAINT fk_fechamento_checagem_paciente_atendimento_id FOREIGN KEY IF NOT EXISTS (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT;
ALTER TABLE fechamento_checagem_paciente ADD CONSTRAINT fk_fechamento_checagem_paciente_paciente_id FOREIGN KEY IF NOT EXISTS (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT;
ALTER TABLE fechamento_checagem_paciente ADD CONSTRAINT fk_fechamento_checagem_paciente_documento_id FOREIGN KEY IF NOT EXISTS (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT;
