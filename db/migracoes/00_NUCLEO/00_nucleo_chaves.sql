-- Chaves do núcleo (aplicadas depois de todos os tabelas.sql)
ALTER TABLE trilha_auditoria
  ADD CONSTRAINT fk_trilha_auditoria_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_trilha_auditoria_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE sequencia_negocio
  ADD CONSTRAINT fk_sequencia_negocio_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE arquivo
  ADD CONSTRAINT fk_arquivo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE pendencia
  ADD CONSTRAINT fk_pendencia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE integracao_mensagem
  ADD CONSTRAINT fk_integracao_mensagem_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE idempotencia_operacao
  ADD CONSTRAINT fk_idempotencia_operacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_idempotencia_operacao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_idempotencia_operacao_trilha_auditoria_id FOREIGN KEY (trilha_auditoria_id) REFERENCES trilha_auditoria (id) ON DELETE RESTRICT;
