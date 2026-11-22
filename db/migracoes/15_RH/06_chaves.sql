-- RH, lote 6: chaves e sementes (aplicadas depois de todos os tabelas.sql)

-- L5-12 (9)
ALTER TABLE justificativa_ponto
  ADD CONSTRAINT fk_justificativa_ponto_mantenedora_id FOREIGN KEY (mantenedora_id) REFERENCES mantenedora (id) ON DELETE RESTRICT;
