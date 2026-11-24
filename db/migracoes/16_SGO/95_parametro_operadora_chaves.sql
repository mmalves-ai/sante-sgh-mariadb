-- Operadora, chaves dos parâmetros por operadora (F78.08-1): só para frente e idempotente, do 95_parametro_operadora_tabelas.
ALTER TABLE parametro_operadora ADD CONSTRAINT fk_parametro_operadora_operadora_saude_id FOREIGN KEY IF NOT EXISTS (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT;
