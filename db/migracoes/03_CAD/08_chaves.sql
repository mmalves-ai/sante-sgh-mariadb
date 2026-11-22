-- CAD, lote 8: chaves e sementes (aplicadas depois de todos os tabelas.sql)

-- L5-05 (6): lotação por unidade assistencial; descrição do contador
ALTER TABLE lotacao_profissional
  ADD CONSTRAINT fk_lotacao_profissional_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT;

-- L8-15 (20) e L5-03 (3b)
ALTER TABLE pessoa_fisica
  ADD CONSTRAINT fk_pessoa_fisica_causa_obito_termo_terminologia_id FOREIGN KEY (causa_obito_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;

-- L8-17 (1): código HL7 v2 (tabela 0001) do sexo, dado do padrão
UPDATE sexo SET codigo_hl7 = CASE sigla WHEN 'M' THEN 'M' WHEN 'F' THEN 'F' WHEN 'O' THEN 'O' ELSE 'U' END WHERE codigo_hl7 IS NULL;
