-- INT, lote 05: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE acompanhante_internacao
  ADD CONSTRAINT fk_acompanhante_internacao_pessoa_portaria_id FOREIGN KEY (pessoa_portaria_id) REFERENCES pessoa_portaria (id) ON DELETE RESTRICT;
