-- Cadastro, chaves da doença crônica declarada pelo paciente (F7, 09-AREA linha 73): só para frente e idempotente, do
-- 97_condicao_cronica_declarada_tabelas.
ALTER TABLE paciente_condicao_cronica ADD CONSTRAINT fk_paciente_condicao_cronica_paciente_id FOREIGN KEY IF NOT EXISTS (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT;
ALTER TABLE paciente_condicao_cronica ADD CONSTRAINT fk_paciente_condicao_cronica_condicao_cronica_id FOREIGN KEY IF NOT EXISTS (condicao_cronica_id) REFERENCES condicao_cronica (id) ON DELETE RESTRICT;
