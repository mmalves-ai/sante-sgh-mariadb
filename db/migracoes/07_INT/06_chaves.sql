-- INT, lote 06: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE limite_permanencia
  ADD CONSTRAINT fk_limite_permanencia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE agendamento_internacao
  ADD CONSTRAINT fk_agendamento_internacao_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_internacao_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE pedido_leito
  ADD CONSTRAINT fk_pedido_leito_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT;
