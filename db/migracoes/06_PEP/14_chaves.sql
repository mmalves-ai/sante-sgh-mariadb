-- PEP, lote 14: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE pedido_numeracao_receita
  ADD CONSTRAINT fk_pedido_numeracao_receita_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE pedido_numeracao_receita
  ADD CONSTRAINT fk_pedido_numeracao_receita_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT;
ALTER TABLE pedido_numeracao_receita
  ADD CONSTRAINT fk_pedido_numeracao_receita_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE balanco_lancamento
  ADD CONSTRAINT fk_balanco_lancamento_horario_administracao_id FOREIGN KEY (horario_administracao_id) REFERENCES horario_administracao (id) ON DELETE RESTRICT;
ALTER TABLE aplicacao_escala
  ADD CONSTRAINT fk_aplicacao_escala_escala_clinica_versao_id FOREIGN KEY (escala_clinica_versao_id) REFERENCES escala_clinica_versao (id) ON DELETE RESTRICT;
ALTER TABLE afericao_valor
  ADD CONSTRAINT fk_afericao_valor_retifica_afericao_valor_id FOREIGN KEY (retifica_afericao_valor_id) REFERENCES afericao_valor (id) ON DELETE RESTRICT;
ALTER TABLE passagem_turno_pendencia
  ADD CONSTRAINT fk_passagem_turno_pendencia_passagem_turno_paciente_id FOREIGN KEY (passagem_turno_paciente_id) REFERENCES passagem_turno_paciente (id) ON DELETE RESTRICT;
ALTER TABLE processo_enfermagem
  ADD CONSTRAINT fk_processo_enfermagem_terminologia_edicao_id FOREIGN KEY (terminologia_edicao_id) REFERENCES terminologia_edicao (id) ON DELETE RESTRICT;
ALTER TABLE emissao_documento
  ADD CONSTRAINT fk_emissao_documento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emissao_documento_original_emissao_documento_id FOREIGN KEY (original_emissao_documento_id) REFERENCES emissao_documento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emissao_documento_autor_usuario_id FOREIGN KEY (autor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
