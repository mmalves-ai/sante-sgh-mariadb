-- Chaves da região anatômica do exame pedido (10_SADT/99_exame_item_regiao). Idempotente.
ALTER TABLE exame_item ADD CONSTRAINT fk_exame_item_regiao_anatomica_codificada_id FOREIGN KEY IF NOT EXISTS (regiao_anatomica_codificada_id) REFERENCES regiao_anatomica_codificada (id) ON DELETE RESTRICT;
