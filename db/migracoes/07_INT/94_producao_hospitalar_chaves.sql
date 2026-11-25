-- Produção hospitalar mensal e valor da categoria clínica (94_producao_hospitalar_tabelas.sql). Só para frente e
-- idempotente.

ALTER TABLE faixa_valor_categoria_clinica ADD CONSTRAINT fk_faixa_valor_categoria_clinica_clinica_assistencial_id FOREIGN KEY IF NOT EXISTS (clinica_assistencial_id) REFERENCES clinica_assistencial (id) ON DELETE RESTRICT;
ALTER TABLE faixa_valor_categoria_clinica ADD CONSTRAINT fk_faixa_valor_categoria_clinica_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE producao_hospitalar_mensal ADD CONSTRAINT fk_producao_hospitalar_mensal_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE producao_hospitalar_mensal ADD CONSTRAINT fk_producao_hospitalar_mensal_clinica_assistencial_id FOREIGN KEY IF NOT EXISTS (clinica_assistencial_id) REFERENCES clinica_assistencial (id) ON DELETE RESTRICT;
