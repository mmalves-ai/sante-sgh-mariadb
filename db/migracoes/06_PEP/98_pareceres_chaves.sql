-- PEP, documentos (família pareceres): chaves estrangeiras (idempotentes) do 98_pareceres_tabelas.

ALTER TABLE sumario_alta ADD CONSTRAINT fk_sumario_alta_registrado_usuario_id FOREIGN KEY IF NOT EXISTS (registrado_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE ciencia_resultado_critico ADD CONSTRAINT fk_ciencia_resultado_critico_ciente_usuario_id FOREIGN KEY IF NOT EXISTS (ciente_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE relatorio_transferencia ADD CONSTRAINT fk_relatorio_transferencia_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE relatorio_transferencia ADD CONSTRAINT fk_relatorio_transferencia_paciente_id FOREIGN KEY IF NOT EXISTS (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT;
ALTER TABLE relatorio_transferencia ADD CONSTRAINT fk_relatorio_transferencia_atendimento_id FOREIGN KEY IF NOT EXISTS (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT;
ALTER TABLE relatorio_transferencia ADD CONSTRAINT fk_relatorio_transferencia_profissional_id FOREIGN KEY IF NOT EXISTS (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE relatorio_transferencia ADD CONSTRAINT fk_relatorio_transferencia_usuario_id FOREIGN KEY IF NOT EXISTS (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE relatorio_transferencia ADD CONSTRAINT fk_relatorio_transferencia_inscricao_conselho_id FOREIGN KEY IF NOT EXISTS (inscricao_conselho_id) REFERENCES inscricao_conselho (id) ON DELETE RESTRICT;
ALTER TABLE relatorio_transferencia ADD CONSTRAINT fk_relatorio_transferencia_documento_prontuario_id FOREIGN KEY IF NOT EXISTS (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT;
