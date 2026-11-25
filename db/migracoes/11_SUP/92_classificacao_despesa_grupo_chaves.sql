-- Suprimentos, chave da classificação de despesa do grupo do insumo (F3.6, 05-SUP linha 3): só para frente e
-- idempotente, do 92_classificacao_despesa_grupo_tabelas.
ALTER TABLE grupo_insumo ADD CONSTRAINT fk_grupo_insumo_classificacao_despesa FOREIGN KEY IF NOT EXISTS (classificacao_despesa_id) REFERENCES classificacao_despesa (id) ON DELETE RESTRICT;
