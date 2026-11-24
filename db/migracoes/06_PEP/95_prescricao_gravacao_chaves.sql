-- PEP, gravação da prescrição: chaves estrangeiras (idempotentes) do 95_prescricao_gravacao_tabelas.

ALTER TABLE prescricao ADD CONSTRAINT fk_prescricao_coassinatura_profissional_id FOREIGN KEY IF NOT EXISTS (coassinatura_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE grade_horario_classe ADD CONSTRAINT fk_grade_horario_classe_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE grade_horario_classe ADD CONSTRAINT fk_grade_horario_classe_unidade_assistencial_id FOREIGN KEY IF NOT EXISTS (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT;
ALTER TABLE grade_horario_classe ADD CONSTRAINT fk_grade_horario_classe_autor_usuario_id FOREIGN KEY IF NOT EXISTS (autor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE decisao_alerta ADD CONSTRAINT fk_decisao_alerta_prescricao_id FOREIGN KEY IF NOT EXISTS (prescricao_id) REFERENCES prescricao (id) ON DELETE RESTRICT;
