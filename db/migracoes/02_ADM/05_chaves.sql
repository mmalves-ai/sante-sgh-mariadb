-- ADM, lote 05: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE liberacao_lote
  ADD CONSTRAINT fk_liberacao_lote_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE liberacao_chave
  ADD CONSTRAINT fk_liberacao_chave_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_chave_liberacao_lote_id FOREIGN KEY (liberacao_lote_id) REFERENCES liberacao_lote (id) ON DELETE RESTRICT;
ALTER TABLE recurso_prerequisito
  ADD CONSTRAINT fk_recurso_prerequisito_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE usuario_profissional
  ADD CONSTRAINT fk_usuario_profissional_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_profissional_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE sessao_suporte_acao
  ADD CONSTRAINT fk_sessao_suporte_acao_sessao_suporte_id FOREIGN KEY (sessao_suporte_id) REFERENCES sessao_suporte (id) ON DELETE RESTRICT;
ALTER TABLE sessao_suporte_leitura
  ADD CONSTRAINT fk_sessao_suporte_leitura_sessao_suporte_id FOREIGN KEY (sessao_suporte_id) REFERENCES sessao_suporte (id) ON DELETE RESTRICT;
ALTER TABLE usuario
  ADD CONSTRAINT fk_usuario_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT;
