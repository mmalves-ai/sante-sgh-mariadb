-- INT, lote 7: chaves e sementes (aplicadas depois de todos os tabelas.sql)

-- L6-14 (12)
ALTER TABLE acomodacao
  ADD CONSTRAINT fk_acomodacao_local_cobranca_id FOREIGN KEY (local_cobranca_id) REFERENCES local_cobranca (id) ON DELETE RESTRICT;

-- L6-14 (15)
ALTER TABLE ocupacao_leito
  ADD CONSTRAINT fk_ocupacao_leito_categoria_acomodacao_id FOREIGN KEY (categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT;

-- L6-15 (LEITO_CRITICIDADE_AREA)
ALTER TABLE leito_hospitalar
  ADD CONSTRAINT fk_leito_hospitalar_criticidade_area_id FOREIGN KEY (criticidade_area_id) REFERENCES criticidade_area (id) ON DELETE RESTRICT;

-- L6-14 (17) e L6-15 (REGIME_SEMENTE): regime de internação do padrão TISS (semente nativa)
INSERT IGNORE INTO regime_atendimento_internacao (codigo, descricao, codigo_tiss, ativo, criado_em) VALUES
  ('hospitalar', 'Hospitalar', '1', TRUE, CURRENT_TIMESTAMP(3)),
  ('hospital_dia', 'Hospital-dia', '2', TRUE, CURRENT_TIMESTAMP(3)),
  ('domiciliar', 'Domiciliar', '3', TRUE, CURRENT_TIMESTAMP(3));
