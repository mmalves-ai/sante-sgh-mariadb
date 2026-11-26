-- Chave da cobrança no item da remessa de desconto em folha (C3-028, 08-SGO linha 97): só para frente e idempotente.
ALTER TABLE remessa_desconto_folha_item ADD CONSTRAINT fk_remessa_desconto_folha_item_fatura_plano_id FOREIGN KEY IF NOT EXISTS (fatura_plano_id) REFERENCES fatura_plano (id) ON DELETE RESTRICT;
