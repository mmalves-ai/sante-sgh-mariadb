-- HOT, lote 05: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE inventario_enxoval
  ADD CONSTRAINT fk_inventario_enxoval_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_enxoval_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_enxoval_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE inventario_enxoval_item
  ADD CONSTRAINT fk_inventario_enxoval_item_inventario_enxoval_id FOREIGN KEY (inventario_enxoval_id) REFERENCES inventario_enxoval (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_enxoval_item_peca_enxoval_id FOREIGN KEY (peca_enxoval_id) REFERENCES peca_enxoval (id) ON DELETE RESTRICT;
ALTER TABLE peca_enxoval_composicao
  ADD CONSTRAINT fk_peca_enxoval_composicao_kit_peca_enxoval_id FOREIGN KEY (kit_peca_enxoval_id) REFERENCES peca_enxoval (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_peca_enxoval_composicao_componente_peca_enxoval_id FOREIGN KEY (componente_peca_enxoval_id) REFERENCES peca_enxoval (id) ON DELETE RESTRICT;
ALTER TABLE remessa_lavanderia_item
  ADD CONSTRAINT fk_remessa_lavanderia_item_remessa_lavanderia_id FOREIGN KEY (remessa_lavanderia_id) REFERENCES remessa_lavanderia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_lavanderia_item_peca_enxoval_id FOREIGN KEY (peca_enxoval_id) REFERENCES peca_enxoval (id) ON DELETE RESTRICT;
ALTER TABLE baixa_enxoval_item
  ADD CONSTRAINT fk_baixa_enxoval_item_baixa_enxoval_id FOREIGN KEY (baixa_enxoval_id) REFERENCES baixa_enxoval (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_baixa_enxoval_item_peca_enxoval_id FOREIGN KEY (peca_enxoval_id) REFERENCES peca_enxoval (id) ON DELETE RESTRICT;
-- A perda passa a ser um documento com várias peças: as linhas existentes viram o item 1 de cada baixa.
INSERT INTO baixa_enxoval_item (baixa_enxoval_id, sequencia, peca_enxoval_id, quantidade, custo_estimado, criado_em, criado_por)
  SELECT id, 1, peca_enxoval_id, quantidade, custo_estimado, criado_em, criado_por FROM baixa_enxoval;
ALTER TABLE baixa_enxoval DROP FOREIGN KEY fk_baixa_enxoval_peca_enxoval_id;
ALTER TABLE baixa_enxoval
  DROP CONSTRAINT ck_baixa_enxoval_quantidade,
  DROP INDEX ix_baixa_enxoval_peca_enxoval,
  DROP COLUMN peca_enxoval_id,
  DROP COLUMN quantidade,
  DROP COLUMN custo_estimado;
