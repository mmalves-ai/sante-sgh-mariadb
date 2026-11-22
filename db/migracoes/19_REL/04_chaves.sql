-- REL, lote 4: chaves e sementes (aplicadas depois de todos os tabelas.sql)

-- L8-18 (6, 11)
ALTER TABLE relatorio_tela
  ADD CONSTRAINT fk_relatorio_tela_agrupamento_relatorio_id FOREIGN KEY (agrupamento_relatorio_id) REFERENCES agrupamento_relatorio (id) ON DELETE RESTRICT;
