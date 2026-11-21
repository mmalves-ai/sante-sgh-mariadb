-- F2.4 (dívida da migração), 3ª etapa, 4ª leva: DDL pedido pelos lotes das portas (p-*), só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v4.md

ALTER TABLE documento_estoque_item ADD CONSTRAINT fk_documento_estoque_item_origem_item FOREIGN KEY IF NOT EXISTS (origem_documento_estoque_item_id) REFERENCES documento_estoque_item (id) ON DELETE RESTRICT;
ALTER TABLE inventario_estoque_item ADD CONSTRAINT fk_inventario_estoque_item_lote_insumo FOREIGN KEY IF NOT EXISTS (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT;
