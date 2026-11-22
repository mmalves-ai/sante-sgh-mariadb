-- SGO, lote 12: chaves e sementes (aplicadas depois de todos os tabelas.sql)

-- L8-13 (4)
ALTER TABLE motivo_movimento_cadastral
  ADD CONSTRAINT fk_motivo_movimento_cadastral_situacao_cadastral_beneficiario_id FOREIGN KEY (situacao_cadastral_beneficiario_id) REFERENCES situacao_cadastral_beneficiario (id) ON DELETE RESTRICT;
