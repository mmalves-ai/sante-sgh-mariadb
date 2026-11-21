-- ADM, lote 08: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE saneamento_acesso_item
  ADD CONSTRAINT fk_saneamento_acesso_item_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saneamento_acesso_item_perfil_origem_id FOREIGN KEY (perfil_origem_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saneamento_acesso_item_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saneamento_acesso_item_perfil_destino_id FOREIGN KEY (perfil_destino_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saneamento_acesso_item_aprovador_usuario_id FOREIGN KEY (aprovador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE uso_acao_usuario
  ADD CONSTRAINT fk_uso_acao_usuario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_uso_acao_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_uso_acao_usuario_acao_sistema_id FOREIGN KEY (acao_sistema_id) REFERENCES acao_sistema (id) ON DELETE RESTRICT;
ALTER TABLE ciclo_certificacao
  ADD CONSTRAINT fk_ciclo_certificacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciclo_certificacao_aberto_por_usuario_id FOREIGN KEY (aberto_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciclo_certificacao_concluido_por_usuario_id FOREIGN KEY (concluido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE ciclo_certificacao_item
  ADD CONSTRAINT fk_ciclo_certificacao_item_ciclo_certificacao_id FOREIGN KEY (ciclo_certificacao_id) REFERENCES ciclo_certificacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciclo_certificacao_item_avaliado_por_usuario_id FOREIGN KEY (avaliado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciclo_certificacao_item_corrigido_por_usuario_id FOREIGN KEY (corrigido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciclo_certificacao_item_verificado_por_usuario_id FOREIGN KEY (verificado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
