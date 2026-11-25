-- Suprimentos, chave da faixa da taxa no faturamento do consignado (C1-014, 05-SUP linha 24): só para frente e
-- idempotente, do 93_consignado_taxa_cobranca_tabelas.
ALTER TABLE reposicao_consignada ADD CONSTRAINT fk_reposicao_consignada_taxa_faixa FOREIGN KEY IF NOT EXISTS (taxa_faixa_id) REFERENCES faixa_taxa_consignacao (id) ON DELETE RESTRICT;
