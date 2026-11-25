-- Suprimentos, chave do movimento que consumiu a etiqueta (C2-024, 05-SUP linha 14): só para frente e idempotente, do
-- 94_etiqueta_consumo_tabelas.
ALTER TABLE etiqueta_identificacao ADD CONSTRAINT fk_etiqueta_identificacao_movimento_consumo FOREIGN KEY IF NOT EXISTS (movimento_consumo_id) REFERENCES movimento_estoque (id) ON DELETE RESTRICT;
