-- SUS, lote 04: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE contrato_gestor_sus
  ADD CONSTRAINT fk_contrato_gestor_sus_encerrado_por_usuario_id FOREIGN KEY (encerrado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE meta_contratual_sus
  ADD CONSTRAINT fk_meta_contratual_sus_complexidade_id FOREIGN KEY (complexidade_dominio_contratualizacao_sus_id) REFERENCES dominio_contratualizacao_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meta_contratual_sus_tipo_afericao_id FOREIGN KEY (tipo_afericao_dominio_contratualizacao_sus_id) REFERENCES dominio_contratualizacao_sus (id) ON DELETE RESTRICT;
