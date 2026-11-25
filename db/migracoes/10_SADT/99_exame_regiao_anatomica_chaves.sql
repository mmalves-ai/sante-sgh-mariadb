-- Chaves da região anatômica do exame (10_SADT/99_exame_regiao_anatomica). Idempotente.
ALTER TABLE exame_regiao_anatomica ADD CONSTRAINT fk_exame_regiao_anatomica_exame_id FOREIGN KEY IF NOT EXISTS (exame_id) REFERENCES exame (id) ON DELETE RESTRICT;
ALTER TABLE exame_regiao_anatomica ADD CONSTRAINT fk_exame_regiao_anatomica_regiao_anatomica_codificada_id FOREIGN KEY IF NOT EXISTS (regiao_anatomica_codificada_id) REFERENCES regiao_anatomica_codificada (id) ON DELETE RESTRICT;
ALTER TABLE exame_regiao_anatomica ADD CONSTRAINT fk_exame_regiao_anatomica_desativado_por FOREIGN KEY IF NOT EXISTS (desativado_por) REFERENCES usuario (id) ON DELETE RESTRICT;
