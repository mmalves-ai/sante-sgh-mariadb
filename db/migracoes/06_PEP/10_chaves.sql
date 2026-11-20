-- Chaves do lote 06_PEP-10 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE regiao_corporal
  ADD CONSTRAINT fk_regiao_corporal_superior_regiao_corporal_id FOREIGN KEY (superior_regiao_corporal_id) REFERENCES regiao_corporal (id) ON DELETE RESTRICT;
ALTER TABLE regiao_corporal_sistema
  ADD CONSTRAINT fk_regiao_corporal_sistema_regiao_corporal_id FOREIGN KEY (regiao_corporal_id) REFERENCES regiao_corporal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regiao_corporal_sistema_sistema_corporal_id FOREIGN KEY (sistema_corporal_id) REFERENCES sistema_corporal (id) ON DELETE RESTRICT;
ALTER TABLE regiao_irradiada
  ADD CONSTRAINT fk_regiao_irradiada_regiao_corporal_id FOREIGN KEY (regiao_corporal_id) REFERENCES regiao_corporal (id) ON DELETE RESTRICT;
ALTER TABLE registro_assistencial
  ADD CONSTRAINT fk_registro_assistencial_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_modelo_documento_clinico_id FOREIGN KEY (modelo_documento_clinico_id) REFERENCES modelo_documento_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_tipo_documento_clinico_id FOREIGN KEY (tipo_documento_clinico_id) REFERENCES tipo_documento_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_autor_profissional_id FOREIGN KEY (autor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_autor_usuario_id FOREIGN KEY (autor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_local_assistencia_id FOREIGN KEY (local_assistencia_id) REFERENCES local_assistencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_interconsulta_id FOREIGN KEY (interconsulta_id) REFERENCES interconsulta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_situacao_assinatura_documento_id FOREIGN KEY (situacao_assinatura_documento_id) REFERENCES situacao_assinatura_documento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_corrige_registro_assistencial_id FOREIGN KEY (corrige_registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_suspenso_por_usuario_id FOREIGN KEY (suspenso_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_motivo_suspensao_registro_id FOREIGN KEY (motivo_suspensao_registro_id) REFERENCES motivo_suspensao_registro (id) ON DELETE RESTRICT;
ALTER TABLE registro_assistencial_rascunho
  ADD CONSTRAINT fk_registro_assistencial_rascunho_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_rascunho_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_rascunho_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_rascunho_modelo_documento_clinico_id FOREIGN KEY (modelo_documento_clinico_id) REFERENCES modelo_documento_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_rascunho_autor_profissional_id FOREIGN KEY (autor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_rascunho_autor_usuario_id FOREIGN KEY (autor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_rascunho_local_assistencia_id FOREIGN KEY (local_assistencia_id) REFERENCES local_assistencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_rascunho_corrige_registro_assistencial_ FOREIGN KEY (corrige_registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_rascunho_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT;
ALTER TABLE registro_assistencial_resposta
  ADD CONSTRAINT fk_registro_assistencial_resposta_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_resposta_modelo_campo_id FOREIGN KEY (modelo_campo_id) REFERENCES modelo_campo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_resposta_modelo_campo_opcao_id FOREIGN KEY (modelo_campo_opcao_id) REFERENCES modelo_campo_opcao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_resposta_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE registro_assistencial_supervisao
  ADD CONSTRAINT fk_registro_assistencial_supervisao_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_supervisao_supervisionado_profissional_ FOREIGN KEY (supervisionado_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_supervisao_preceptor_profissional_id FOREIGN KEY (preceptor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_supervisao_assinatura_documento_id FOREIGN KEY (assinatura_documento_id) REFERENCES assinatura_documento (id) ON DELETE RESTRICT;
ALTER TABLE registro_assistencial_versao
  ADD CONSTRAINT fk_registro_assistencial_versao_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_versao_corrigido_por_registro_assistenc FOREIGN KEY (corrigido_por_registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_assistencial_versao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE registro_nascimento
  ADD CONSTRAINT fk_registro_nascimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_nascimento_mae_paciente_id FOREIGN KEY (mae_paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_nascimento_mae_atendimento_id FOREIGN KEY (mae_atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_nascimento_partograma_id FOREIGN KEY (partograma_id) REFERENCES partograma (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_nascimento_recem_nascido_paciente_id FOREIGN KEY (recem_nascido_paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_nascimento_recem_nascido_atendimento_id FOREIGN KEY (recem_nascido_atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_nascimento_tipo_parto_id FOREIGN KEY (tipo_parto_id) REFERENCES tipo_parto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_nascimento_motivo_parto_cirurgico_id FOREIGN KEY (motivo_parto_cirurgico_id) REFERENCES motivo_parto_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_nascimento_sexo_id FOREIGN KEY (sexo_id) REFERENCES sexo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_nascimento_condicao_recem_nascido_id FOREIGN KEY (condicao_recem_nascido_id) REFERENCES condicao_recem_nascido (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_nascimento_desfecho_recem_nascido_id FOREIGN KEY (desfecho_recem_nascido_id) REFERENCES desfecho_recem_nascido (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_nascimento_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_nascimento_pediatra_profissional_id FOREIGN KEY (pediatra_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_nascimento_declaracao_nascido_vivo_id FOREIGN KEY (declaracao_nascido_vivo_id) REFERENCES declaracao_nascido_vivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_nascimento_cartorio_registro_civil_id FOREIGN KEY (cartorio_registro_civil_id) REFERENCES cartorio_registro_civil (id) ON DELETE RESTRICT;
ALTER TABLE registro_tempo_evento
  ADD CONSTRAINT fk_registro_tempo_evento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_tempo_evento_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_tempo_evento_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_tempo_evento_tipo_evento_tempo_id FOREIGN KEY (tipo_evento_tempo_id) REFERENCES tipo_evento_tempo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_tempo_evento_classificacao_risco_id FOREIGN KEY (classificacao_risco_id) REFERENCES classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_tempo_evento_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_tempo_evento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_tempo_evento_estacao_trabalho_id FOREIGN KEY (estacao_trabalho_id) REFERENCES estacao_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_tempo_evento_cancelado_por_usuario_id FOREIGN KEY (cancelado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE regra_antimicrobiano_estabelecimento
  ADD CONSTRAINT fk_regra_antimicrobiano_estabelecimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_antimicrobiano_estabelecimento_antimicrobiano_id FOREIGN KEY (antimicrobiano_id) REFERENCES antimicrobiano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_antimicrobiano_estabelecimento_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE regra_atuacao_categoria_profissional
  ADD CONSTRAINT fk_regra_atuacao_categoria_profissional_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_atuacao_categoria_profissional_categoria_profissional_i FOREIGN KEY (categoria_profissional_id) REFERENCES categoria_profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_atuacao_categoria_profissional_tipo_item_prescricao_id FOREIGN KEY (tipo_item_prescricao_id) REFERENCES tipo_item_prescricao (id) ON DELETE RESTRICT;
ALTER TABLE regra_classificacao_risco
  ADD CONSTRAINT fk_regra_classificacao_risco_protocolo_classificacao_risco_versa FOREIGN KEY (protocolo_classificacao_risco_versao_id) REFERENCES protocolo_classificacao_risco_versao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_classificacao_risco_fluxograma_classificacao_risco_id FOREIGN KEY (fluxograma_classificacao_risco_id) REFERENCES fluxograma_classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_classificacao_risco_discriminador_classificacao_risco_i FOREIGN KEY (discriminador_classificacao_risco_id) REFERENCES discriminador_classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_classificacao_risco_parametro_vital_id FOREIGN KEY (parametro_vital_id) REFERENCES parametro_vital (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_classificacao_risco_nivel_prioridade_id FOREIGN KEY (nivel_prioridade_id) REFERENCES nivel_prioridade (id) ON DELETE RESTRICT;
ALTER TABLE regra_duplicidade_terapeutica
  ADD CONSTRAINT fk_regra_duplicidade_terapeutica_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_duplicidade_terapeutica_classe_terapeutica_id FOREIGN KEY (classe_terapeutica_id) REFERENCES classe_terapeutica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_duplicidade_terapeutica_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT;
ALTER TABLE regra_grupo_estadio
  ADD CONSTRAINT fk_regra_grupo_estadio_topografia_tumor_id FOREIGN KEY (topografia_tumor_id) REFERENCES topografia_tumor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_grupo_estadio_estadio_clinico_id FOREIGN KEY (estadio_clinico_id) REFERENCES estadio_clinico (id) ON DELETE RESTRICT;
ALTER TABLE regra_obrigatoriedade_cid
  ADD CONSTRAINT fk_regra_obrigatoriedade_cid_regra_obrigatoriedade_documento_id FOREIGN KEY (regra_obrigatoriedade_documento_id) REFERENCES regra_obrigatoriedade_documento (id) ON DELETE RESTRICT;
ALTER TABLE regra_obrigatoriedade_documento
  ADD CONSTRAINT fk_regra_obrigatoriedade_documento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_obrigatoriedade_documento_modelo_documento_clinico_id FOREIGN KEY (modelo_documento_clinico_id) REFERENCES modelo_documento_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_obrigatoriedade_documento_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_obrigatoriedade_documento_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_obrigatoriedade_documento_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_obrigatoriedade_documento_categoria_profissional_id FOREIGN KEY (categoria_profissional_id) REFERENCES categoria_profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_obrigatoriedade_documento_tipo_item_prescricao_id FOREIGN KEY (tipo_item_prescricao_id) REFERENCES tipo_item_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_obrigatoriedade_documento_motivo_saida_hospitalar_id FOREIGN KEY (motivo_saida_hospitalar_id) REFERENCES motivo_saida_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_obrigatoriedade_documento_sexo_id FOREIGN KEY (sexo_id) REFERENCES sexo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_obrigatoriedade_documento_tipo_pendencia_prontuario_id FOREIGN KEY (tipo_pendencia_prontuario_id) REFERENCES tipo_pendencia_prontuario (id) ON DELETE RESTRICT;
ALTER TABLE regra_pendencia_prescricao
  ADD CONSTRAINT fk_regra_pendencia_prescricao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_pendencia_prescricao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_pendencia_prescricao_tipo_item_prescricao_id FOREIGN KEY (tipo_item_prescricao_id) REFERENCES tipo_item_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_pendencia_prescricao_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_pendencia_prescricao_tipo_pendencia_prontuario_id FOREIGN KEY (tipo_pendencia_prontuario_id) REFERENCES tipo_pendencia_prontuario (id) ON DELETE RESTRICT;
ALTER TABLE regra_prescricao_transferencia
  ADD CONSTRAINT fk_regra_prescricao_transferencia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_prescricao_transferencia_origem_setor_funcional_id FOREIGN KEY (origem_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_prescricao_transferencia_destino_setor_funcional_id FOREIGN KEY (destino_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_prescricao_transferencia_tipo_item_prescricao_id FOREIGN KEY (tipo_item_prescricao_id) REFERENCES tipo_item_prescricao (id) ON DELETE RESTRICT;
ALTER TABLE regra_reducao_quantidade_prescricao
  ADD CONSTRAINT fk_regra_reducao_quantidade_prescricao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_reducao_quantidade_prescricao_tipo_item_prescricao_id FOREIGN KEY (tipo_item_prescricao_id) REFERENCES tipo_item_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_reducao_quantidade_prescricao_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT;
ALTER TABLE regra_requisicao_farmacia
  ADD CONSTRAINT fk_regra_requisicao_farmacia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_requisicao_farmacia_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_requisicao_farmacia_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_requisicao_farmacia_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE regra_sugestao_diagnostico_enfermagem
  ADD CONSTRAINT fk_regra_sugestao_diagnostico_enfermagem_diagnostico_enfermagem_ FOREIGN KEY (diagnostico_enfermagem_id) REFERENCES diagnostico_enfermagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_sugestao_diagnostico_enfermagem_modelo_campo_id FOREIGN KEY (modelo_campo_id) REFERENCES modelo_campo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_sugestao_diagnostico_enfermagem_modelo_campo_opcao_id FOREIGN KEY (modelo_campo_opcao_id) REFERENCES modelo_campo_opcao (id) ON DELETE RESTRICT;
ALTER TABLE regra_transicao_situacao_prescricao
  ADD CONSTRAINT fk_regra_transicao_situacao_prescricao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_transicao_situacao_prescricao_origem_situacao_prescrica FOREIGN KEY (origem_situacao_prescricao_id) REFERENCES situacao_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_transicao_situacao_prescricao_destino_situacao_prescric FOREIGN KEY (destino_situacao_prescricao_id) REFERENCES situacao_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_transicao_situacao_prescricao_categoria_profissional_id FOREIGN KEY (categoria_profissional_id) REFERENCES categoria_profissional (id) ON DELETE RESTRICT;
ALTER TABLE resposta_informacao_operadora
  ADD CONSTRAINT fk_resposta_informacao_operadora_informacao_clinica_operadora_id FOREIGN KEY (informacao_clinica_operadora_id) REFERENCES informacao_clinica_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resposta_informacao_operadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE restricao_posologia
  ADD CONSTRAINT fk_restricao_posologia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_posologia_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_posologia_principio_ativo_id FOREIGN KEY (principio_ativo_id) REFERENCES principio_ativo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_posologia_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_posologia_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_posologia_forma_apresentacao_medicamento_id FOREIGN KEY (forma_apresentacao_medicamento_id) REFERENCES forma_apresentacao_medicamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_posologia_sexo_id FOREIGN KEY (sexo_id) REFERENCES sexo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_posologia_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_posologia_referencia_dose_id FOREIGN KEY (referencia_dose_id) REFERENCES referencia_dose (id) ON DELETE RESTRICT;
ALTER TABLE resultado_enfermagem
  ADD CONSTRAINT fk_resultado_enfermagem_escala_resultado_enfermagem_id FOREIGN KEY (escala_resultado_enfermagem_id) REFERENCES escala_resultado_enfermagem (id) ON DELETE RESTRICT;
ALTER TABLE resultado_intervencao_enfermagem
  ADD CONSTRAINT fk_resultado_intervencao_enfermagem_resultado_enfermagem_id FOREIGN KEY (resultado_enfermagem_id) REFERENCES resultado_enfermagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_intervencao_enfermagem_intervencao_enfermagem_id FOREIGN KEY (intervencao_enfermagem_id) REFERENCES intervencao_enfermagem (id) ON DELETE RESTRICT;
ALTER TABLE resumo_estadiamento_tnm
  ADD CONSTRAINT fk_resumo_estadiamento_tnm_topografia_tumor_id FOREIGN KEY (topografia_tumor_id) REFERENCES topografia_tumor (id) ON DELETE RESTRICT;
ALTER TABLE reuso_dialisador
  ADD CONSTRAINT fk_reuso_dialisador_dialisador_id FOREIGN KEY (dialisador_id) REFERENCES dialisador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reuso_dialisador_sessao_hemodialise_id FOREIGN KEY (sessao_hemodialise_id) REFERENCES sessao_hemodialise (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reuso_dialisador_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE sessao_hemodialise
  ADD CONSTRAINT fk_sessao_hemodialise_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_hemodialise_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_hemodialise_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_hemodialise_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_hemodialise_dialisador_id FOREIGN KEY (dialisador_id) REFERENCES dialisador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_hemodialise_equipamento_saude_id FOREIGN KEY (equipamento_saude_id) REFERENCES equipamento_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_hemodialise_dispositivo_invasivo_paciente_id FOREIGN KEY (dispositivo_invasivo_paciente_id) REFERENCES dispositivo_invasivo_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_hemodialise_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_hemodialise_nefrologista_profissional_id FOREIGN KEY (nefrologista_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE sessao_quimioterapia
  ADD CONSTRAINT fk_sessao_quimioterapia_ciclo_quimioterapia_id FOREIGN KEY (ciclo_quimioterapia_id) REFERENCES ciclo_quimioterapia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_quimioterapia_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_quimioterapia_prescricao_id FOREIGN KEY (prescricao_id) REFERENCES prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_quimioterapia_marcacao_horario_id FOREIGN KEY (marcacao_horario_id) REFERENCES marcacao_horario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_quimioterapia_recurso_agendavel_id FOREIGN KEY (recurso_agendavel_id) REFERENCES recurso_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_quimioterapia_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE sessao_radioterapia
  ADD CONSTRAINT fk_sessao_radioterapia_tratamento_radioterapia_id FOREIGN KEY (tratamento_radioterapia_id) REFERENCES tratamento_radioterapia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_radioterapia_regiao_irradiada_id FOREIGN KEY (regiao_irradiada_id) REFERENCES regiao_irradiada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_radioterapia_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_radioterapia_equipamento_saude_id FOREIGN KEY (equipamento_saude_id) REFERENCES equipamento_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_radioterapia_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE sinalizacao_paciente
  ADD CONSTRAINT fk_sinalizacao_paciente_sinalizador_paciente_id FOREIGN KEY (sinalizador_paciente_id) REFERENCES sinalizador_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sinalizacao_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sinalizacao_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sinalizacao_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sinalizacao_paciente_inicio_registro_assistencial_id FOREIGN KEY (inicio_registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sinalizacao_paciente_fim_registro_assistencial_id FOREIGN KEY (fim_registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sinalizacao_paciente_inicio_usuario_id FOREIGN KEY (inicio_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sinalizacao_paciente_fim_usuario_id FOREIGN KEY (fim_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sinalizacao_paciente_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE sinalizador_paciente
  ADD CONSTRAINT fk_sinalizador_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE sinalizador_paciente_origem
  ADD CONSTRAINT fk_sinalizador_paciente_origem_sinalizador_paciente_id FOREIGN KEY (sinalizador_paciente_id) REFERENCES sinalizador_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sinalizador_paciente_origem_modelo_documento_clinico_id FOREIGN KEY (modelo_documento_clinico_id) REFERENCES modelo_documento_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sinalizador_paciente_origem_modelo_campo_id FOREIGN KEY (modelo_campo_id) REFERENCES modelo_campo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sinalizador_paciente_origem_modelo_campo_opcao_id FOREIGN KEY (modelo_campo_opcao_id) REFERENCES modelo_campo_opcao (id) ON DELETE RESTRICT;
ALTER TABLE situacao_alto_risco
  ADD CONSTRAINT fk_situacao_alto_risco_grupo_situacao_alto_risco_id FOREIGN KEY (grupo_situacao_alto_risco_id) REFERENCES situacao_alto_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_situacao_alto_risco_nivel_prioridade_id FOREIGN KEY (nivel_prioridade_id) REFERENCES nivel_prioridade (id) ON DELETE RESTRICT;
