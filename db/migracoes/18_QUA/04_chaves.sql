-- QUA, lote 04: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE alerta_sanitario_equipamento
  ADD CONSTRAINT fk_alerta_sanitario_equipamento_alerta FOREIGN KEY (alerta_sanitario_id) REFERENCES alerta_sanitario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alerta_sanitario_equipamento_equipamento FOREIGN KEY (equipamento_saude_id) REFERENCES equipamento_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alerta_sanitario_equipamento_os FOREIGN KEY (ordem_servico_manutencao_id) REFERENCES ordem_servico_manutencao (id) ON DELETE RESTRICT;
ALTER TABLE queixa_tecnica_produto
  ADD CONSTRAINT fk_queixa_tecnica_produto_equipamento_saude_id FOREIGN KEY (equipamento_saude_id) REFERENCES equipamento_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_queixa_tecnica_produto_os FOREIGN KEY (ordem_servico_manutencao_id) REFERENCES ordem_servico_manutencao (id) ON DELETE RESTRICT;
