-- PEP, lote 13: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE registro_assistencial_rascunho
  ADD CONSTRAINT fk_registro_assistencial_rascunho_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT;
ALTER TABLE inclusao_protocolo_registro
  ADD CONSTRAINT fk_inclusao_protocolo_registro_inclusao_protocolo_paciente_id FOREIGN KEY (inclusao_protocolo_paciente_id) REFERENCES inclusao_protocolo_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inclusao_protocolo_registro_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE aviso_estouro_classificacao
  ADD CONSTRAINT fk_aviso_estouro_classificacao_classificacao_risco_id FOREIGN KEY (classificacao_risco_id) REFERENCES classificacao_risco (id) ON DELETE RESTRICT;
