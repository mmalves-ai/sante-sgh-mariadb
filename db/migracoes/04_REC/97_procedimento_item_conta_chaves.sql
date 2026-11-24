-- Chave do procedimento extra da ficha para o item da conta (F3.2, 02-REC linha 30). Idempotente.
ALTER TABLE atendimento_procedimento
  ADD CONSTRAINT fk_atendimento_procedimento_conta_hospitalar_item_id FOREIGN KEY IF NOT EXISTS (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT;
