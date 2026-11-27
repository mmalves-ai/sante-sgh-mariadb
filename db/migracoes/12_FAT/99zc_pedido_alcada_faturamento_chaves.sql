-- FAT, lote 99zc (F3.7, 06-FAT linha 38, C1-135): chaves estrangeiras do pedido de aprovação pela alçada do
-- faturamento. Só para frente; idempotente (ADR 0002, parte 2).
ALTER TABLE pedido_alcada_faturamento
  ADD CONSTRAINT fk_pedido_alcada_faturamento_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_alcada_faturamento_solicitado_por_usuario_id FOREIGN KEY IF NOT EXISTS (solicitado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_alcada_faturamento_decidido_por_usuario_id FOREIGN KEY IF NOT EXISTS (decidido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
