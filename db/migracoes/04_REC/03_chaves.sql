-- REC, lote 03: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE dispositivo_recepcao
  ADD CONSTRAINT fk_dispositivo_recepcao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispositivo_recepcao_ponto_recepcao_id FOREIGN KEY (ponto_recepcao_id) REFERENCES ponto_recepcao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispositivo_recepcao_tecnico_usuario_id FOREIGN KEY (tecnico_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE dispositivo_recepcao_local
  ADD CONSTRAINT fk_dispositivo_recepcao_local_dispositivo_recepcao_id FOREIGN KEY (dispositivo_recepcao_id) REFERENCES dispositivo_recepcao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispositivo_recepcao_local_local_atendimento_id FOREIGN KEY (local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE dispositivo_recepcao_gerador
  ADD CONSTRAINT fk_dispositivo_recepcao_gerador_dispositivo_recepcao_id FOREIGN KEY (dispositivo_recepcao_id) REFERENCES dispositivo_recepcao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispositivo_recepcao_gerador_gerador_senha_id FOREIGN KEY (gerador_senha_id) REFERENCES gerador_senha (id) ON DELETE RESTRICT;
ALTER TABLE termo_consentimento_recepcao
  ADD CONSTRAINT fk_termo_consentimento_recepcao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_consentimento_recepcao_termo_consentimento_modelo_id FOREIGN KEY (termo_consentimento_modelo_id) REFERENCES termo_consentimento_modelo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_consentimento_recepcao_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_consentimento_recepcao_senha_emitida_id FOREIGN KEY (senha_emitida_id) REFERENCES senha_emitida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_consentimento_recepcao_tipo_assinante_id FOREIGN KEY (tipo_assinante_id) REFERENCES tipo_assinante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_consentimento_recepcao_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE atendimento_etapa_pa
  ADD CONSTRAINT fk_atendimento_etapa_pa_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_etapa_pa_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
