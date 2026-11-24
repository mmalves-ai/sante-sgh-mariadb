-- Financeiro, chaves do histórico do vínculo da nota fiscal (06-FAT linha 36): só para frente e idempotente.
ALTER TABLE evento_vinculo_nota_faturamento ADD CONSTRAINT fk_evento_vinculo_nota_faturamento_vinculo FOREIGN KEY IF NOT EXISTS (vinculo_nota_faturamento_id) REFERENCES vinculo_nota_faturamento (id) ON DELETE RESTRICT;
