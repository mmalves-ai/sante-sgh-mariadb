-- SADT, laudo anatomopatológico ligado à descrição cirúrgica que enviou a peça: chave estrangeira (idempotente) do
-- 90_laudo_mama_patologia_tabelas.
ALTER TABLE laudo_anatomopatologico ADD CONSTRAINT fk_laudo_anatomopatologico_descricao_cirurgica_id FOREIGN KEY IF NOT EXISTS (descricao_cirurgica_id) REFERENCES descricao_cirurgica (id) ON DELETE RESTRICT;
