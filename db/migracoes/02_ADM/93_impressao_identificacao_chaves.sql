-- Chaves da 93_impressao_identificacao (só para frente e idempotente).
ALTER TABLE impressao_identificacao ADD CONSTRAINT fk_impressao_identificacao_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE impressao_identificacao ADD CONSTRAINT fk_impressao_identificacao_atendimento_id FOREIGN KEY IF NOT EXISTS (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT;
ALTER TABLE impressao_identificacao ADD CONSTRAINT fk_impressao_identificacao_finalidade_impressao_id FOREIGN KEY IF NOT EXISTS (finalidade_impressao_id) REFERENCES finalidade_impressao (id) ON DELETE RESTRICT;
ALTER TABLE impressao_identificacao ADD CONSTRAINT fk_impressao_identificacao_estacao_trabalho_id FOREIGN KEY IF NOT EXISTS (estacao_trabalho_id) REFERENCES estacao_trabalho (id) ON DELETE RESTRICT;
ALTER TABLE impressao_identificacao ADD CONSTRAINT fk_impressao_identificacao_impressora_id FOREIGN KEY IF NOT EXISTS (impressora_id) REFERENCES impressora (id) ON DELETE RESTRICT;
