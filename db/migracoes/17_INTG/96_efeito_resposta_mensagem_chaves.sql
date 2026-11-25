-- Chaves da 96_efeito_resposta_mensagem (só para frente e idempotente).
ALTER TABLE pedido_mensagem_paciente_retorno ADD CONSTRAINT fk_pedido_mensagem_paciente_retorno_confirmacao_marcacao_id FOREIGN KEY IF NOT EXISTS (confirmacao_marcacao_id) REFERENCES confirmacao_marcacao (id) ON DELETE RESTRICT;
