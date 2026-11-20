-- Chaves do lote 06_PEP-09 (aplicadas depois de todos os tabelas.sql). Toda FK com ON DELETE RESTRICT.
ALTER TABLE prescricao_item_solucao_etapa
  ADD CONSTRAINT fk_prescricao_item_solucao_etapa_prescricao_item_solucao_id FOREIGN KEY (prescricao_item_solucao_id) REFERENCES prescricao_item_solucao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_solucao_etapa_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_solucao_etapa_item_nao_padronizado_id FOREIGN KEY (item_nao_padronizado_id) REFERENCES item_nao_padronizado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_solucao_etapa_indicacao_termo_terminologia_id FOREIGN KEY (indicacao_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_solucao_etapa_unidade_prescricao_id FOREIGN KEY (unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_solucao_etapa_formula_calculo_dose_id FOREIGN KEY (formula_calculo_dose_id) REFERENCES formula_calculo_dose (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_solucao_etapa_kit_prescricao_id FOREIGN KEY (kit_prescricao_id) REFERENCES kit_prescricao (id) ON DELETE RESTRICT;
ALTER TABLE prescricao_item_velocidade
  ADD CONSTRAINT fk_prescricao_item_velocidade_prescricao_item_solucao_id FOREIGN KEY (prescricao_item_solucao_id) REFERENCES prescricao_item_solucao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_velocidade_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_velocidade_unidade_infusao_id FOREIGN KEY (unidade_infusao_id) REFERENCES unidade_infusao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_velocidade_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE prescricao_item_ventilacao
  ADD CONSTRAINT fk_prescricao_item_ventilacao_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_ventilacao_via_aerea_id FOREIGN KEY (via_aerea_id) REFERENCES via_aerea (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_ventilacao_modo_ventilatorio_id FOREIGN KEY (modo_ventilatorio_id) REFERENCES modo_ventilatorio (id) ON DELETE RESTRICT;
ALTER TABLE prescricao_lente
  ADD CONSTRAINT fk_prescricao_lente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_lente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_lente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_lente_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_lente_documento_emitido_id FOREIGN KEY (documento_emitido_id) REFERENCES documento_emitido (id) ON DELETE RESTRICT;
ALTER TABLE prescricao_protocolo_aplicado
  ADD CONSTRAINT fk_prescricao_protocolo_aplicado_prescricao_id FOREIGN KEY (prescricao_id) REFERENCES prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_protocolo_aplicado_protocolo_prescricao_id FOREIGN KEY (protocolo_prescricao_id) REFERENCES protocolo_prescricao (id) ON DELETE RESTRICT;
ALTER TABLE prescricao_variavel_calculo
  ADD CONSTRAINT fk_prescricao_variavel_calculo_prescricao_id FOREIGN KEY (prescricao_id) REFERENCES prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_variavel_calculo_formula_calculo_dose_id FOREIGN KEY (formula_calculo_dose_id) REFERENCES formula_calculo_dose (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_variavel_calculo_variavel_calculo_dose_id FOREIGN KEY (variavel_calculo_dose_id) REFERENCES variavel_calculo_dose (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_variavel_calculo_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE problema_paciente
  ADD CONSTRAINT fk_problema_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_problema_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_problema_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_problema_paciente_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_problema_paciente_ciap_termo_terminologia_id FOREIGN KEY (ciap_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_problema_paciente_snomed_termo_terminologia_id FOREIGN KEY (snomed_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_problema_paciente_certeza_diagnostico_id FOREIGN KEY (certeza_diagnostico_id) REFERENCES certeza_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_problema_paciente_presenca_admissao_id FOREIGN KEY (presenca_admissao_id) REFERENCES presenca_admissao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_problema_paciente_registrado_por_profissional_id FOREIGN KEY (registrado_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_problema_paciente_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_problema_paciente_inativado_por_profissional_id FOREIGN KEY (inativado_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE problema_paciente_conduta
  ADD CONSTRAINT fk_problema_paciente_conduta_problema_paciente_id FOREIGN KEY (problema_paciente_id) REFERENCES problema_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_problema_paciente_conduta_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_problema_paciente_conduta_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT;
ALTER TABLE problema_paciente_versao
  ADD CONSTRAINT fk_problema_paciente_versao_problema_paciente_id FOREIGN KEY (problema_paciente_id) REFERENCES problema_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_problema_paciente_versao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_problema_paciente_versao_certeza_diagnostico_id FOREIGN KEY (certeza_diagnostico_id) REFERENCES certeza_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_problema_paciente_versao_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_problema_paciente_versao_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_problema_paciente_versao_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT;
ALTER TABLE processo_enfermagem
  ADD CONSTRAINT fk_processo_enfermagem_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_processo_enfermagem_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_processo_enfermagem_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_processo_enfermagem_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_processo_enfermagem_enfermeiro_profissional_id FOREIGN KEY (enfermeiro_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_processo_enfermagem_afericao_id FOREIGN KEY (afericao_id) REFERENCES afericao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_processo_enfermagem_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT;
ALTER TABLE profilaxia_tev_avaliacao
  ADD CONSTRAINT fk_profilaxia_tev_avaliacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profilaxia_tev_avaliacao_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profilaxia_tev_avaliacao_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profilaxia_tev_avaliacao_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profilaxia_tev_avaliacao_aplicacao_escala_id FOREIGN KEY (aplicacao_escala_id) REFERENCES aplicacao_escala (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profilaxia_tev_avaliacao_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profilaxia_tev_avaliacao_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT;
ALTER TABLE profissional_referencia_paciente
  ADD CONSTRAINT fk_profissional_referencia_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_referencia_paciente_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_referencia_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_referencia_paciente_anterior_profissional_id FOREIGN KEY (anterior_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_referencia_paciente_atual_profissional_id FOREIGN KEY (atual_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE programa_cuidado
  ADD CONSTRAINT fk_programa_cuidado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE programa_cuidado_paciente
  ADD CONSTRAINT fk_programa_cuidado_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_cuidado_paciente_programa_cuidado_id FOREIGN KEY (programa_cuidado_id) REFERENCES programa_cuidado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_cuidado_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_cuidado_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_cuidado_paciente_equipe_referencia_id FOREIGN KEY (equipe_referencia_id) REFERENCES equipe_referencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_cuidado_paciente_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_cuidado_paciente_motivo_permanencia_programa_id FOREIGN KEY (motivo_permanencia_programa_id) REFERENCES motivo_permanencia_programa (id) ON DELETE RESTRICT;
ALTER TABLE programa_cuidado_protocolo
  ADD CONSTRAINT fk_programa_cuidado_protocolo_programa_cuidado_id FOREIGN KEY (programa_cuidado_id) REFERENCES programa_cuidado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_cuidado_protocolo_protocolo_gerenciado_id FOREIGN KEY (protocolo_gerenciado_id) REFERENCES protocolo_gerenciado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_cuidado_protocolo_protocolo_prescricao_id FOREIGN KEY (protocolo_prescricao_id) REFERENCES protocolo_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_cuidado_protocolo_escala_clinica_id FOREIGN KEY (escala_clinica_id) REFERENCES escala_clinica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_cuidado_protocolo_modelo_documento_clinico_id FOREIGN KEY (modelo_documento_clinico_id) REFERENCES modelo_documento_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_cuidado_protocolo_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_classificacao_estabelecimento
  ADD CONSTRAINT fk_protocolo_classificacao_estabelecimento_protocolo_cl_4d6f87a6 FOREIGN KEY (protocolo_classificacao_risco_id) REFERENCES protocolo_classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_classificacao_estabelecimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_classificacao_estabelecimento_unidade_assi_e56f0e6a FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_classificacao_risco_versao
  ADD CONSTRAINT fk_protocolo_classificacao_risco_versao_protocolo_class_4640a5ec FOREIGN KEY (protocolo_classificacao_risco_id) REFERENCES protocolo_classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_classificacao_risco_versao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_classificacao_risco_versao_publicado_por_usuario_id FOREIGN KEY (publicado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_gerenciado
  ADD CONSTRAINT fk_protocolo_gerenciado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_gerenciado_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_gerenciado_criterio
  ADD CONSTRAINT fk_protocolo_gerenciado_criterio_protocolo_gerenciado_id FOREIGN KEY (protocolo_gerenciado_id) REFERENCES protocolo_gerenciado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_gerenciado_criterio_tipo_criterio_clinico_id FOREIGN KEY (tipo_criterio_clinico_id) REFERENCES tipo_criterio_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_gerenciado_criterio_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_gerenciado_criterio_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_gerenciado_criterio_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_gerenciado_criterio_modelo_documento_clinico_id FOREIGN KEY (modelo_documento_clinico_id) REFERENCES modelo_documento_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_gerenciado_criterio_escala_clinica_id FOREIGN KEY (escala_clinica_id) REFERENCES escala_clinica (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_gerenciado_etapa
  ADD CONSTRAINT fk_protocolo_gerenciado_etapa_protocolo_gerenciado_id FOREIGN KEY (protocolo_gerenciado_id) REFERENCES protocolo_gerenciado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_gerenciado_etapa_responsavel_categoria_pro_b9249f14 FOREIGN KEY (responsavel_categoria_profissional_id) REFERENCES categoria_profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_gerenciado_etapa_modelo_documento_clinico_id FOREIGN KEY (modelo_documento_clinico_id) REFERENCES modelo_documento_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_gerenciado_etapa_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_gerenciado_etapa_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_gerenciado_prescricao
  ADD CONSTRAINT fk_protocolo_gerenciado_prescricao_protocolo_gerenciado_id FOREIGN KEY (protocolo_gerenciado_id) REFERENCES protocolo_gerenciado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_gerenciado_prescricao_protocolo_prescricao_id FOREIGN KEY (protocolo_prescricao_id) REFERENCES protocolo_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_gerenciado_prescricao_categoria_profissional_id FOREIGN KEY (categoria_profissional_id) REFERENCES categoria_profissional (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_gerenciado_setor
  ADD CONSTRAINT fk_protocolo_gerenciado_setor_protocolo_gerenciado_id FOREIGN KEY (protocolo_gerenciado_id) REFERENCES protocolo_gerenciado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_gerenciado_setor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_gerenciado_versao
  ADD CONSTRAINT fk_protocolo_gerenciado_versao_protocolo_gerenciado_id FOREIGN KEY (protocolo_gerenciado_id) REFERENCES protocolo_gerenciado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_gerenciado_versao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_prescricao
  ADD CONSTRAINT fk_protocolo_prescricao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_prescricao_autor_profissional_id FOREIGN KEY (autor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_prescricao_protocolo_gerenciado_id FOREIGN KEY (protocolo_gerenciado_id) REFERENCES protocolo_gerenciado (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_prescricao_cid
  ADD CONSTRAINT fk_protocolo_prescricao_cid_protocolo_prescricao_id FOREIGN KEY (protocolo_prescricao_id) REFERENCES protocolo_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_prescricao_cid_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_prescricao_especialidade
  ADD CONSTRAINT fk_protocolo_prescricao_especialidade_protocolo_prescricao_id FOREIGN KEY (protocolo_prescricao_id) REFERENCES protocolo_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_prescricao_especialidade_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_prescricao_item
  ADD CONSTRAINT fk_protocolo_prescricao_item_protocolo_prescricao_id FOREIGN KEY (protocolo_prescricao_id) REFERENCES protocolo_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_prescricao_item_componente_de_protocolo_pr_c359e94a FOREIGN KEY (componente_de_protocolo_prescricao_item_id) REFERENCES protocolo_prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_prescricao_item_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_prescricao_item_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_prescricao_item_executante_setor_funcional_id FOREIGN KEY (executante_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_prescricao_item_unidade_prescricao_id FOREIGN KEY (unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_prescricao_item_formula_calculo_dose_id FOREIGN KEY (formula_calculo_dose_id) REFERENCES formula_calculo_dose (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_prescricao_item_frequencia_administracao_id FOREIGN KEY (frequencia_administracao_id) REFERENCES frequencia_administracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_prescricao_item_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_prescricao_item_unidade_infusao_id FOREIGN KEY (unidade_infusao_id) REFERENCES unidade_infusao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_prescricao_item_volume_total_unidade_prescricao_id FOREIGN KEY (volume_total_unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_prescricao_setor
  ADD CONSTRAINT fk_protocolo_prescricao_setor_protocolo_prescricao_id FOREIGN KEY (protocolo_prescricao_id) REFERENCES protocolo_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_prescricao_setor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_prescricao_sintoma
  ADD CONSTRAINT fk_protocolo_prescricao_sintoma_protocolo_prescricao_id FOREIGN KEY (protocolo_prescricao_id) REFERENCES protocolo_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_prescricao_sintoma_fluxograma_classificaca_9807dd34 FOREIGN KEY (fluxograma_classificacao_risco_id) REFERENCES fluxograma_classificacao_risco (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_quimioterapia
  ADD CONSTRAINT fk_protocolo_quimioterapia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_quimioterapia_tipo_protocolo_oncologico_id FOREIGN KEY (tipo_protocolo_oncologico_id) REFERENCES tipo_protocolo_oncologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_quimioterapia_protocolo_prescricao_id FOREIGN KEY (protocolo_prescricao_id) REFERENCES protocolo_prescricao (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_quimioterapia_droga
  ADD CONSTRAINT fk_protocolo_quimioterapia_droga_protocolo_quimioterapia_id FOREIGN KEY (protocolo_quimioterapia_id) REFERENCES protocolo_quimioterapia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_quimioterapia_droga_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_quimioterapia_droga_unidade_prescricao_id FOREIGN KEY (unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_quimioterapia_droga_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_quimioterapia_droga_diluente_item_prescritivel_id FOREIGN KEY (diluente_item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT;
ALTER TABLE reacao_adversa_evento
  ADD CONSTRAINT fk_reacao_adversa_evento_reacao_adversa_paciente_id FOREIGN KEY (reacao_adversa_paciente_id) REFERENCES reacao_adversa_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_adversa_evento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_adversa_evento_gravidade_reacao_adversa_id FOREIGN KEY (gravidade_reacao_adversa_id) REFERENCES gravidade_reacao_adversa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_adversa_evento_causalidade_reacao_adversa_id FOREIGN KEY (causalidade_reacao_adversa_id) REFERENCES causalidade_reacao_adversa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_adversa_evento_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_adversa_evento_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_adversa_evento_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT;
ALTER TABLE reacao_adversa_paciente
  ADD CONSTRAINT fk_reacao_adversa_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_adversa_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_adversa_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_adversa_paciente_problema_paciente_id FOREIGN KEY (problema_paciente_id) REFERENCES problema_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_adversa_paciente_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_adversa_paciente_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_adversa_paciente_reacao_termo_terminologia_id FOREIGN KEY (reacao_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_adversa_paciente_gravidade_reacao_adversa_id FOREIGN KEY (gravidade_reacao_adversa_id) REFERENCES gravidade_reacao_adversa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_adversa_paciente_causalidade_reacao_adversa_id FOREIGN KEY (causalidade_reacao_adversa_id) REFERENCES causalidade_reacao_adversa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_adversa_paciente_registrado_por_profissional_id FOREIGN KEY (registrado_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_adversa_paciente_avaliado_por_profissional_id FOREIGN KEY (avaliado_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_adversa_paciente_notificacao_incidente_id FOREIGN KEY (notificacao_incidente_id) REFERENCES notificacao_incidente (id) ON DELETE RESTRICT;
ALTER TABLE reacao_tratamento_oncologico
  ADD CONSTRAINT fk_reacao_tratamento_oncologico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_tratamento_oncologico_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_tratamento_oncologico_acompanhamento_oncologico_id FOREIGN KEY (acompanhamento_oncologico_id) REFERENCES acompanhamento_oncologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_tratamento_oncologico_tratamento_oncologico_id FOREIGN KEY (tratamento_oncologico_id) REFERENCES tratamento_oncologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_tratamento_oncologico_ciclo_quimioterapia_id FOREIGN KEY (ciclo_quimioterapia_id) REFERENCES ciclo_quimioterapia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_tratamento_oncologico_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_tratamento_oncologico_reacao_termo_terminologia_id FOREIGN KEY (reacao_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_tratamento_oncologico_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT;
ALTER TABLE receita_medica
  ADD CONSTRAINT fk_receita_medica_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receita_medica_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receita_medica_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receita_medica_prescritor_profissional_id FOREIGN KEY (prescritor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receita_medica_tipo_receita_id FOREIGN KEY (tipo_receita_id) REFERENCES tipo_receita (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receita_medica_suspensa_por_profissional_id FOREIGN KEY (suspensa_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receita_medica_origem_receita_medica_id FOREIGN KEY (origem_receita_medica_id) REFERENCES receita_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receita_medica_documento_emitido_id FOREIGN KEY (documento_emitido_id) REFERENCES documento_emitido (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receita_medica_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT;
ALTER TABLE receita_medica_item
  ADD CONSTRAINT fk_receita_medica_item_receita_medica_id FOREIGN KEY (receita_medica_id) REFERENCES receita_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receita_medica_item_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receita_medica_item_item_nao_padronizado_id FOREIGN KEY (item_nao_padronizado_id) REFERENCES item_nao_padronizado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receita_medica_item_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receita_medica_item_unidade_prescricao_id FOREIGN KEY (unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receita_medica_item_frequencia_administracao_id FOREIGN KEY (frequencia_administracao_id) REFERENCES frequencia_administracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receita_medica_item_duracao_unidade_duracao_tratamento_id FOREIGN KEY (duracao_unidade_duracao_tratamento_id) REFERENCES unidade_duracao_tratamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receita_medica_item_prazo_unidade_duracao_tratamento_id FOREIGN KEY (prazo_unidade_duracao_tratamento_id) REFERENCES unidade_duracao_tratamento (id) ON DELETE RESTRICT;
ALTER TABLE receptor_transplante
  ADD CONSTRAINT fk_receptor_transplante_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receptor_transplante_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receptor_transplante_orgao_transplante_id FOREIGN KEY (orgao_transplante_id) REFERENCES orgao_transplante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receptor_transplante_doador_orgao_id FOREIGN KEY (doador_orgao_id) REFERENCES doador_orgao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receptor_transplante_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT;
ALTER TABLE reclassificacao_risco
  ADD CONSTRAINT fk_reclassificacao_risco_classificacao_risco_id FOREIGN KEY (classificacao_risco_id) REFERENCES classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reclassificacao_risco_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reclassificacao_risco_anterior_nivel_prioridade_id FOREIGN KEY (anterior_nivel_prioridade_id) REFERENCES nivel_prioridade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reclassificacao_risco_novo_nivel_prioridade_id FOREIGN KEY (novo_nivel_prioridade_id) REFERENCES nivel_prioridade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reclassificacao_risco_motivo_reclassificacao_id FOREIGN KEY (motivo_reclassificacao_id) REFERENCES motivo_reclassificacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reclassificacao_risco_fluxograma_classificacao_risco_id FOREIGN KEY (fluxograma_classificacao_risco_id) REFERENCES fluxograma_classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reclassificacao_risco_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reclassificacao_risco_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE reconciliacao_item
  ADD CONSTRAINT fk_reconciliacao_item_reconciliacao_medicamentosa_id FOREIGN KEY (reconciliacao_medicamentosa_id) REFERENCES reconciliacao_medicamentosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reconciliacao_item_medicamento_uso_previo_id FOREIGN KEY (medicamento_uso_previo_id) REFERENCES medicamento_uso_previo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reconciliacao_item_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reconciliacao_item_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT;
ALTER TABLE reconciliacao_medicamentosa
  ADD CONSTRAINT fk_reconciliacao_medicamentosa_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reconciliacao_medicamentosa_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reconciliacao_medicamentosa_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reconciliacao_medicamentosa_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reconciliacao_medicamentosa_farmaceutico_profissional_id FOREIGN KEY (farmaceutico_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reconciliacao_medicamentosa_prescricao_id FOREIGN KEY (prescricao_id) REFERENCES prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reconciliacao_medicamentosa_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT;
