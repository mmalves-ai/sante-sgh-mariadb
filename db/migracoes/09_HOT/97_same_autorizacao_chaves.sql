-- SAME: autorização da solicitação de prontuário (F3.9, 04-HOT L128): a chave de quem decidiu. Idempotente.
ALTER TABLE solicitacao_prontuario ADD CONSTRAINT fk_solicitacao_prontuario_autorizacao_usuario FOREIGN KEY IF NOT EXISTS (autorizacao_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
