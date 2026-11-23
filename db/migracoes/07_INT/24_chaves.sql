-- NIR: cancelamento da solicitação de leito com quem cancelou (24_tabelas.sql). Só para frente e idempotente.

ALTER TABLE pedido_leito ADD CONSTRAINT fk_pedido_leito_cancelado_por_usuario_id FOREIGN KEY IF NOT EXISTS (cancelado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

-- O estado da solicitação preso ao da situação (24_tabelas.sql): a situação em uso não muda de estado.
ALTER TABLE pedido_leito ADD CONSTRAINT fk_pedido_leito_situacao_estado FOREIGN KEY IF NOT EXISTS (situacao_pedido_leito_id, estado_situacao) REFERENCES situacao_pedido_leito (id, estado) ON DELETE RESTRICT ON UPDATE RESTRICT;
