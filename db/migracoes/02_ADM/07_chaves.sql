-- ADM, lote 07: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE pin_troca_rapida
  ADD CONSTRAINT fk_pin_troca_rapida_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pin_troca_rapida_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
