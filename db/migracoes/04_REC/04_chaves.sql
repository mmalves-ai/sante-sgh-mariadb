-- REC, lote 4: chaves e sementes (aplicadas depois de todos os tabelas.sql)

-- L6-01 (6): regra de impressão restrita a uma clínica
ALTER TABLE regra_impressao_ficha
  ADD CONSTRAINT fk_regra_impressao_ficha_clinica_assistencial_id FOREIGN KEY (clinica_assistencial_id) REFERENCES clinica_assistencial (id) ON DELETE RESTRICT;
