-- Chave da referência do empenho no título a pagar (C3-025, 07-FIN linha 132): só para frente e idempotente.
ALTER TABLE titulo_pagar ADD CONSTRAINT fk_titulo_pagar_empenho_id FOREIGN KEY IF NOT EXISTS (empenho_id) REFERENCES empenho (id) ON DELETE RESTRICT;
