-- Kit de cobrança disparado pelo item (06-FAT linha 16, F3.7, 25/11/2026): só para frente e idempotente (ADR 0002,
-- parte 2). A chave estrangeira do item que dispara o kit.

ALTER TABLE kit_cobranca
  ADD CONSTRAINT fk_kit_cobranca_item_gatilho FOREIGN KEY IF NOT EXISTS (item_gatilho_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
