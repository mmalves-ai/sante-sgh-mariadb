-- Cadastro, chave do ponteiro da unificação de solicitante externo (F3.1, 02-CAD linha 20): só para frente e
-- idempotente, do 98_solicitante_unificacao_tabelas.
ALTER TABLE solicitante_externo ADD CONSTRAINT fk_solicitante_externo_sucessor_solicitante_externo_id FOREIGN KEY IF NOT EXISTS (sucessor_solicitante_externo_id) REFERENCES solicitante_externo (id) ON DELETE RESTRICT;
