-- Financeiro, chaves da previsão de receita realizada pelo título a receber (07-FIN linha 68): só para frente e idempotente.
ALTER TABLE conciliacao_previsao_realizado ADD CONSTRAINT fk_conciliacao_previsao_realizado_titulo_receber_id FOREIGN KEY IF NOT EXISTS (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT;
