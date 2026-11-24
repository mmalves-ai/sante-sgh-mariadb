-- PEP, prescrição de enfermagem (família sae-atendimento): chaves estrangeiras (idempotentes) do 96_cuidado_enfermagem_tabelas.

ALTER TABLE atividade_cuidado_enfermagem ADD CONSTRAINT fk_atividade_cuidado_enfermagem_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE atividade_cuidado_enfermagem ADD CONSTRAINT fk_atividade_cuidado_enfermagem_paciente_id FOREIGN KEY IF NOT EXISTS (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT;
ALTER TABLE atividade_cuidado_enfermagem ADD CONSTRAINT fk_atividade_cuidado_enfermagem_atendimento_id FOREIGN KEY IF NOT EXISTS (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT;
ALTER TABLE atividade_cuidado_enfermagem ADD CONSTRAINT fk_atividade_cuidado_enfermagem_processo_enfermagem_id FOREIGN KEY IF NOT EXISTS (processo_enfermagem_id) REFERENCES processo_enfermagem (id) ON DELETE RESTRICT;
ALTER TABLE atividade_cuidado_enfermagem ADD CONSTRAINT fk_atividade_cuidado_enfermagem_plano_intervencao_enfermagem_id FOREIGN KEY IF NOT EXISTS (plano_intervencao_enfermagem_id) REFERENCES plano_intervencao_enfermagem (id) ON DELETE RESTRICT;
ALTER TABLE atividade_cuidado_enfermagem ADD CONSTRAINT fk_atividade_cuidado_enfermagem_prescritor_profissional_id FOREIGN KEY IF NOT EXISTS (prescritor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE atividade_cuidado_enfermagem ADD CONSTRAINT fk_atividade_cuidado_enfermagem_suspensa_por_profissional_id FOREIGN KEY IF NOT EXISTS (suspensa_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE checagem_cuidado_enfermagem ADD CONSTRAINT fk_checagem_cuidado_enfermagem_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE checagem_cuidado_enfermagem ADD CONSTRAINT fk_checagem_cuidado_enfermagem_atendimento_id FOREIGN KEY IF NOT EXISTS (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT;
ALTER TABLE checagem_cuidado_enfermagem ADD CONSTRAINT fk_checagem_cuidado_enfermagem_atividade_cuidado_enfermagem_id FOREIGN KEY IF NOT EXISTS (atividade_cuidado_enfermagem_id) REFERENCES atividade_cuidado_enfermagem (id) ON DELETE RESTRICT;
ALTER TABLE checagem_cuidado_enfermagem ADD CONSTRAINT fk_checagem_cuidado_enfermagem_profissional_id FOREIGN KEY IF NOT EXISTS (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE estorno_checagem_cuidado_enfermagem ADD CONSTRAINT fk_estorno_checagem_cuidado_enfermagem_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE estorno_checagem_cuidado_enfermagem ADD CONSTRAINT fk_estorno_checagem_cuidado_enfermagem_checagem_cuidado_399b6865 FOREIGN KEY IF NOT EXISTS (checagem_cuidado_enfermagem_id) REFERENCES checagem_cuidado_enfermagem (id) ON DELETE RESTRICT;
ALTER TABLE estorno_checagem_cuidado_enfermagem ADD CONSTRAINT fk_estorno_checagem_cuidado_enfermagem_profissional_id FOREIGN KEY IF NOT EXISTS (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
