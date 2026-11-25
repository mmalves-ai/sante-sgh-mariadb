-- Financeiro e suprimentos, NF-e de saída de mercadoria (C2-059, 07-FIN linha 114, 25/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). A NF-e que nasce da devolução ao fornecedor (inclusive a devolução do consignado)
-- guarda a devolução de origem: a devolução ganha no máximo uma nota ativa (a regra é do domínio e da porta; o banco só
-- guarda a ligação). A nota rejeitada ou cancelada continua ligada, no histórico.
ALTER TABLE nota_mercadoria
  ADD COLUMN IF NOT EXISTS devolucao_fornecedor_id BIGINT UNSIGNED NULL
    COMMENT 'Devolução ao fornecedor que originou a nota' AFTER nota_entrada_id;
CREATE INDEX IF NOT EXISTS ix_nota_mercadoria_devolucao_fornecedor ON nota_mercadoria (devolucao_fornecedor_id);
ALTER TABLE nota_mercadoria ADD CONSTRAINT fk_nota_mercadoria_devolucao_fornecedor_id
  FOREIGN KEY IF NOT EXISTS (devolucao_fornecedor_id) REFERENCES devolucao_fornecedor (id) ON DELETE RESTRICT;
