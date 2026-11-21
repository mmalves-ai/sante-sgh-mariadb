-- HOT, lote 7: chaves e sementes (aplicadas depois de todos os tabelas.sql)

-- L6-18 (1)
ALTER TABLE movimento_prontuario
  ADD CONSTRAINT fk_movimento_prontuario_saida_setor_tramite_id FOREIGN KEY (saida_setor_tramite_id) REFERENCES setor_tramite (id) ON DELETE RESTRICT;
ALTER TABLE movimento_prontuario
  ADD CONSTRAINT fk_movimento_prontuario_destino_setor_tramite_id FOREIGN KEY (destino_setor_tramite_id) REFERENCES setor_tramite (id) ON DELETE RESTRICT;
