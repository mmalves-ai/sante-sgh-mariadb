-- Material e medicamento na conta pelo item da tabela de preço (34_tabelas.sql). FK RESTRICT.
ALTER TABLE item_faturavel
  ADD CONSTRAINT fk_item_faturavel_item_referencia_matmed_id FOREIGN KEY IF NOT EXISTS (item_referencia_matmed_id) REFERENCES item_referencia_matmed (id) ON DELETE RESTRICT;
