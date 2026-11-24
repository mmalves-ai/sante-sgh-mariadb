-- Histórico da autorização da internação (93_guia_internacao_tabelas.sql). Só para frente e idempotente.

ALTER TABLE guia_internacao ADD CONSTRAINT fk_guia_internacao_internacao_id FOREIGN KEY IF NOT EXISTS (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT;
ALTER TABLE guia_internacao ADD CONSTRAINT fk_guia_internacao_conta_hospitalar_id FOREIGN KEY IF NOT EXISTS (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT;
