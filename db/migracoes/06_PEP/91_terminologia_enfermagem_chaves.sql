-- PEP, terminologias de enfermagem por edição (família sae-terminologia): chaves estrangeiras (idempotentes) do
-- 91_terminologia_enfermagem_tabelas. O termo aponta a edição pelo par sistema + edição (a chave única da edição).

ALTER TABLE termo_terminologia_enfermagem ADD CONSTRAINT fk_termo_terminologia_enfermagem_edicao FOREIGN KEY IF NOT EXISTS (sistema, edicao) REFERENCES edicao_terminologia_enfermagem (sistema, edicao) ON DELETE RESTRICT;
ALTER TABLE ligacao_termo_enfermagem ADD CONSTRAINT fk_ligacao_termo_enfermagem_termo_id FOREIGN KEY IF NOT EXISTS (termo_terminologia_enfermagem_id) REFERENCES termo_terminologia_enfermagem (id) ON DELETE RESTRICT;
ALTER TABLE ligacao_termo_enfermagem ADD CONSTRAINT fk_ligacao_termo_enfermagem_superior_id FOREIGN KEY IF NOT EXISTS (superior_termo_terminologia_enfermagem_id) REFERENCES termo_terminologia_enfermagem (id) ON DELETE RESTRICT;
