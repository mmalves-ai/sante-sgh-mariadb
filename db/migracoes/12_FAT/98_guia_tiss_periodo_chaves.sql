-- Lote TISS por período (06-FAT linha 12, C2-035, decisão 58, 27/11/2026): só para frente e idempotente (ADR 0002,
-- parte 2). A chave estrangeira do período da guia.

ALTER TABLE guia_tiss
  ADD CONSTRAINT fk_guia_tiss_conta_hospitalar_periodo_id FOREIGN KEY IF NOT EXISTS (conta_hospitalar_periodo_id) REFERENCES conta_hospitalar_periodo (id) ON DELETE RESTRICT;
