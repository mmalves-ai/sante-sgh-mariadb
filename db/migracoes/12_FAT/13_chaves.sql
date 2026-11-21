-- FAT, lote 13: chaves (aplicadas depois de todos os tabelas.sql)

-- L8-04 (25)
ALTER TABLE referencia_emissao_matmed_excecao
  ADD CONSTRAINT fk_referencia_emissao_matmed_excecao_item_referencia_matmed_id FOREIGN KEY (item_referencia_matmed_id) REFERENCES item_referencia_matmed (id) ON DELETE RESTRICT;

-- L8-05 (22)
ALTER TABLE preco_negociado_matmed
  ADD CONSTRAINT fk_preco_negociado_matmed_item_referencia_matmed_id FOREIGN KEY (item_referencia_matmed_id) REFERENCES item_referencia_matmed (id) ON DELETE RESTRICT;
