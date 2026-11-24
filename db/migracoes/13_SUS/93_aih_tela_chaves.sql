-- Chaves da 93_aih_tela_tabelas.sql (idempotentes).
ALTER TABLE autorizacao_internacao_sus ADD CONSTRAINT fk_autorizacao_internacao_sus_solicitante_profissional_id FOREIGN KEY IF NOT EXISTS (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE autorizacao_internacao_sus ADD CONSTRAINT fk_autorizacao_internacao_sus_solicitante_externo_id FOREIGN KEY IF NOT EXISTS (solicitante_externo_id) REFERENCES solicitante_externo (id) ON DELETE RESTRICT;
