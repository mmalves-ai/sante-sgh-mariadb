-- Financeiro, chaves das parcelas enviadas em remessa bancária (F3.8, 07-FIN linha 63): só para frente e idempotente.
ALTER TABLE parcela_remessa_bancaria ADD CONSTRAINT fk_parcela_remessa_bancaria_remessa_bancaria_id FOREIGN KEY IF NOT EXISTS (remessa_bancaria_id) REFERENCES remessa_bancaria (id) ON DELETE RESTRICT;
ALTER TABLE parcela_remessa_bancaria ADD CONSTRAINT fk_parcela_remessa_bancaria_parcela_pagar_id FOREIGN KEY IF NOT EXISTS (parcela_pagar_id) REFERENCES parcela_pagar (id) ON DELETE RESTRICT;
