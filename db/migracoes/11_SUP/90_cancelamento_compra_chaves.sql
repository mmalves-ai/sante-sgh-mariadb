-- Suprimentos, chaves do cancelamento do pedido de compra como evento (F3.6, 05-SUP linha 20): só para frente e
-- idempotente, do 90_cancelamento_compra_tabelas.
ALTER TABLE cancelamento_pedido_compra_item ADD CONSTRAINT fk_cancelamento_pedido_compra_item_pedido_compra_id FOREIGN KEY IF NOT EXISTS (pedido_compra_id) REFERENCES pedido_compra (id) ON DELETE RESTRICT;
ALTER TABLE cancelamento_pedido_compra_item ADD CONSTRAINT fk_cancelamento_pedido_compra_item_pedido_compra_item_id FOREIGN KEY IF NOT EXISTS (pedido_compra_item_id) REFERENCES pedido_compra_item (id) ON DELETE RESTRICT;
ALTER TABLE cancelamento_pedido_compra_item ADD CONSTRAINT fk_cancelamento_pedido_compra_item_motivo_id FOREIGN KEY IF NOT EXISTS (motivo_cancelamento_compra_id) REFERENCES motivo_cancelamento_compra (id) ON DELETE RESTRICT;
ALTER TABLE cancelamento_pedido_compra_item ADD CONSTRAINT fk_cancelamento_pedido_compra_item_usuario_id FOREIGN KEY IF NOT EXISTS (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE cancelamento_pedido_compra_entrega ADD CONSTRAINT fk_cancelamento_pedido_compra_entrega_cancelamento_id FOREIGN KEY IF NOT EXISTS (cancelamento_pedido_compra_item_id) REFERENCES cancelamento_pedido_compra_item (id) ON DELETE RESTRICT;
ALTER TABLE cancelamento_pedido_compra_entrega ADD CONSTRAINT fk_cancelamento_pedido_compra_entrega_entrega_id FOREIGN KEY IF NOT EXISTS (pedido_compra_entrega_id) REFERENCES pedido_compra_entrega (id) ON DELETE RESTRICT;
