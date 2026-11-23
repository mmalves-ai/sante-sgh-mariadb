-- Repasse por grupo de ato: chave do grupo de ato da regra (33_tabelas.sql). FK RESTRICT.
ALTER TABLE regra_repasse_item
  ADD CONSTRAINT fk_regra_repasse_item_grupo_ato_id FOREIGN KEY IF NOT EXISTS (grupo_ato_id) REFERENCES grupo_ato (id) ON DELETE RESTRICT;
ALTER TABLE pacote_item_incluso
  ADD CONSTRAINT fk_pacote_item_incluso_grupo_ato_id FOREIGN KEY IF NOT EXISTS (grupo_ato_id) REFERENCES grupo_ato (id) ON DELETE RESTRICT;
