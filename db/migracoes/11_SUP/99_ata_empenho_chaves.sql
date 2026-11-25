-- Suprimentos, chaves da ata de registro de preços e do empenho na porta própria (C2-030, 05-SUP linha 26): só para
-- frente e idempotente, do 99_ata_empenho_tabelas.
ALTER TABLE empenho ADD CONSTRAINT fk_empenho_ata_registro_preco FOREIGN KEY IF NOT EXISTS (ata_registro_preco_id) REFERENCES ata_registro_preco (id) ON DELETE RESTRICT;
ALTER TABLE empenho ADD CONSTRAINT fk_empenho_anulado_por_usuario FOREIGN KEY IF NOT EXISTS (anulado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE empenho_item ADD CONSTRAINT fk_empenho_item_ata_registro_preco_item FOREIGN KEY IF NOT EXISTS (ata_registro_preco_item_id) REFERENCES ata_registro_preco_item (id) ON DELETE RESTRICT;
