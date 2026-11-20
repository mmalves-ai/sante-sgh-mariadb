-- Chaves do PEP, lote 12 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE tipo_validacao_dose_unidade
  ADD CONSTRAINT fk_tipo_validacao_dose_unidade_tipo_validacao_dose_id FOREIGN KEY (tipo_validacao_dose_id) REFERENCES tipo_validacao_dose (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_validacao_dose_unidade_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE tratamento_oncologico
  ADD CONSTRAINT fk_tratamento_oncologico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tratamento_oncologico_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tratamento_oncologico_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tratamento_oncologico_diagnostico_oncologico_id FOREIGN KEY (diagnostico_oncologico_id) REFERENCES diagnostico_oncologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tratamento_oncologico_protocolo_quimioterapia_id FOREIGN KEY (protocolo_quimioterapia_id) REFERENCES protocolo_quimioterapia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tratamento_oncologico_tipo_protocolo_oncologico_id FOREIGN KEY (tipo_protocolo_oncologico_id) REFERENCES tipo_protocolo_oncologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tratamento_oncologico_intencao_tratamento_oncologico_id FOREIGN KEY (intencao_tratamento_oncologico_id) REFERENCES intencao_tratamento_oncologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tratamento_oncologico_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tratamento_oncologico_participante_pesquisa_id FOREIGN KEY (participante_pesquisa_id) REFERENCES participante_pesquisa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tratamento_oncologico_ato_cirurgico_id FOREIGN KEY (ato_cirurgico_id) REFERENCES ato_cirurgico (id) ON DELETE RESTRICT;
ALTER TABLE tratamento_radioterapia
  ADD CONSTRAINT fk_tratamento_radioterapia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tratamento_radioterapia_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tratamento_radioterapia_tratamento_oncologico_id FOREIGN KEY (tratamento_oncologico_id) REFERENCES tratamento_oncologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tratamento_radioterapia_diagnostico_oncologico_id FOREIGN KEY (diagnostico_oncologico_id) REFERENCES diagnostico_oncologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tratamento_radioterapia_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tratamento_radioterapia_regiao_irradiada_id FOREIGN KEY (regiao_irradiada_id) REFERENCES regiao_irradiada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tratamento_radioterapia_aparelho_radioterapia_id FOREIGN KEY (aparelho_radioterapia_id) REFERENCES aparelho_radioterapia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tratamento_radioterapia_intencao_tratamento_oncologico_id FOREIGN KEY (intencao_tratamento_oncologico_id) REFERENCES intencao_tratamento_oncologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tratamento_radioterapia_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tratamento_radioterapia_fisico_profissional_id FOREIGN KEY (fisico_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE triagem_elegibilidade_pesquisa
  ADD CONSTRAINT fk_triagem_elegibilidade_pesquisa_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_triagem_elegibilidade_pesquisa_pesquisa_clinica_id FOREIGN KEY (pesquisa_clinica_id) REFERENCES pesquisa_clinica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_triagem_elegibilidade_pesquisa_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_triagem_elegibilidade_pesquisa_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_triagem_elegibilidade_pesquisa_participante_pesquisa_id FOREIGN KEY (participante_pesquisa_id) REFERENCES participante_pesquisa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_triagem_elegibilidade_pesquisa_avaliador_profissional_id FOREIGN KEY (avaliador_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE unidade_infusao
  ADD CONSTRAINT fk_unidade_infusao_tipo_infusao_id FOREIGN KEY (tipo_infusao_id) REFERENCES tipo_infusao (id) ON DELETE RESTRICT;
ALTER TABLE unidade_prescricao
  ADD CONSTRAINT fk_unidade_prescricao_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE unidade_resposta
  ADD CONSTRAINT fk_unidade_resposta_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE vacina_aplicada
  ADD CONSTRAINT fk_vacina_aplicada_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vacina_aplicada_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vacina_aplicada_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vacina_aplicada_imunobiologico_id FOREIGN KEY (imunobiologico_id) REFERENCES imunobiologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vacina_aplicada_vacina_dose_id FOREIGN KEY (vacina_dose_id) REFERENCES vacina_dose (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vacina_aplicada_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vacina_aplicada_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vacina_aplicada_regiao_corporal_id FOREIGN KEY (regiao_corporal_id) REFERENCES regiao_corporal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vacina_aplicada_aplicador_profissional_id FOREIGN KEY (aplicador_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vacina_aplicada_vacina_aplicada_original_id FOREIGN KEY (vacina_aplicada_original_id) REFERENCES vacina_aplicada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vacina_aplicada_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT;
ALTER TABLE vacina_dose
  ADD CONSTRAINT fk_vacina_dose_imunobiologico_id FOREIGN KEY (imunobiologico_id) REFERENCES imunobiologico (id) ON DELETE RESTRICT;
ALTER TABLE variavel_calculo_dose
  ADD CONSTRAINT fk_variavel_calculo_dose_unidade_resposta_id FOREIGN KEY (unidade_resposta_id) REFERENCES unidade_resposta (id) ON DELETE RESTRICT;
ALTER TABLE via_de_uso
  ADD CONSTRAINT fk_via_de_uso_via_tiss_termo_terminologia_id FOREIGN KEY (via_tiss_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE vinculo_supervisao_profissional
  ADD CONSTRAINT fk_vinculo_supervisao_profissional_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_supervisao_profissional_supervisor_profissional_id FOREIGN KEY (supervisor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_supervisao_profissional_supervisionado_id FOREIGN KEY (supervisionado_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
