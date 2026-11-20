-- PEP, lote 06: chaves estrangeiras (aplicadas depois de todos os tabelas.sql)
ALTER TABLE item_nao_padronizado_via
  ADD CONSTRAINT fk_item_nao_padronizado_via_item_nao_padronizado_id FOREIGN KEY (item_nao_padronizado_id) REFERENCES item_nao_padronizado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_nao_padronizado_via_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT;
ALTER TABLE item_prescritivel
  ADD CONSTRAINT fk_item_prescritivel_tipo_item_prescricao_id FOREIGN KEY (tipo_item_prescricao_id) REFERENCES tipo_item_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prescritivel_grupo_exibicao_prescricao_id FOREIGN KEY (grupo_exibicao_prescricao_id) REFERENCES grupo_exibicao_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prescritivel_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prescritivel_principio_ativo_id FOREIGN KEY (principio_ativo_id) REFERENCES principio_ativo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prescritivel_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prescritivel_cuidado_enfermagem_id FOREIGN KEY (cuidado_enfermagem_id) REFERENCES cuidado_enfermagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prescritivel_hemocomponente_id FOREIGN KEY (hemocomponente_id) REFERENCES hemocomponente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prescritivel_modalidade_dieta_id FOREIGN KEY (modalidade_dieta_id) REFERENCES modalidade_dieta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prescritivel_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prescritivel_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prescritivel_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prescritivel_frequencia_administracao_id FOREIGN KEY (frequencia_administracao_id) REFERENCES frequencia_administracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prescritivel_unidade_prescricao_id FOREIGN KEY (unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prescritivel_maxima_unidade_prescricao_id FOREIGN KEY (maxima_unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prescritivel_dispensacao_unidade_medida_id FOREIGN KEY (dispensacao_unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prescritivel_justificativa_padrao_medicacao_id FOREIGN KEY (justificativa_padrao_medicacao_id) REFERENCES justificativa_padrao_medicacao (id) ON DELETE RESTRICT;
ALTER TABLE item_prescritivel_conflito
  ADD CONSTRAINT fk_item_prescritivel_conflito_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prescritivel_conflito_conflitante_item_prescritivel_id FOREIGN KEY (conflitante_item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT;
ALTER TABLE item_prescritivel_dispositivo
  ADD CONSTRAINT fk_item_prescritivel_dispositivo_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prescritivel_dispositivo_dispositivo_insumo_id FOREIGN KEY (dispositivo_insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT;
ALTER TABLE item_prescritivel_frequencia
  ADD CONSTRAINT fk_item_prescritivel_frequencia_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prescritivel_frequencia_frequencia_administracao_id FOREIGN KEY (frequencia_administracao_id) REFERENCES frequencia_administracao (id) ON DELETE RESTRICT;
ALTER TABLE item_prescritivel_pesquisa
  ADD CONSTRAINT fk_item_prescritivel_pesquisa_pesquisa_clinica_id FOREIGN KEY (pesquisa_clinica_id) REFERENCES pesquisa_clinica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prescritivel_pesquisa_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT;
ALTER TABLE item_prescritivel_setor
  ADD CONSTRAINT fk_item_prescritivel_setor_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prescritivel_setor_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prescritivel_setor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prescritivel_setor_local_atendimento_id FOREIGN KEY (local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prescritivel_setor_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prescritivel_setor_frequencia_administracao_id FOREIGN KEY (frequencia_administracao_id) REFERENCES frequencia_administracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prescritivel_setor_executante_profissional_id FOREIGN KEY (executante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE item_prescritivel_sinonimo
  ADD CONSTRAINT fk_item_prescritivel_sinonimo_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT;
ALTER TABLE item_prescritivel_via
  ADD CONSTRAINT fk_item_prescritivel_via_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prescritivel_via_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT;
ALTER TABLE kit_cuidado_enfermagem
  ADD CONSTRAINT fk_kit_cuidado_enfermagem_cuidado_enfermagem_id FOREIGN KEY (cuidado_enfermagem_id) REFERENCES cuidado_enfermagem (id) ON DELETE RESTRICT;
ALTER TABLE kit_cuidado_enfermagem_item
  ADD CONSTRAINT fk_kit_cuidado_enfermagem_item_kit_cuidado_enfermagem_id FOREIGN KEY (kit_cuidado_enfermagem_id) REFERENCES kit_cuidado_enfermagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_cuidado_enfermagem_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_cuidado_enfermagem_item_unidade_prescricao_id FOREIGN KEY (unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_cuidado_enfermagem_item_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT;
ALTER TABLE kit_prescricao
  ADD CONSTRAINT fk_kit_prescricao_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_prescricao_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_prescricao_frequencia_administracao_id FOREIGN KEY (frequencia_administracao_id) REFERENCES frequencia_administracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_prescricao_unidade_prescricao_id FOREIGN KEY (unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_prescricao_unidade_infusao_id FOREIGN KEY (unidade_infusao_id) REFERENCES unidade_infusao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_prescricao_tipo_infusao_id FOREIGN KEY (tipo_infusao_id) REFERENCES tipo_infusao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_prescricao_grupo_balanco_hidrico_id FOREIGN KEY (grupo_balanco_hidrico_id) REFERENCES grupo_balanco_hidrico (id) ON DELETE RESTRICT;
ALTER TABLE kit_prescricao_item
  ADD CONSTRAINT fk_kit_prescricao_item_kit_prescricao_id FOREIGN KEY (kit_prescricao_id) REFERENCES kit_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_prescricao_item_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_prescricao_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_prescricao_item_unidade_prescricao_id FOREIGN KEY (unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_prescricao_item_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_prescricao_item_frequencia_administracao_id FOREIGN KEY (frequencia_administracao_id) REFERENCES frequencia_administracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_prescricao_item_formula_padrao_manipulacao_id FOREIGN KEY (formula_padrao_manipulacao_id) REFERENCES formula_padrao_manipulacao (id) ON DELETE RESTRICT;
ALTER TABLE lesao_pele_paciente
  ADD CONSTRAINT fk_lesao_pele_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lesao_pele_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lesao_pele_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lesao_pele_paciente_tipo_lesao_pele_id FOREIGN KEY (tipo_lesao_pele_id) REFERENCES tipo_lesao_pele (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lesao_pele_paciente_regiao_corporal_id FOREIGN KEY (regiao_corporal_id) REFERENCES regiao_corporal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lesao_pele_paciente_estagio_lesao_pele_id FOREIGN KEY (estagio_lesao_pele_id) REFERENCES estagio_lesao_pele (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lesao_pele_paciente_dispositivo_invasivo_paciente_id FOREIGN KEY (dispositivo_invasivo_paciente_id) REFERENCES dispositivo_invasivo_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lesao_pele_paciente_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE lesao_pele_avaliacao
  ADD CONSTRAINT fk_lesao_pele_avaliacao_lesao_pele_paciente_id FOREIGN KEY (lesao_pele_paciente_id) REFERENCES lesao_pele_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lesao_pele_avaliacao_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lesao_pele_avaliacao_estagio_lesao_pele_id FOREIGN KEY (estagio_lesao_pele_id) REFERENCES estagio_lesao_pele (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lesao_pele_avaliacao_foto_arquivo_id FOREIGN KEY (foto_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lesao_pele_avaliacao_anexo_prontuario_id FOREIGN KEY (anexo_prontuario_id) REFERENCES anexo_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lesao_pele_avaliacao_corrigida_lesao_pele_avaliacao_id FOREIGN KEY (corrigida_lesao_pele_avaliacao_id) REFERENCES lesao_pele_avaliacao (id) ON DELETE RESTRICT;
ALTER TABLE liberacao_pendencia_assinatura
  ADD CONSTRAINT fk_liberacao_pendencia_assinatura_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_pendencia_assinatura_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_pendencia_assinatura_pendencia_assinatura_id FOREIGN KEY (pendencia_assinatura_id) REFERENCES pendencia_assinatura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_pendencia_assinatura_autorizador_usuario_id FOREIGN KEY (autorizador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_pendencia_assinatura_desativador_usuario_id FOREIGN KEY (desativador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_pendencia_assinatura_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE limite_dose_principio
  ADD CONSTRAINT fk_limite_dose_principio_principio_ativo_id FOREIGN KEY (principio_ativo_id) REFERENCES principio_ativo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_dose_principio_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_dose_principio_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_dose_principio_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_dose_principio_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_dose_principio_unidade_prescricao_id FOREIGN KEY (unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT;
ALTER TABLE limite_parametro_vital
  ADD CONSTRAINT fk_limite_parametro_vital_parametro_vital_id FOREIGN KEY (parametro_vital_id) REFERENCES parametro_vital (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_parametro_vital_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_parametro_vital_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_parametro_vital_instrumento_afericao_id FOREIGN KEY (instrumento_afericao_id) REFERENCES instrumento_afericao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_parametro_vital_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE limite_risco_sinal_vital
  ADD CONSTRAINT fk_limite_risco_sinal_vital_parametro_vital_id FOREIGN KEY (parametro_vital_id) REFERENCES parametro_vital (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_risco_sinal_vital_protocolo_classificacao_risco_id FOREIGN KEY (protocolo_classificacao_risco_id) REFERENCES protocolo_classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_risco_sinal_vital_nivel_prioridade_id FOREIGN KEY (nivel_prioridade_id) REFERENCES nivel_prioridade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_risco_sinal_vital_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE lista_trabalho_setor
  ADD CONSTRAINT fk_lista_trabalho_setor_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_trabalho_setor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE livro_registro_setor
  ADD CONSTRAINT fk_livro_registro_setor_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_livro_registro_setor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_livro_registro_setor_abertura_usuario_id FOREIGN KEY (abertura_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_livro_registro_setor_fechamento_usuario_id FOREIGN KEY (fechamento_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE livro_registro_setor_ocorrencia
  ADD CONSTRAINT fk_livro_registro_setor_ocorrencia_livro_registro_setor_id FOREIGN KEY (livro_registro_setor_id) REFERENCES livro_registro_setor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_livro_registro_setor_ocorrencia_turno_padrao_id FOREIGN KEY (turno_padrao_id) REFERENCES turno_padrao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_livro_registro_setor_ocorrencia_autor_usuario_id FOREIGN KEY (autor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_livro_registro_setor_ocorrencia_pai FOREIGN KEY (pai_livro_registro_setor_ocorrencia_id) REFERENCES livro_registro_setor_ocorrencia (id) ON DELETE RESTRICT;
ALTER TABLE local_acesso_invasivo
  ADD CONSTRAINT fk_local_acesso_invasivo_regiao_corporal_id FOREIGN KEY (regiao_corporal_id) REFERENCES regiao_corporal (id) ON DELETE RESTRICT;
ALTER TABLE manifestacao_alergica
  ADD CONSTRAINT fk_manifestacao_alergica_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_manifestacao_alergica_ciap_termo_terminologia_id FOREIGN KEY (ciap_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_manifestacao_alergica_versao_classificacao_clinica_id FOREIGN KEY (versao_classificacao_clinica_id) REFERENCES versao_classificacao_clinica (id) ON DELETE RESTRICT;
ALTER TABLE marcador_tumoral
  ADD CONSTRAINT fk_marcador_tumoral_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcador_tumoral_topografia_tumor_id FOREIGN KEY (topografia_tumor_id) REFERENCES topografia_tumor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcador_tumoral_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcador_tumoral_morfologia_termo_terminologia_id FOREIGN KEY (morfologia_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE marco_linha_tempo_paciente
  ADD CONSTRAINT fk_marco_linha_tempo_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marco_linha_tempo_paciente_marco_linha_tempo_id FOREIGN KEY (marco_linha_tempo_id) REFERENCES marco_linha_tempo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marco_linha_tempo_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marco_linha_tempo_paciente_autor_usuario_id FOREIGN KEY (autor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marco_linha_tempo_paciente_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marco_linha_tempo_paciente_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marco_linha_tempo_paciente_prescricao_id FOREIGN KEY (prescricao_id) REFERENCES prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marco_linha_tempo_paciente_requisicao_exame_id FOREIGN KEY (requisicao_exame_id) REFERENCES requisicao_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marco_linha_tempo_paciente_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marco_linha_tempo_paciente_tratamento_oncologico_id FOREIGN KEY (tratamento_oncologico_id) REFERENCES tratamento_oncologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marco_linha_tempo_paciente_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marco_linha_tempo_paciente_participante_pesquisa_id FOREIGN KEY (participante_pesquisa_id) REFERENCES participante_pesquisa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marco_linha_tempo_paciente_pai_marco_linha_tempo_paciente_id FOREIGN KEY (pai_marco_linha_tempo_paciente_id) REFERENCES marco_linha_tempo_paciente (id) ON DELETE RESTRICT;
ALTER TABLE medicamento_uso_previo
  ADD CONSTRAINT fk_medicamento_uso_previo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_medicamento_uso_previo_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_medicamento_uso_previo_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_medicamento_uso_previo_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_medicamento_uso_previo_item_nao_padronizado_id FOREIGN KEY (item_nao_padronizado_id) REFERENCES item_nao_padronizado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_medicamento_uso_previo_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_medicamento_uso_previo_principio_ativo_id FOREIGN KEY (principio_ativo_id) REFERENCES principio_ativo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_medicamento_uso_previo_unidade_prescricao_id FOREIGN KEY (unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_medicamento_uso_previo_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_medicamento_uso_previo_frequencia_administracao_id FOREIGN KEY (frequencia_administracao_id) REFERENCES frequencia_administracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_medicamento_uso_previo_registrante_usuario_id FOREIGN KEY (registrante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_medicamento_uso_previo_suspensor_usuario_id FOREIGN KEY (suspensor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE metastase_paciente
  ADD CONSTRAINT fk_metastase_paciente_diagnostico_oncologico_id FOREIGN KEY (diagnostico_oncologico_id) REFERENCES diagnostico_oncologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_metastase_paciente_topografia_tumor_id FOREIGN KEY (topografia_tumor_id) REFERENCES topografia_tumor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_metastase_paciente_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_metastase_paciente_morfologia_termo_terminologia_id FOREIGN KEY (morfologia_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE modelo_acomodacao
  ADD CONSTRAINT fk_modelo_acomodacao_modelo_documento_clinico_id FOREIGN KEY (modelo_documento_clinico_id) REFERENCES modelo_documento_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_acomodacao_categoria_acomodacao_id FOREIGN KEY (categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT;
ALTER TABLE modelo_campo
  ADD CONSTRAINT fk_modelo_campo_modelo_documento_versao_id FOREIGN KEY (modelo_documento_versao_id) REFERENCES modelo_documento_versao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_campo_modelo_secao_id FOREIGN KEY (modelo_secao_id) REFERENCES modelo_secao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_campo_pai_modelo_campo_id FOREIGN KEY (pai_modelo_campo_id) REFERENCES modelo_campo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_campo_unidade_resposta_id FOREIGN KEY (unidade_resposta_id) REFERENCES unidade_resposta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_campo_parametro_vital_id FOREIGN KEY (parametro_vital_id) REFERENCES parametro_vital (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_campo_escala_clinica_id FOREIGN KEY (escala_clinica_id) REFERENCES escala_clinica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_campo_codigo_termo_terminologia_id FOREIGN KEY (codigo_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE modelo_campo_opcao
  ADD CONSTRAINT fk_modelo_campo_opcao_modelo_campo_id FOREIGN KEY (modelo_campo_id) REFERENCES modelo_campo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_campo_opcao_codigo_termo_terminologia_id FOREIGN KEY (codigo_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE modelo_documento_clinico
  ADD CONSTRAINT fk_modelo_documento_clinico_tipo_documento_clinico_id FOREIGN KEY (tipo_documento_clinico_id) REFERENCES tipo_documento_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_documento_clinico_publicada_modelo_documento_versao_id FOREIGN KEY (publicada_modelo_documento_versao_id) REFERENCES modelo_documento_versao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_documento_clinico_cabecalho_impressao_documento_id FOREIGN KEY (cabecalho_impressao_documento_id) REFERENCES cabecalho_impressao_documento (id) ON DELETE RESTRICT;
ALTER TABLE modelo_documento_versao
  ADD CONSTRAINT fk_modelo_documento_versao_modelo_documento_clinico_id FOREIGN KEY (modelo_documento_clinico_id) REFERENCES modelo_documento_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_documento_versao_publicacao_usuario_id FOREIGN KEY (publicacao_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_documento_versao_relatorio_compilado_arquivo_id FOREIGN KEY (relatorio_compilado_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_documento_versao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE modelo_especialidade
  ADD CONSTRAINT fk_modelo_especialidade_modelo_documento_clinico_id FOREIGN KEY (modelo_documento_clinico_id) REFERENCES modelo_documento_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_especialidade_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT;
ALTER TABLE modelo_impressao_clinica
  ADD CONSTRAINT fk_modelo_impressao_clinica_tipo_modelo_impressao_id FOREIGN KEY (tipo_modelo_impressao_id) REFERENCES tipo_modelo_impressao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_impressao_clinica_modelo_documento_clinico_id FOREIGN KEY (modelo_documento_clinico_id) REFERENCES modelo_documento_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_impressao_clinica_tipo_receita_id FOREIGN KEY (tipo_receita_id) REFERENCES tipo_receita (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_impressao_clinica_cabecalho_impressao_documento_id FOREIGN KEY (cabecalho_impressao_documento_id) REFERENCES cabecalho_impressao_documento (id) ON DELETE RESTRICT;
ALTER TABLE modelo_layout
  ADD CONSTRAINT fk_modelo_layout_modelo_documento_versao_id FOREIGN KEY (modelo_documento_versao_id) REFERENCES modelo_documento_versao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_layout_cabecalho_modelo_layout_id FOREIGN KEY (cabecalho_modelo_layout_id) REFERENCES modelo_layout (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_layout_rodape_modelo_layout_id FOREIGN KEY (rodape_modelo_layout_id) REFERENCES modelo_layout (id) ON DELETE RESTRICT;
ALTER TABLE modelo_plano_cuidado
  ADD CONSTRAINT fk_modelo_plano_cuidado_importacao_tabela_id FOREIGN KEY (importacao_tabela_id) REFERENCES importacao_tabela (id) ON DELETE RESTRICT;
ALTER TABLE modelo_plano_cuidado_codigo
  ADD CONSTRAINT fk_modelo_plano_cuidado_codigo_modelo_plano_cuidado_id FOREIGN KEY (modelo_plano_cuidado_id) REFERENCES modelo_plano_cuidado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_plano_cuidado_codigo_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_plano_cuidado_codigo_diagnostico_enfermagem_id FOREIGN KEY (diagnostico_enfermagem_id) REFERENCES diagnostico_enfermagem (id) ON DELETE RESTRICT;
ALTER TABLE modelo_plano_cuidado_elemento
  ADD CONSTRAINT fk_modelo_plano_cuidado_elemento_modelo_plano_cuidado_id FOREIGN KEY (modelo_plano_cuidado_id) REFERENCES modelo_plano_cuidado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_plano_cuidado_elemento_pai FOREIGN KEY (pai_modelo_plano_cuidado_elemento_id) REFERENCES modelo_plano_cuidado_elemento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_plano_cuidado_elemento_intervencao_enfermagem_id FOREIGN KEY (intervencao_enfermagem_id) REFERENCES intervencao_enfermagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_plano_cuidado_elemento_diagnostico_enfermagem_id FOREIGN KEY (diagnostico_enfermagem_id) REFERENCES diagnostico_enfermagem (id) ON DELETE RESTRICT;
ALTER TABLE modelo_receita
  ADD CONSTRAINT fk_modelo_receita_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_receita_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_receita_tipo_receita_id FOREIGN KEY (tipo_receita_id) REFERENCES tipo_receita (id) ON DELETE RESTRICT;
