-- Equipe do item da conta (06-FAT linha 15, F3.7, 24/11/2026): só para frente e idempotente (ADR 0002, parte 2).
-- A chave estrangeira da transferência que encerrou o participante no item de origem.

ALTER TABLE conta_hospitalar_item_participante
  ADD CONSTRAINT fk_conta_hospitalar_item_participante_transferencia FOREIGN KEY IF NOT EXISTS (transferencia_conta_id) REFERENCES transferencia_conta (id) ON DELETE RESTRICT;
