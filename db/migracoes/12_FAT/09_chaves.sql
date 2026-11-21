-- FAT, lote 09: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE apuracao_repasse
  ADD CONSTRAINT fk_apuracao_repasse_conferida_por_usuario_id FOREIGN KEY (conferida_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE apuracao_repasse_item
  ADD CONSTRAINT fk_apuracao_repasse_item_regra_repasse_item_id FOREIGN KEY (regra_repasse_item_id) REFERENCES regra_repasse_item (id) ON DELETE RESTRICT;
ALTER TABLE rpa
  ADD CONSTRAINT fk_rpa_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT;
ALTER TABLE regra_repasse_item
  ADD CONSTRAINT fk_regra_repasse_item_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
