-- Chaves da 99w_material_terceiro_pacote (só para frente e idempotente).
ALTER TABLE recebimento_material_terceiro_item ADD CONSTRAINT fk_recebimento_material_terceiro_item_pacote_esteril_id FOREIGN KEY IF NOT EXISTS (pacote_esteril_id) REFERENCES pacote_esteril (id) ON DELETE RESTRICT;
