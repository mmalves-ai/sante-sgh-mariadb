-- F4 rodada 5: chaves do rascunho clínico (40_tabelas.sql).
ALTER TABLE registro_assistencial_rascunho
  ADD CONSTRAINT fk_registro_assistencial_rascunho_encerrado_por_profissional FOREIGN KEY (encerrado_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_rascunho_encerrado_por_usuario FOREIGN KEY (encerrado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

ALTER TABLE alergia_paciente
  ADD CONSTRAINT fk_alergia_paciente_registro_assistencial_rascunho_id FOREIGN KEY (registro_assistencial_rascunho_id) REFERENCES registro_assistencial_rascunho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alergia_paciente_rascunho_autor_usuario_id FOREIGN KEY (rascunho_autor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alergia_paciente_encerrado_por_profissional_id FOREIGN KEY (encerrado_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
