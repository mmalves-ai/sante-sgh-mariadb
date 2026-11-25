-- Chaves da 98_item_lote_laudo_tabelas.sql (idempotentes).
ALTER TABLE item_lote_laudo_sus ADD CONSTRAINT fk_item_lote_laudo_sus_lote_laudo_sus_id FOREIGN KEY IF NOT EXISTS (lote_laudo_sus_id) REFERENCES lote_laudo_sus (id) ON DELETE RESTRICT;
ALTER TABLE item_lote_laudo_sus ADD CONSTRAINT fk_item_lote_laudo_sus_laudo_internacao_sus_id FOREIGN KEY IF NOT EXISTS (laudo_internacao_sus_id) REFERENCES laudo_internacao_sus (id) ON DELETE RESTRICT;
