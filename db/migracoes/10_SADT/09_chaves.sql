-- SADT, lote 9: chaves e sementes (aplicadas depois de todos os tabelas.sql)

-- L7-01 (3)
ALTER TABLE doacao_sangue
  ADD CONSTRAINT fk_doacao_sangue_intercorrencia_tipo_reacao_transfusional_id FOREIGN KEY (intercorrencia_tipo_reacao_transfusional_id) REFERENCES tipo_reacao_transfusional (id) ON DELETE RESTRICT;

-- L7-04 (11)
ALTER TABLE exame_item
  ADD CONSTRAINT fk_exame_item_conta_hospitalar_item_id FOREIGN KEY (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT;

-- L7-04 (5): setor por exame e solicitante externo (exatamente um solicitante)
ALTER TABLE requisicao_exame
  ADD CONSTRAINT fk_requisicao_exame_solicitante_externo_id FOREIGN KEY (solicitante_externo_id) REFERENCES solicitante_externo (id) ON DELETE RESTRICT;
