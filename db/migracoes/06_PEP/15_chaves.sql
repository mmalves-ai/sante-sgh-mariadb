-- PEP, lote 15: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE acompanhamento_terapia_nutricional
  ADD CONSTRAINT fk_acompanhamento_terapia_nutricional_terapia FOREIGN KEY (terapia_nutricional_id) REFERENCES terapia_nutricional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acompanhamento_terapia_nutricional_profissional FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acompanhamento_terapia_nutricional_substitui FOREIGN KEY (substitui_id) REFERENCES acompanhamento_terapia_nutricional (id) ON DELETE RESTRICT;
ALTER TABLE registro_social
  ADD CONSTRAINT fk_registro_social_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_social_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_social_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_social_barreira_alta_id FOREIGN KEY (barreira_alta_id) REFERENCES barreira_alta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_social_adendo_registro_social_id FOREIGN KEY (adendo_registro_social_id) REFERENCES registro_social (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_social_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE correcao_registro_nutricao
  ADD CONSTRAINT fk_correcao_registro_nutricao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_correcao_registro_nutricao_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_correcao_registro_nutricao_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE avaliacao_nutricao_parenteral
  ADD CONSTRAINT fk_avaliacao_nutricao_parenteral_terapia FOREIGN KEY (terapia_nutricional_id) REFERENCES terapia_nutricional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_nutricao_parenteral_profissional FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
