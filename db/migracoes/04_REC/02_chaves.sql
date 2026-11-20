-- REC, lote 02: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE senha_emitida_marcacao
  ADD CONSTRAINT fk_senha_emitida_marcacao_senha_emitida_id FOREIGN KEY (senha_emitida_id) REFERENCES senha_emitida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_senha_emitida_marcacao_marcacao_horario_id FOREIGN KEY (marcacao_horario_id) REFERENCES marcacao_horario (id) ON DELETE RESTRICT;
ALTER TABLE servico_atendimento
  ADD CONSTRAINT fk_servico_atendimento_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_atendimento_anamnese_modelo_documento_clinico_id FOREIGN KEY (anamnese_modelo_documento_clinico_id) REFERENCES modelo_documento_clinico (id) ON DELETE RESTRICT;
ALTER TABLE valor_padrao_recepcao
  ADD CONSTRAINT fk_valor_padrao_recepcao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_padrao_recepcao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_padrao_recepcao_estacao_trabalho_id FOREIGN KEY (estacao_trabalho_id) REFERENCES estacao_trabalho (id) ON DELETE RESTRICT;
