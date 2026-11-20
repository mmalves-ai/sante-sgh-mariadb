-- Chaves do módulo PEP, lote 08 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE parametro_vital_posicao_afericao
  ADD CONSTRAINT fk_parametro_vital_posicao_afericao_parametro_vital_id FOREIGN KEY (parametro_vital_id) REFERENCES parametro_vital (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parametro_vital_posicao_afericao_posicao_afericao_id FOREIGN KEY (posicao_afericao_id) REFERENCES posicao_afericao (id) ON DELETE RESTRICT;
ALTER TABLE parametro_vital_setor
  ADD CONSTRAINT fk_parametro_vital_setor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parametro_vital_setor_parametro_vital_id FOREIGN KEY (parametro_vital_id) REFERENCES parametro_vital (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parametro_vital_setor_grupo_parametro_vital_id FOREIGN KEY (grupo_parametro_vital_id) REFERENCES grupo_parametro_vital (id) ON DELETE RESTRICT;
ALTER TABLE parecer_padrao_auditoria_antimicrobiano
  ADD CONSTRAINT fk_parecer_padrao_auditoria_antimicrobiano_antimicrobiano_id FOREIGN KEY (antimicrobiano_id) REFERENCES antimicrobiano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parecer_padrao_auditoria_antimicrobiano_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE participante_pesquisa
  ADD CONSTRAINT fk_participante_pesquisa_pesquisa_clinica_id FOREIGN KEY (pesquisa_clinica_id) REFERENCES pesquisa_clinica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_participante_pesquisa_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_participante_pesquisa_termo_consentimento_arquivo_id FOREIGN KEY (termo_consentimento_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_participante_pesquisa_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE participante_pesquisa_evento
  ADD CONSTRAINT fk_participante_pesquisa_evento_participante_pesquisa_id FOREIGN KEY (participante_pesquisa_id) REFERENCES participante_pesquisa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_participante_pesquisa_evento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE partograma
  ADD CONSTRAINT fk_partograma_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_partograma_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_partograma_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_partograma_tipo_parto_id FOREIGN KEY (tipo_parto_id) REFERENCES tipo_parto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_partograma_motivo_parto_cirurgico_id FOREIGN KEY (motivo_parto_cirurgico_id) REFERENCES motivo_parto_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_partograma_tipo_anestesia_id FOREIGN KEY (tipo_anestesia_id) REFERENCES tipo_anestesia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_partograma_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE partograma_registro
  ADD CONSTRAINT fk_partograma_registro_partograma_id FOREIGN KEY (partograma_id) REFERENCES partograma (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_partograma_registro_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE passagem_turno
  ADD CONSTRAINT fk_passagem_turno_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_passagem_turno_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_passagem_turno_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_passagem_turno_turno_padrao_id FOREIGN KEY (turno_padrao_id) REFERENCES turno_padrao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_passagem_turno_entrega_profissional_id FOREIGN KEY (entrega_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_passagem_turno_recebe_profissional_id FOREIGN KEY (recebe_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_passagem_turno_cancelamento_profissional_id FOREIGN KEY (cancelamento_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE passagem_turno_paciente
  ADD CONSTRAINT fk_passagem_turno_paciente_passagem_turno_id FOREIGN KEY (passagem_turno_id) REFERENCES passagem_turno (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_passagem_turno_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_passagem_turno_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_passagem_turno_paciente_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT;
ALTER TABLE pedido_acesso_prontuario_restrito
  ADD CONSTRAINT fk_pedido_acesso_prontuario_restrito_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_acesso_prontuario_restrito_restricao_prontuario_id FOREIGN KEY (restricao_prontuario_id) REFERENCES restricao_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_acesso_prontuario_restrito_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_acesso_prontuario_restrito_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_acesso_prontuario_restrito_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_acesso_prontuario_restrito_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_acesso_prontuario_restrito_motivo_acesso_pron_d3db5c21 FOREIGN KEY (motivo_acesso_prontuario_restrito_id) REFERENCES motivo_acesso_prontuario_restrito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_acesso_prontuario_restrito_decisor_usuario_id FOREIGN KEY (decisor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE pendencia_assinatura
  ADD CONSTRAINT fk_pendencia_assinatura_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_assinatura_tipo_documento_clinico_id FOREIGN KEY (tipo_documento_clinico_id) REFERENCES tipo_documento_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_assinatura_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_assinatura_assinante_profissional_id FOREIGN KEY (assinante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_assinatura_assinante_usuario_id FOREIGN KEY (assinante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_assinatura_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_assinatura_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_assinatura_documento_assinado_id FOREIGN KEY (documento_assinado_id) REFERENCES documento_assinado (id) ON DELETE RESTRICT;
ALTER TABLE pendencia_sala_atendimento
  ADD CONSTRAINT fk_pendencia_sala_atendimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_sala_atendimento_local_atendimento_id FOREIGN KEY (local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_sala_atendimento_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_sala_atendimento_classificacao_risco_id FOREIGN KEY (classificacao_risco_id) REFERENCES classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_sala_atendimento_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_sala_atendimento_horario_administracao_id FOREIGN KEY (horario_administracao_id) REFERENCES horario_administracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_sala_atendimento_executor_profissional_id FOREIGN KEY (executor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE perfil_lista_atendimento
  ADD CONSTRAINT fk_perfil_lista_atendimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_lista_atendimento_dono_usuario_id FOREIGN KEY (dono_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE perfil_lista_atendimento_criterio
  ADD CONSTRAINT fk_perfil_lista_atendimento_criterio_perfil_lista_atendimento_id FOREIGN KEY (perfil_lista_atendimento_id) REFERENCES perfil_lista_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_lista_atendimento_criterio_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_lista_atendimento_criterio_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_lista_atendimento_criterio_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_lista_atendimento_criterio_origem_entrada_ate_242cd119 FOREIGN KEY (origem_entrada_atendimento_id) REFERENCES origem_entrada_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_lista_atendimento_criterio_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_lista_atendimento_criterio_servico_atendimento_id FOREIGN KEY (servico_atendimento_id) REFERENCES servico_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_lista_atendimento_criterio_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_lista_atendimento_criterio_etapa_fluxo_paciente_id FOREIGN KEY (etapa_fluxo_paciente_id) REFERENCES etapa_fluxo_paciente (id) ON DELETE RESTRICT;
ALTER TABLE pergunta_pre_classificacao
  ADD CONSTRAINT fk_pergunta_pre_classificacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE pesquisa_clinica
  ADD CONSTRAINT fk_pesquisa_clinica_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pesquisa_clinica_patrocinador_pessoa_juridica_id FOREIGN KEY (patrocinador_pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pesquisa_clinica_investigador_principal_profissional_id FOREIGN KEY (investigador_principal_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE pesquisa_clinica_criterio
  ADD CONSTRAINT fk_pesquisa_clinica_criterio_pesquisa_clinica_id FOREIGN KEY (pesquisa_clinica_id) REFERENCES pesquisa_clinica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pesquisa_clinica_criterio_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pesquisa_clinica_criterio_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pesquisa_clinica_criterio_parametro_vital_id FOREIGN KEY (parametro_vital_id) REFERENCES parametro_vital (id) ON DELETE RESTRICT;
ALTER TABLE pesquisa_clinica_equipe
  ADD CONSTRAINT fk_pesquisa_clinica_equipe_pesquisa_clinica_id FOREIGN KEY (pesquisa_clinica_id) REFERENCES pesquisa_clinica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pesquisa_clinica_equipe_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE planejamento_prescricao
  ADD CONSTRAINT fk_planejamento_prescricao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_planejamento_prescricao_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_planejamento_prescricao_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_planejamento_prescricao_prescricao_id FOREIGN KEY (prescricao_id) REFERENCES prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_planejamento_prescricao_prescritor_profissional_id FOREIGN KEY (prescritor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_planejamento_prescricao_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_planejamento_prescricao_local_assistencia_id FOREIGN KEY (local_assistencia_id) REFERENCES local_assistencia (id) ON DELETE RESTRICT;
ALTER TABLE plano_cuidado
  ADD CONSTRAINT fk_plano_cuidado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_cuidado_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_cuidado_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_cuidado_programa_cuidado_paciente_id FOREIGN KEY (programa_cuidado_paciente_id) REFERENCES programa_cuidado_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_cuidado_modelo_plano_cuidado_id FOREIGN KEY (modelo_plano_cuidado_id) REFERENCES modelo_plano_cuidado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_cuidado_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_cuidado_fechamento_usuario_id FOREIGN KEY (fechamento_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE plano_cuidado_acao
  ADD CONSTRAINT fk_plano_cuidado_acao_plano_cuidado_id FOREIGN KEY (plano_cuidado_id) REFERENCES plano_cuidado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_cuidado_acao_superior_plano_cuidado_acao_id FOREIGN KEY (superior_plano_cuidado_acao_id) REFERENCES plano_cuidado_acao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_cuidado_acao_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_cuidado_acao_intervencao_enfermagem_id FOREIGN KEY (intervencao_enfermagem_id) REFERENCES intervencao_enfermagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_cuidado_acao_unidade_prescricao_id FOREIGN KEY (unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_cuidado_acao_frequencia_administracao_id FOREIGN KEY (frequencia_administracao_id) REFERENCES frequencia_administracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_cuidado_acao_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_cuidado_acao_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE plano_intervencao_enfermagem
  ADD CONSTRAINT fk_plano_intervencao_enfermagem_diagnostico_enfermagem__98fab4db FOREIGN KEY (diagnostico_enfermagem_paciente_id) REFERENCES diagnostico_enfermagem_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_intervencao_enfermagem_intervencao_enfermagem_id FOREIGN KEY (intervencao_enfermagem_id) REFERENCES intervencao_enfermagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_intervencao_enfermagem_frequencia_administracao_id FOREIGN KEY (frequencia_administracao_id) REFERENCES frequencia_administracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_intervencao_enfermagem_cuidado_enfermagem_id FOREIGN KEY (cuidado_enfermagem_id) REFERENCES cuidado_enfermagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_intervencao_enfermagem_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_intervencao_enfermagem_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE posologia_padrao_componente
  ADD CONSTRAINT fk_posologia_padrao_componente_posologia_padrao_item_id FOREIGN KEY (posologia_padrao_item_id) REFERENCES posologia_padrao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_posologia_padrao_componente_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_posologia_padrao_componente_unidade_prescricao_id FOREIGN KEY (unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_posologia_padrao_componente_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT;
ALTER TABLE posologia_padrao_item
  ADD CONSTRAINT fk_posologia_padrao_item_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_posologia_padrao_item_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_posologia_padrao_item_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_posologia_padrao_item_prescritor_profissional_id FOREIGN KEY (prescritor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_posologia_padrao_item_unidade_prescricao_id FOREIGN KEY (unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_posologia_padrao_item_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_posologia_padrao_item_frequencia_administracao_id FOREIGN KEY (frequencia_administracao_id) REFERENCES frequencia_administracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_posologia_padrao_item_unidade_duracao_tratamento_id FOREIGN KEY (unidade_duracao_tratamento_id) REFERENCES unidade_duracao_tratamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_posologia_padrao_item_unidade_infusao_id FOREIGN KEY (unidade_infusao_id) REFERENCES unidade_infusao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_posologia_padrao_item_volume_total_unidade_prescricao_id FOREIGN KEY (volume_total_unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_posologia_padrao_item_formula_calculo_dose_id FOREIGN KEY (formula_calculo_dose_id) REFERENCES formula_calculo_dose (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_posologia_padrao_item_sitio_anatomico_coleta_id FOREIGN KEY (sitio_anatomico_coleta_id) REFERENCES sitio_anatomico_coleta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_posologia_padrao_item_tipo_dispositivo_invasivo_id FOREIGN KEY (tipo_dispositivo_invasivo_id) REFERENCES tipo_dispositivo_invasivo (id) ON DELETE RESTRICT;
ALTER TABLE prazo_dispositivo_invasivo
  ADD CONSTRAINT fk_prazo_dispositivo_invasivo_tipo_dispositivo_invasivo_id FOREIGN KEY (tipo_dispositivo_invasivo_id) REFERENCES tipo_dispositivo_invasivo (id) ON DELETE RESTRICT;
ALTER TABLE prescricao
  ADD CONSTRAINT fk_prescricao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_local_assistencia_id FOREIGN KEY (local_assistencia_id) REFERENCES local_assistencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_prescritor_profissional_id FOREIGN KEY (prescritor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_anterior_prescricao_id FOREIGN KEY (anterior_prescricao_id) REFERENCES prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_autorizador_usuario_id FOREIGN KEY (autorizador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_suspensao_profissional_id FOREIGN KEY (suspensao_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_tratamento_oncologico_id FOREIGN KEY (tratamento_oncologico_id) REFERENCES tratamento_oncologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_ciclo_quimioterapia_id FOREIGN KEY (ciclo_quimioterapia_id) REFERENCES ciclo_quimioterapia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_documento_assinado_id FOREIGN KEY (documento_assinado_id) REFERENCES documento_assinado (id) ON DELETE RESTRICT;
ALTER TABLE prescricao_dieta_refeicao_item
  ADD CONSTRAINT fk_prescricao_dieta_refeicao_item_prescricao_item_dieta_id FOREIGN KEY (prescricao_item_dieta_id) REFERENCES prescricao_item_dieta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_dieta_refeicao_item_horario_refeicao_id FOREIGN KEY (horario_refeicao_id) REFERENCES horario_refeicao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_dieta_refeicao_item_alimento_referencia_id FOREIGN KEY (alimento_referencia_id) REFERENCES alimento_referencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_dieta_refeicao_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_dieta_refeicao_item_medida_caseira_alimento_id FOREIGN KEY (medida_caseira_alimento_id) REFERENCES medida_caseira_alimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_dieta_refeicao_item_substituto_prescricao_c39bd764 FOREIGN KEY (substituto_prescricao_dieta_refeicao_item_id) REFERENCES prescricao_dieta_refeicao_item (id) ON DELETE RESTRICT;
ALTER TABLE prescricao_evento
  ADD CONSTRAINT fk_prescricao_evento_prescricao_id FOREIGN KEY (prescricao_id) REFERENCES prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_evento_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_evento_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_evento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE prescricao_exame_verificado
  ADD CONSTRAINT fk_prescricao_exame_verificado_prescricao_id FOREIGN KEY (prescricao_id) REFERENCES prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_exame_verificado_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_exame_verificado_protocolo_quimioterapia_id FOREIGN KEY (protocolo_quimioterapia_id) REFERENCES protocolo_quimioterapia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_exame_verificado_conferente_profissional_id FOREIGN KEY (conferente_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE prescricao_item
  ADD CONSTRAINT fk_prescricao_item_prescricao_id FOREIGN KEY (prescricao_id) REFERENCES prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_tipo_item_prescricao_id FOREIGN KEY (tipo_item_prescricao_id) REFERENCES tipo_item_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_item_nao_padronizado_id FOREIGN KEY (item_nao_padronizado_id) REFERENCES item_nao_padronizado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_frequencia_administracao_id FOREIGN KEY (frequencia_administracao_id) REFERENCES frequencia_administracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_unidade_prescricao_id FOREIGN KEY (unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_suspensao_profissional_id FOREIGN KEY (suspensao_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_lancamento_profissional_id FOREIGN KEY (lancamento_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_protocolo_prescricao_id FOREIGN KEY (protocolo_prescricao_id) REFERENCES protocolo_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_kit_prescricao_id FOREIGN KEY (kit_prescricao_id) REFERENCES kit_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_anterior_prescricao_item_id FOREIGN KEY (anterior_prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_sitio_anatomico_coleta_id FOREIGN KEY (sitio_anatomico_coleta_id) REFERENCES sitio_anatomico_coleta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_tipo_dispositivo_invasivo_id FOREIGN KEY (tipo_dispositivo_invasivo_id) REFERENCES tipo_dispositivo_invasivo (id) ON DELETE RESTRICT;
ALTER TABLE prescricao_item_cuidado
  ADD CONSTRAINT fk_prescricao_item_cuidado_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_cuidado_cuidado_enfermagem_id FOREIGN KEY (cuidado_enfermagem_id) REFERENCES cuidado_enfermagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_cuidado_kit_cuidado_enfermagem_id FOREIGN KEY (kit_cuidado_enfermagem_id) REFERENCES kit_cuidado_enfermagem (id) ON DELETE RESTRICT;
ALTER TABLE prescricao_item_dieta
  ADD CONSTRAINT fk_prescricao_item_dieta_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_dieta_modalidade_dieta_id FOREIGN KEY (modalidade_dieta_id) REFERENCES modalidade_dieta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_dieta_via_dieta_id FOREIGN KEY (via_dieta_id) REFERENCES via_dieta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_dieta_unidade_prescricao_id FOREIGN KEY (unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_dieta_tipo_infusao_id FOREIGN KEY (tipo_infusao_id) REFERENCES tipo_infusao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_dieta_unidade_infusao_id FOREIGN KEY (unidade_infusao_id) REFERENCES unidade_infusao (id) ON DELETE RESTRICT;
ALTER TABLE prescricao_item_dieta_caracteristica
  ADD CONSTRAINT fk_prescricao_item_dieta_caracteristica_prescricao_item_dieta_id FOREIGN KEY (prescricao_item_dieta_id) REFERENCES prescricao_item_dieta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_dieta_caracteristica_caracteristica_dieta_id FOREIGN KEY (caracteristica_dieta_id) REFERENCES caracteristica_dieta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_dieta_caracteristica_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE prescricao_item_glicemia
  ADD CONSTRAINT fk_prescricao_item_glicemia_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_glicemia_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_glicemia_item_nao_padronizado_id FOREIGN KEY (item_nao_padronizado_id) REFERENCES item_nao_padronizado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_glicemia_unidade_prescricao_id FOREIGN KEY (unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_glicemia_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT;
ALTER TABLE prescricao_item_hemocomponente
  ADD CONSTRAINT fk_prescricao_item_hemocomponente_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_hemocomponente_hemocomponente_id FOREIGN KEY (hemocomponente_id) REFERENCES hemocomponente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_hemocomponente_unidade_prescricao_id FOREIGN KEY (unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_hemocomponente_unidade_infusao_id FOREIGN KEY (unidade_infusao_id) REFERENCES unidade_infusao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_hemocomponente_tipo_infusao_id FOREIGN KEY (tipo_infusao_id) REFERENCES tipo_infusao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_hemocomponente_requisicao_transfusao_id FOREIGN KEY (requisicao_transfusao_id) REFERENCES requisicao_transfusao (id) ON DELETE RESTRICT;
ALTER TABLE prescricao_item_justificativa
  ADD CONSTRAINT fk_prescricao_item_justificativa_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_justificativa_justificativa_padrao_m_08223de6 FOREIGN KEY (justificativa_padrao_medicacao_id) REFERENCES justificativa_padrao_medicacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_justificativa_autor_profissional_id FOREIGN KEY (autor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE prescricao_item_material
  ADD CONSTRAINT fk_prescricao_item_material_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_material_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_material_item_nao_padronizado_id FOREIGN KEY (item_nao_padronizado_id) REFERENCES item_nao_padronizado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_material_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_material_unidade_prescricao_id FOREIGN KEY (unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_material_formula_calculo_dose_id FOREIGN KEY (formula_calculo_dose_id) REFERENCES formula_calculo_dose (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_material_tipo_dispositivo_invasivo_id FOREIGN KEY (tipo_dispositivo_invasivo_id) REFERENCES tipo_dispositivo_invasivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_material_kit_prescricao_id FOREIGN KEY (kit_prescricao_id) REFERENCES kit_prescricao (id) ON DELETE RESTRICT;
ALTER TABLE prescricao_item_medicamento
  ADD CONSTRAINT fk_prescricao_item_medicamento_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_medicamento_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_medicamento_item_nao_padronizado_id FOREIGN KEY (item_nao_padronizado_id) REFERENCES item_nao_padronizado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_medicamento_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_medicamento_unidade_prescricao_id FOREIGN KEY (unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_medicamento_formula_calculo_dose_id FOREIGN KEY (formula_calculo_dose_id) REFERENCES formula_calculo_dose (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_medicamento_diluente_item_prescritivel_id FOREIGN KEY (diluente_item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_medicamento_diluente_unidade_prescricao_id FOREIGN KEY (diluente_unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_medicamento_unidade_infusao_id FOREIGN KEY (unidade_infusao_id) REFERENCES unidade_infusao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_medicamento_tipo_infusao_id FOREIGN KEY (tipo_infusao_id) REFERENCES tipo_infusao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_medicamento_ficha_antimicrobiano_id FOREIGN KEY (ficha_antimicrobiano_id) REFERENCES ficha_antimicrobiano (id) ON DELETE RESTRICT;
ALTER TABLE prescricao_item_procedimento
  ADD CONSTRAINT fk_prescricao_item_procedimento_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_procedimento_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_procedimento_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_procedimento_cuidado_enfermagem_id FOREIGN KEY (cuidado_enfermagem_id) REFERENCES cuidado_enfermagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_procedimento_requisicao_exame_id FOREIGN KEY (requisicao_exame_id) REFERENCES requisicao_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_procedimento_executor_profissional_id FOREIGN KEY (executor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_procedimento_sitio_anatomico_coleta_id FOREIGN KEY (sitio_anatomico_coleta_id) REFERENCES sitio_anatomico_coleta (id) ON DELETE RESTRICT;
ALTER TABLE prescricao_item_se_necessario
  ADD CONSTRAINT fk_prescricao_item_se_necessario_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_se_necessario_condicao_se_necessario_id FOREIGN KEY (condicao_se_necessario_id) REFERENCES condicao_se_necessario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_se_necessario_unidade_prescricao_id FOREIGN KEY (unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT;
ALTER TABLE prescricao_item_solucao
  ADD CONSTRAINT fk_prescricao_item_solucao_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_solucao_unidade_prescricao_id FOREIGN KEY (unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_solucao_tipo_infusao_id FOREIGN KEY (tipo_infusao_id) REFERENCES tipo_infusao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_solucao_unidade_infusao_id FOREIGN KEY (unidade_infusao_id) REFERENCES unidade_infusao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_solucao_kit_prescricao_id FOREIGN KEY (kit_prescricao_id) REFERENCES kit_prescricao (id) ON DELETE RESTRICT;
ALTER TABLE prescricao_item_solucao_componente
  ADD CONSTRAINT fk_prescricao_item_solucao_componente_prescricao_item_solucao_id FOREIGN KEY (prescricao_item_solucao_id) REFERENCES prescricao_item_solucao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_solucao_componente_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_solucao_componente_item_nao_padronizado_id FOREIGN KEY (item_nao_padronizado_id) REFERENCES item_nao_padronizado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_solucao_componente_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_solucao_componente_unidade_prescricao_id FOREIGN KEY (unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prescricao_item_solucao_componente_formula_calculo_dose_id FOREIGN KEY (formula_calculo_dose_id) REFERENCES formula_calculo_dose (id) ON DELETE RESTRICT;
