-- PEP, lote 02: chaves estrangeiras (aplicadas depois de todos os tabelas.sql).
ALTER TABLE avaliacao_farmaceutica_item
  ADD CONSTRAINT fk_avaliacao_farmaceutica_item_avaliacao_farmaceutica_id FOREIGN KEY (avaliacao_farmaceutica_id) REFERENCES avaliacao_farmaceutica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_farmaceutica_item_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_farmaceutica_item_substituto_prescricao_item_id FOREIGN KEY (substituto_prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_farmaceutica_item_justificativa_prescricao_item_id FOREIGN KEY (justificativa_prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_farmaceutica_item_liberador_profissional_id FOREIGN KEY (liberador_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE avaliacao_resultado_enfermagem
  ADD CONSTRAINT fk_avaliacao_resultado_enfermagem_diagnostico_enfermagem_pacient FOREIGN KEY (diagnostico_enfermagem_paciente_id) REFERENCES diagnostico_enfermagem_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_resultado_enfermagem_resultado_enfermagem_id FOREIGN KEY (resultado_enfermagem_id) REFERENCES resultado_enfermagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_resultado_enfermagem_escala_resultado_enfermagem_id FOREIGN KEY (escala_resultado_enfermagem_id) REFERENCES escala_resultado_enfermagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_resultado_enfermagem_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_resultado_enfermagem_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_resultado_enfermagem_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT;
ALTER TABLE aviso_clinico
  ADD CONSTRAINT fk_aviso_clinico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_clinico_regra_alerta_id FOREIGN KEY (regra_alerta_id) REFERENCES regra_alerta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_clinico_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_clinico_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_clinico_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_clinico_resultado_exame_id FOREIGN KEY (resultado_exame_id) REFERENCES resultado_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_clinico_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_clinico_resolvido_usuario_id FOREIGN KEY (resolvido_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE aviso_clinico_destinatario
  ADD CONSTRAINT fk_aviso_clinico_destinatario_aviso_clinico_id FOREIGN KEY (aviso_clinico_id) REFERENCES aviso_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_clinico_destinatario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_clinico_destinatario_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_clinico_destinatario_equipe_profissional_id FOREIGN KEY (equipe_profissional_id) REFERENCES equipe_profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_clinico_destinatario_papel_seguranca_id FOREIGN KEY (papel_seguranca_id) REFERENCES papel_seguranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_clinico_destinatario_lido_usuario_id FOREIGN KEY (lido_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE balanco_hidrico_paciente
  ADD CONSTRAINT fk_balanco_hidrico_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_balanco_hidrico_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_balanco_hidrico_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_balanco_hidrico_paciente_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_balanco_hidrico_paciente_configuracao_balanco_setor_id FOREIGN KEY (configuracao_balanco_setor_id) REFERENCES configuracao_balanco_setor (id) ON DELETE RESTRICT;
ALTER TABLE balanco_lancamento
  ADD CONSTRAINT fk_balanco_lancamento_balanco_hidrico_paciente_id FOREIGN KEY (balanco_hidrico_paciente_id) REFERENCES balanco_hidrico_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_balanco_lancamento_grupo_balanco_hidrico_id FOREIGN KEY (grupo_balanco_hidrico_id) REFERENCES grupo_balanco_hidrico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_balanco_lancamento_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_balanco_lancamento_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_balanco_lancamento_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_balanco_lancamento_afericao_id FOREIGN KEY (afericao_id) REFERENCES afericao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_balanco_lancamento_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_balanco_lancamento_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_balanco_lancamento_estornado_balanco_lancamento_id FOREIGN KEY (estornado_balanco_lancamento_id) REFERENCES balanco_lancamento (id) ON DELETE RESTRICT;
ALTER TABLE balanco_fechamento
  ADD CONSTRAINT fk_balanco_fechamento_balanco_hidrico_paciente_id FOREIGN KEY (balanco_hidrico_paciente_id) REFERENCES balanco_hidrico_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_balanco_fechamento_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_balanco_fechamento_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT;
ALTER TABLE boletim_informativo
  ADD CONSTRAINT fk_boletim_informativo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_boletim_informativo_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_boletim_informativo_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_boletim_informativo_autor_profissional_id FOREIGN KEY (autor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_boletim_informativo_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT;
ALTER TABLE cabecalho_impressao_documento
  ADD CONSTRAINT fk_cabecalho_impressao_documento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cabecalho_impressao_documento_tipo_documento_clinico_id FOREIGN KEY (tipo_documento_clinico_id) REFERENCES tipo_documento_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cabecalho_impressao_documento_logotipo_arquivo_id FOREIGN KEY (logotipo_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE calendario_vacinal
  ADD CONSTRAINT fk_calendario_vacinal_imunobiologico_id FOREIGN KEY (imunobiologico_id) REFERENCES imunobiologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_calendario_vacinal_faixa_etaria_id FOREIGN KEY (faixa_etaria_id) REFERENCES faixa_etaria (id) ON DELETE RESTRICT;
ALTER TABLE campo_autopreenchido_prescricao
  ADD CONSTRAINT fk_campo_autopreenchido_prescricao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_campo_autopreenchido_prescricao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE captura_monitor_setor
  ADD CONSTRAINT fk_captura_monitor_setor_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_captura_monitor_setor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_captura_monitor_setor_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_captura_monitor_setor_equipamento_saude_id FOREIGN KEY (equipamento_saude_id) REFERENCES equipamento_saude (id) ON DELETE RESTRICT;
ALTER TABLE caracteristica_diagnostico_enfermagem
  ADD CONSTRAINT fk_caracteristica_diagnostico_enfermagem_grupo_caracteristica_en FOREIGN KEY (grupo_caracteristica_enfermagem_id) REFERENCES grupo_caracteristica_enfermagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caracteristica_diagnostico_enfermagem_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE categoria_alergeno
  ADD CONSTRAINT fk_categoria_alergeno_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE ciclo_quimioterapia
  ADD CONSTRAINT fk_ciclo_quimioterapia_tratamento_oncologico_id FOREIGN KEY (tratamento_oncologico_id) REFERENCES tratamento_oncologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciclo_quimioterapia_prescricao_id FOREIGN KEY (prescricao_id) REFERENCES prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciclo_quimioterapia_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT;
ALTER TABLE ciencia_resultado_critico
  ADD CONSTRAINT fk_ciencia_resultado_critico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciencia_resultado_critico_resultado_exame_id FOREIGN KEY (resultado_exame_id) REFERENCES resultado_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciencia_resultado_critico_aviso_valor_critico_id FOREIGN KEY (aviso_valor_critico_id) REFERENCES aviso_valor_critico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciencia_resultado_critico_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciencia_resultado_critico_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciencia_resultado_critico_comunicante_usuario_id FOREIGN KEY (comunicante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciencia_resultado_critico_ciente_profissional_id FOREIGN KEY (ciente_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE classe_diagnostico_enfermagem
  ADD CONSTRAINT fk_classe_diagnostico_enfermagem_superior_classe_diagnostico_enf FOREIGN KEY (superior_classe_diagnostico_enfermagem_id) REFERENCES classe_diagnostico_enfermagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classe_diagnostico_enfermagem_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE classificacao_risco
  ADD CONSTRAINT fk_classificacao_risco_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_risco_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_risco_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_risco_senha_emitida_id FOREIGN KEY (senha_emitida_id) REFERENCES senha_emitida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_risco_protocolo_classificacao_risco_versao_id FOREIGN KEY (protocolo_classificacao_risco_versao_id) REFERENCES protocolo_classificacao_risco_versao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_risco_fluxograma_classificacao_risco_id FOREIGN KEY (fluxograma_classificacao_risco_id) REFERENCES fluxograma_classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_risco_decisivo_discriminador_classificacao_risc FOREIGN KEY (decisivo_discriminador_classificacao_risco_id) REFERENCES discriminador_classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_risco_proposto_nivel_prioridade_id FOREIGN KEY (proposto_nivel_prioridade_id) REFERENCES nivel_prioridade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_risco_nivel_prioridade_id FOREIGN KEY (nivel_prioridade_id) REFERENCES nivel_prioridade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_risco_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_risco_classificador_profissional_id FOREIGN KEY (classificador_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_risco_estacao_trabalho_id FOREIGN KEY (estacao_trabalho_id) REFERENCES estacao_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_risco_anterior_classificacao_risco_id FOREIGN KEY (anterior_classificacao_risco_id) REFERENCES classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_risco_motivo_reclassificacao_id FOREIGN KEY (motivo_reclassificacao_id) REFERENCES motivo_reclassificacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_risco_motivo_cancelamento_classificacao_id FOREIGN KEY (motivo_cancelamento_classificacao_id) REFERENCES motivo_cancelamento_classificacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_risco_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT;
ALTER TABLE classificacao_risco_afericao
  ADD CONSTRAINT fk_classificacao_risco_afericao_classificacao_risco_id FOREIGN KEY (classificacao_risco_id) REFERENCES classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_risco_afericao_afericao_id FOREIGN KEY (afericao_id) REFERENCES afericao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_risco_afericao_parametro_vital_id FOREIGN KEY (parametro_vital_id) REFERENCES parametro_vital (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_risco_afericao_fator_interferencia_sinal_vital_ FOREIGN KEY (fator_interferencia_sinal_vital_id) REFERENCES fator_interferencia_sinal_vital (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_risco_afericao_pergunta_pre_classificacao_id FOREIGN KEY (pergunta_pre_classificacao_id) REFERENCES pergunta_pre_classificacao (id) ON DELETE RESTRICT;
ALTER TABLE classificacao_risco_evento
  ADD CONSTRAINT fk_classificacao_risco_evento_classificacao_risco_id FOREIGN KEY (classificacao_risco_id) REFERENCES classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_risco_evento_tipo_evento_tempo_id FOREIGN KEY (tipo_evento_tempo_id) REFERENCES tipo_evento_tempo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_risco_evento_estacao_trabalho_id FOREIGN KEY (estacao_trabalho_id) REFERENCES estacao_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_risco_evento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE classificacao_risco_intervencao
  ADD CONSTRAINT fk_classificacao_risco_intervencao_classificacao_risco_id FOREIGN KEY (classificacao_risco_id) REFERENCES classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_risco_intervencao_intervencao_salva_vidas_id FOREIGN KEY (intervencao_salva_vidas_id) REFERENCES intervencao_salva_vidas (id) ON DELETE RESTRICT;
ALTER TABLE classificacao_risco_recurso
  ADD CONSTRAINT fk_classificacao_risco_recurso_classificacao_risco_id FOREIGN KEY (classificacao_risco_id) REFERENCES classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_risco_recurso_recurso_previsto_urgencia_id FOREIGN KEY (recurso_previsto_urgencia_id) REFERENCES recurso_previsto_urgencia (id) ON DELETE RESTRICT;
ALTER TABLE classificacao_risco_resposta
  ADD CONSTRAINT fk_classificacao_risco_resposta_classificacao_risco_id FOREIGN KEY (classificacao_risco_id) REFERENCES classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_risco_resposta_discriminador_classificacao_risc FOREIGN KEY (discriminador_classificacao_risco_id) REFERENCES discriminador_classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_risco_resposta_pergunta_pre_classificacao_id FOREIGN KEY (pergunta_pre_classificacao_id) REFERENCES pergunta_pre_classificacao (id) ON DELETE RESTRICT;
ALTER TABLE classificacao_risco_situacao_alto_risco
  ADD CONSTRAINT fk_classificacao_risco_situacao_alto_risco_classificacao_risco_i FOREIGN KEY (classificacao_risco_id) REFERENCES classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_risco_situacao_alto_risco_situacao_alto_risco_i FOREIGN KEY (situacao_alto_risco_id) REFERENCES situacao_alto_risco (id) ON DELETE RESTRICT;
ALTER TABLE classificador_habilitado
  ADD CONSTRAINT fk_classificador_habilitado_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificador_habilitado_protocolo_classificacao_risco_id FOREIGN KEY (protocolo_classificacao_risco_id) REFERENCES protocolo_classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificador_habilitado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificador_habilitado_certificado_arquivo_id FOREIGN KEY (certificado_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE compatibilidade_endovenosa
  ADD CONSTRAINT fk_compatibilidade_endovenosa_principio_ativo_id FOREIGN KEY (principio_ativo_id) REFERENCES principio_ativo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_compatibilidade_endovenosa_par_principio_ativo_id FOREIGN KEY (par_principio_ativo_id) REFERENCES principio_ativo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_compatibilidade_endovenosa_diluente_item_prescritivel_id FOREIGN KEY (diluente_item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT;
ALTER TABLE componente_sumario_alta
  ADD CONSTRAINT fk_componente_sumario_alta_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_componente_sumario_alta_modelo_documento_clinico_id FOREIGN KEY (modelo_documento_clinico_id) REFERENCES modelo_documento_clinico (id) ON DELETE RESTRICT;
ALTER TABLE condicao_cronica
  ADD CONSTRAINT fk_condicao_cronica_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE condicao_se_necessario
  ADD CONSTRAINT fk_condicao_se_necessario_parametro_vital_id FOREIGN KEY (parametro_vital_id) REFERENCES parametro_vital (id) ON DELETE RESTRICT;
ALTER TABLE configuracao_alerta_prescricao
  ADD CONSTRAINT fk_configuracao_alerta_prescricao_regra_alerta_id FOREIGN KEY (regra_alerta_id) REFERENCES regra_alerta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_alerta_prescricao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_alerta_prescricao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_alerta_prescricao_gatilho_item_prescritivel_id FOREIGN KEY (gatilho_item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT;
ALTER TABLE configuracao_balanco_setor
  ADD CONSTRAINT fk_configuracao_balanco_setor_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_balanco_setor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_balanco_setor_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE configuracao_impressao_prescricao
  ADD CONSTRAINT fk_configuracao_impressao_prescricao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_impressao_prescricao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_impressao_prescricao_cabecalho_impressao_documen FOREIGN KEY (cabecalho_impressao_documento_id) REFERENCES cabecalho_impressao_documento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_impressao_prescricao_impressora_id FOREIGN KEY (impressora_id) REFERENCES impressora (id) ON DELETE RESTRICT;
ALTER TABLE configuracao_nota_soap
  ADD CONSTRAINT fk_configuracao_nota_soap_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_nota_soap_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_nota_soap_modelo_documento_clinico_id FOREIGN KEY (modelo_documento_clinico_id) REFERENCES modelo_documento_clinico (id) ON DELETE RESTRICT;
ALTER TABLE configuracao_prontuario_restrito
  ADD CONSTRAINT fk_configuracao_prontuario_restrito_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_prontuario_restrito_autorizador_papel_seguranca_ FOREIGN KEY (autorizador_papel_seguranca_id) REFERENCES papel_seguranca (id) ON DELETE RESTRICT;
ALTER TABLE configuracao_setor_prontuario
  ADD CONSTRAINT fk_configuracao_setor_prontuario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_setor_prontuario_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_setor_prontuario_evolucao_medica_modelo_document FOREIGN KEY (evolucao_medica_modelo_documento_clinico_id) REFERENCES modelo_documento_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_setor_prontuario_evolucao_enfermagem_modelo_docu FOREIGN KEY (evolucao_enfermagem_modelo_documento_clinico_id) REFERENCES modelo_documento_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_setor_prontuario_admissao_modelo_documento_clini FOREIGN KEY (admissao_modelo_documento_clinico_id) REFERENCES modelo_documento_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_setor_prontuario_sintese_modelo_documento_clinic FOREIGN KEY (sintese_modelo_documento_clinico_id) REFERENCES modelo_documento_clinico (id) ON DELETE RESTRICT;
ALTER TABLE contencao_paciente
  ADD CONSTRAINT fk_contencao_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contencao_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contencao_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contencao_paciente_prescritor_profissional_id FOREIGN KEY (prescritor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contencao_paciente_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contencao_paciente_retirada_profissional_id FOREIGN KEY (retirada_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contencao_paciente_anterior_contencao_paciente_id FOREIGN KEY (anterior_contencao_paciente_id) REFERENCES contencao_paciente (id) ON DELETE RESTRICT;
