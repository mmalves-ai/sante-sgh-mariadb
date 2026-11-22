-- PEP, lote 16: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE grade_horario_unidade
  ADD CONSTRAINT fk_grade_horario_unidade_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT;
