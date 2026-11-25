-- Prontuário de acesso restrito (99_prontuario_restrito_tabelas.sql). Só para frente e idempotente.

ALTER TABLE senha_prontuario_paciente ADD CONSTRAINT fk_senha_prontuario_paciente_paciente_id FOREIGN KEY IF NOT EXISTS (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT;
ALTER TABLE senha_prontuario_paciente ADD CONSTRAINT fk_senha_prontuario_paciente_definida_por_usuario_id FOREIGN KEY IF NOT EXISTS (definida_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE acesso_prontuario_restrito ADD CONSTRAINT fk_acesso_prontuario_restrito_autorizacao_id FOREIGN KEY IF NOT EXISTS (autorizacao_acesso_prontuario_restrito_id) REFERENCES autorizacao_acesso_prontuario_restrito (id) ON DELETE RESTRICT;
ALTER TABLE acesso_prontuario_restrito ADD CONSTRAINT fk_acesso_prontuario_restrito_paciente_id FOREIGN KEY IF NOT EXISTS (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT;
ALTER TABLE acesso_prontuario_restrito ADD CONSTRAINT fk_acesso_prontuario_restrito_usuario_id FOREIGN KEY IF NOT EXISTS (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE acesso_prontuario_restrito ADD CONSTRAINT fk_acesso_prontuario_restrito_leitura_prontuario_id FOREIGN KEY IF NOT EXISTS (leitura_prontuario_id) REFERENCES leitura_prontuario (id) ON DELETE RESTRICT;
