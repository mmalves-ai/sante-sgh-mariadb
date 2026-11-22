-- SADT, lote 08: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE exame_item_assinatura
  ADD CONSTRAINT fk_exame_item_assinatura_exame_item_id FOREIGN KEY (exame_item_id) REFERENCES exame_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_item_assinatura_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_item_assinatura_local_assistencia_id FOREIGN KEY (local_assistencia_id) REFERENCES local_assistencia (id) ON DELETE RESTRICT;
