-- AGE, lote 05: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE teleconsulta
  ADD CONSTRAINT fk_teleconsulta_local_paciente_municipio_id FOREIGN KEY (local_paciente_municipio_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
