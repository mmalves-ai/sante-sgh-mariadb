-- CAD, lote 05: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE profissional_ocupacao
  ADD CONSTRAINT fk_profissional_ocupacao_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_ocupacao_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT;
