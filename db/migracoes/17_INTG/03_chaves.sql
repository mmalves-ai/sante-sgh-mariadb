-- INTG, lote 03: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE carga_catalogo
  ADD CONSTRAINT fk_carga_catalogo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_carga_catalogo_aprovada_por_usuario_id FOREIGN KEY (aprovada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_carga_catalogo_encerrada_por_usuario_id FOREIGN KEY (encerrada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE carga_catalogo_linha
  ADD CONSTRAINT fk_carga_catalogo_linha_carga_catalogo_id FOREIGN KEY (carga_catalogo_id) REFERENCES carga_catalogo (id) ON DELETE RESTRICT;
ALTER TABLE licenca_catalogo
  ADD CONSTRAINT fk_licenca_catalogo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_licenca_catalogo_comprovante_arquivo_id FOREIGN KEY (comprovante_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE terminologia_licenca_estabelecimento
  ADD CONSTRAINT fk_terminologia_licenca_estabelecimento_estabelecimento FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_terminologia_licenca_estabelecimento_edicao FOREIGN KEY (terminologia_edicao_id) REFERENCES terminologia_edicao (id) ON DELETE RESTRICT;
ALTER TABLE evento_acesso_portaria
  ADD CONSTRAINT fk_evento_acesso_portaria_terminal_acesso_id FOREIGN KEY (terminal_acesso_id) REFERENCES terminal_acesso (id) ON DELETE RESTRICT;
