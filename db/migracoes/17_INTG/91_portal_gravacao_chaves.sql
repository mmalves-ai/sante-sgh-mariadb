-- Chaves da 91_portal_gravacao (só para frente e idempotente).
ALTER TABLE conta_portal_paciente ADD CONSTRAINT fk_conta_portal_paciente_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE ato_copia_prontuario ADD CONSTRAINT fk_ato_copia_prontuario_conta_portal_paciente_id FOREIGN KEY IF NOT EXISTS (conta_portal_paciente_id) REFERENCES conta_portal_paciente (id) ON DELETE RESTRICT;
