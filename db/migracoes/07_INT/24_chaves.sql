-- NIR: cancelamento da solicitação de leito com quem cancelou (24_tabelas.sql). Só para frente e idempotente.

ALTER TABLE pedido_leito ADD CONSTRAINT fk_pedido_leito_cancelado_por_usuario_id FOREIGN KEY IF NOT EXISTS (cancelado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
