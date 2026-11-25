-- Chaves da 96_meta_cuidado_24h (só para frente e idempotente).
ALTER TABLE meta_cuidado_24h ADD CONSTRAINT fk_meta_cuidado_24h_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE meta_cuidado_24h ADD CONSTRAINT fk_meta_cuidado_24h_atendimento_id FOREIGN KEY IF NOT EXISTS (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT;
ALTER TABLE meta_cuidado_24h ADD CONSTRAINT fk_meta_cuidado_24h_paciente_id FOREIGN KEY IF NOT EXISTS (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT;
ALTER TABLE meta_cuidado_24h ADD CONSTRAINT fk_meta_cuidado_24h_ocorrencia_risco_clinico_id FOREIGN KEY IF NOT EXISTS (ocorrencia_risco_clinico_id) REFERENCES ocorrencia_risco_clinico (id) ON DELETE RESTRICT;
ALTER TABLE meta_cuidado_24h ADD CONSTRAINT fk_meta_cuidado_24h_responsavel_usuario_id FOREIGN KEY IF NOT EXISTS (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE meta_cuidado_24h ADD CONSTRAINT fk_meta_cuidado_24h_encerrada_por_usuario_id FOREIGN KEY IF NOT EXISTS (encerrada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
