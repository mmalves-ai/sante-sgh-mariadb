-- Chaves do módulo SUS, lote 02 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE laudo_apac_oncologia
  ADD CONSTRAINT fk_laudo_apac_oncologia_laudo_apac_id FOREIGN KEY (laudo_apac_id) REFERENCES laudo_apac (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_apac_oncologia_localizacao_primaria_dominio_sus_id FOREIGN KEY (localizacao_primaria_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_apac_oncologia_topografia_cid_termo_terminologia_id FOREIGN KEY (topografia_cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_apac_oncologia_estadio_clinico_id FOREIGN KEY (estadio_clinico_id) REFERENCES estadio_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_apac_oncologia_metastase_local_dominio_sus_id FOREIGN KEY (metastase_local_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_apac_oncologia_finalidade_dominio_sus_id FOREIGN KEY (finalidade_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_apac_oncologia_esquema_dominio_sus_id FOREIGN KEY (esquema_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_apac_oncologia_associacao_dominio_sus_id FOREIGN KEY (associacao_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_apac_oncologia_aparelho_dominio_sus_id FOREIGN KEY (aparelho_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_apac_oncologia_area_irradiada_dominio_sus_id FOREIGN KEY (area_irradiada_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_apac_oncologia_tratamento_anterior_dominio_sus_id FOREIGN KEY (tratamento_anterior_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_apac_oncologia_tratamento_anterior_cid_termo_ter_1b5eb4 FOREIGN KEY (tratamento_anterior_cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE laudo_internacao_sus
  ADD CONSTRAINT fk_laudo_internacao_sus_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_internacao_sus_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_internacao_sus_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_internacao_sus_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_internacao_sus_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_internacao_sus_solicitante_externo_id FOREIGN KEY (solicitante_externo_id) REFERENCES solicitante_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_internacao_sus_solicitado_procedimento_sigtap_id FOREIGN KEY (solicitado_procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_internacao_sus_autorizado_procedimento_sigtap_id FOREIGN KEY (autorizado_procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_internacao_sus_anterior_procedimento_sigtap_id FOREIGN KEY (anterior_procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_internacao_sus_cid_principal_termo_terminologia_id FOREIGN KEY (cid_principal_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_internacao_sus_cid_secundario_termo_terminologia_id FOREIGN KEY (cid_secundario_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_internacao_sus_cid_causa_associada_termo_termino_1ed79f FOREIGN KEY (cid_causa_associada_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_internacao_sus_carater_dominio_sus_id FOREIGN KEY (carater_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_internacao_sus_especialidade_leito_id FOREIGN KEY (especialidade_leito_id) REFERENCES especialidade_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_internacao_sus_lote_laudo_sus_id FOREIGN KEY (lote_laudo_sus_id) REFERENCES lote_laudo_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_internacao_sus_autorizador_sus_id FOREIGN KEY (autorizador_sus_id) REFERENCES autorizador_sus (id) ON DELETE RESTRICT;
ALTER TABLE laudo_internacao_sus_especial
  ADD CONSTRAINT fk_laudo_internacao_sus_especial_laudo_internacao_sus_id FOREIGN KEY (laudo_internacao_sus_id) REFERENCES laudo_internacao_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_internacao_sus_especial_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT;
ALTER TABLE leito_uti_habilitado
  ADD CONSTRAINT fk_leito_uti_habilitado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leito_uti_habilitado_tipo_uti_dominio_sus_id FOREIGN KEY (tipo_uti_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leito_uti_habilitado_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT;
ALTER TABLE lote_laudo_sus
  ADD CONSTRAINT fk_lote_laudo_sus_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_laudo_sus_gerado_por_usuario_id FOREIGN KEY (gerado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_laudo_sus_exportado_por_usuario_id FOREIGN KEY (exportado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_laudo_sus_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE mapeamento_resultado_laudo_apac
  ADD CONSTRAINT fk_mapeamento_resultado_laudo_apac_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mapeamento_resultado_laudo_apac_tipo_laudo_apac_id FOREIGN KEY (tipo_laudo_apac_id) REFERENCES tipo_laudo_apac (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mapeamento_resultado_laudo_apac_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mapeamento_resultado_laudo_apac_resultado_exame_item_id FOREIGN KEY (resultado_exame_item_id) REFERENCES exame_item (id) ON DELETE RESTRICT;
ALTER TABLE meta_contratual_sus
  ADD CONSTRAINT fk_meta_contratual_sus_contrato_gestor_sus_id FOREIGN KEY (contrato_gestor_sus_id) REFERENCES contrato_gestor_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meta_contratual_sus_grupo_sigtap_id FOREIGN KEY (grupo_sigtap_id) REFERENCES grupo_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meta_contratual_sus_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meta_contratual_sus_modalidade_dominio_sigtap_id FOREIGN KEY (modalidade_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meta_contratual_sus_complexidade_dominio_sigtap_id FOREIGN KEY (complexidade_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meta_contratual_sus_grupo_procedimento_contrato_sus_id FOREIGN KEY (grupo_procedimento_contrato_sus_id) REFERENCES grupo_procedimento_contrato_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meta_contratual_sus_indicador_contratual_sus_id FOREIGN KEY (indicador_contratual_sus_id) REFERENCES indicador_contratual_sus (id) ON DELETE RESTRICT;
ALTER TABLE notificacao_doador
  ADD CONSTRAINT fk_notificacao_doador_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_doador_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_doador_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_doador_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_doador_notificante_profissional_id FOREIGN KEY (notificante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_doador_central_reguladora_id FOREIGN KEY (central_reguladora_id) REFERENCES central_reguladora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_doador_causa_obito_termo_terminologia_id FOREIGN KEY (causa_obito_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_doador_declaracao_obito_id FOREIGN KEY (declaracao_obito_id) REFERENCES declaracao_obito (id) ON DELETE RESTRICT;
ALTER TABLE ocupacao_cbo_estabelecimento
  ADD CONSTRAINT fk_ocupacao_cbo_estabelecimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocupacao_cbo_estabelecimento_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT;
ALTER TABLE permissao_setor_sus
  ADD CONSTRAINT fk_permissao_setor_sus_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_permissao_setor_sus_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE procedimento_laudo_sus
  ADD CONSTRAINT fk_procedimento_laudo_sus_tipo_laudo_apac_id FOREIGN KEY (tipo_laudo_apac_id) REFERENCES tipo_laudo_apac (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_laudo_sus_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_laudo_sus_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE procedimento_sigtap
  ADD CONSTRAINT fk_procedimento_sigtap_grupo_sigtap_id FOREIGN KEY (grupo_sigtap_id) REFERENCES grupo_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_complexidade_dominio_sigtap_id FOREIGN KEY (complexidade_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_financiamento_dominio_sigtap_id FOREIGN KEY (financiamento_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_subtipo_financiamento_dominio_sigtap_id FOREIGN KEY (subtipo_financiamento_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_rubrica_dominio_sigtap_id FOREIGN KEY (rubrica_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT;
ALTER TABLE procedimento_sigtap_atributo
  ADD CONSTRAINT fk_procedimento_sigtap_atributo_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_atributo_valor_dominio_sigtap_id FOREIGN KEY (valor_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT;
ALTER TABLE procedimento_sigtap_cbo
  ADD CONSTRAINT fk_procedimento_sigtap_cbo_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_cbo_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT;
ALTER TABLE procedimento_sigtap_cid
  ADD CONSTRAINT fk_procedimento_sigtap_cid_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_cid_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE procedimento_sigtap_habilitacao
  ADD CONSTRAINT fk_procedimento_sigtap_habilitacao_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_habilitacao_habilitacao_sigtap_id FOREIGN KEY (habilitacao_sigtap_id) REFERENCES habilitacao_sigtap (id) ON DELETE RESTRICT;
ALTER TABLE procedimento_sigtap_incremento
  ADD CONSTRAINT fk_procedimento_sigtap_incremento_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_incremento_habilitacao_sigtap_id FOREIGN KEY (habilitacao_sigtap_id) REFERENCES habilitacao_sigtap (id) ON DELETE RESTRICT;
ALTER TABLE procedimento_sigtap_leito
  ADD CONSTRAINT fk_procedimento_sigtap_leito_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_leito_especialidade_leito_id FOREIGN KEY (especialidade_leito_id) REFERENCES especialidade_leito (id) ON DELETE RESTRICT;
ALTER TABLE procedimento_sigtap_opm
  ADD CONSTRAINT fk_procedimento_sigtap_opm_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_opm_opm_procedimento_sigtap_id FOREIGN KEY (opm_procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_opm_instrumento_procedimento_domin_a61a56 FOREIGN KEY (instrumento_procedimento_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_opm_instrumento_opm_dominio_sigtap_id FOREIGN KEY (instrumento_opm_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT;
ALTER TABLE procedimento_sigtap_registro
  ADD CONSTRAINT fk_procedimento_sigtap_registro_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_registro_instrumento_dominio_sigtap_id FOREIGN KEY (instrumento_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT;
ALTER TABLE procedimento_sigtap_servico
  ADD CONSTRAINT fk_procedimento_sigtap_servico_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_servico_servico_classificacao_sigtap_id FOREIGN KEY (servico_classificacao_sigtap_id) REFERENCES servico_classificacao_sigtap (id) ON DELETE RESTRICT;
ALTER TABLE procedimento_sigtap_valor
  ADD CONSTRAINT fk_procedimento_sigtap_valor_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT;
ALTER TABLE producao_ambulatorial_sus
  ADD CONSTRAINT fk_producao_ambulatorial_sus_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_ambulatorial_sus_competencia_sus_id FOREIGN KEY (competencia_sus_id) REFERENCES competencia_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_ambulatorial_sus_remessa_bpa_id FOREIGN KEY (remessa_bpa_id) REFERENCES remessa_bpa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_ambulatorial_sus_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_ambulatorial_sus_fechada_por_usuario_id FOREIGN KEY (fechada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE producao_ambulatorial_sus_item
  ADD CONSTRAINT fk_producao_ambulatorial_sus_item_producao_ambulatorial_sus_id FOREIGN KEY (producao_ambulatorial_sus_id) REFERENCES producao_ambulatorial_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_ambulatorial_sus_item_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_ambulatorial_sus_item_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_ambulatorial_sus_item_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_ambulatorial_sus_item_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_ambulatorial_sus_item_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_ambulatorial_sus_item_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_ambulatorial_sus_item_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_ambulatorial_sus_item_carater_dominio_sus_id FOREIGN KEY (carater_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_ambulatorial_sus_item_servico_classificacao_s_c352b9 FOREIGN KEY (servico_classificacao_sigtap_id) REFERENCES servico_classificacao_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_ambulatorial_sus_item_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_ambulatorial_sus_item_executante_setor_funcional_id FOREIGN KEY (executante_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_ambulatorial_sus_item_solicitante_setor_funcional_id FOREIGN KEY (solicitante_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE producao_fixa_setor_sus
  ADD CONSTRAINT fk_producao_fixa_setor_sus_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_fixa_setor_sus_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_fixa_setor_sus_instrumento_dominio_sigtap_id FOREIGN KEY (instrumento_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_fixa_setor_sus_servico_classificacao_sigtap_id FOREIGN KEY (servico_classificacao_sigtap_id) REFERENCES servico_classificacao_sigtap (id) ON DELETE RESTRICT;
ALTER TABLE producao_repasse_sus
  ADD CONSTRAINT fk_producao_repasse_sus_apuracao_repasse_id FOREIGN KEY (apuracao_repasse_id) REFERENCES apuracao_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_repasse_sus_producao_ambulatorial_sus_item_id FOREIGN KEY (producao_ambulatorial_sus_item_id) REFERENCES producao_ambulatorial_sus_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_repasse_sus_apac_procedimento_id FOREIGN KEY (apac_procedimento_id) REFERENCES apac_procedimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_repasse_sus_conta_aih_procedimento_id FOREIGN KEY (conta_aih_procedimento_id) REFERENCES conta_aih_procedimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_repasse_sus_registro_raas_procedimento_id FOREIGN KEY (registro_raas_procedimento_id) REFERENCES registro_raas_procedimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_repasse_sus_executante_profissional_id FOREIGN KEY (executante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_repasse_sus_beneficiario_profissional_id FOREIGN KEY (beneficiario_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_repasse_sus_beneficiario_prestador_terceiro_id FOREIGN KEY (beneficiario_prestador_terceiro_id) REFERENCES prestador_terceiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_repasse_sus_regra_repasse_sus_id FOREIGN KEY (regra_repasse_sus_id) REFERENCES regra_repasse_sus (id) ON DELETE RESTRICT;
ALTER TABLE programacao_orcamentaria_sus
  ADD CONSTRAINT fk_programacao_orcamentaria_sus_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programacao_orcamentaria_sus_contrato_gestor_sus_id FOREIGN KEY (contrato_gestor_sus_id) REFERENCES contrato_gestor_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programacao_orcamentaria_sus_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE programacao_orcamentaria_sus_item
  ADD CONSTRAINT fk_programacao_orcamentaria_sus_item_programacao_orcament_6b65c1 FOREIGN KEY (programacao_orcamentaria_sus_id) REFERENCES programacao_orcamentaria_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programacao_orcamentaria_sus_item_grupo_sigtap_id FOREIGN KEY (grupo_sigtap_id) REFERENCES grupo_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programacao_orcamentaria_sus_item_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programacao_orcamentaria_sus_item_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programacao_orcamentaria_sus_item_financiamento_domini_3d1f30 FOREIGN KEY (financiamento_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT;
ALTER TABLE reapresentacao_sus
  ADD CONSTRAINT fk_reapresentacao_sus_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reapresentacao_sus_rejeicao_sus_id FOREIGN KEY (rejeicao_sus_id) REFERENCES rejeicao_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reapresentacao_sus_original_competencia_sus_id FOREIGN KEY (original_competencia_sus_id) REFERENCES competencia_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reapresentacao_sus_reapresentacao_competencia_sus_id FOREIGN KEY (reapresentacao_competencia_sus_id) REFERENCES competencia_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reapresentacao_sus_justificativa_rejeicao_sus_id FOREIGN KEY (justificativa_rejeicao_sus_id) REFERENCES justificativa_rejeicao_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reapresentacao_sus_reapresentado_por_usuario_id FOREIGN KEY (reapresentado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE registro_ciha
  ADD CONSTRAINT fk_registro_ciha_remessa_ciha_id FOREIGN KEY (remessa_ciha_id) REFERENCES remessa_ciha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_ciha_modalidade_dominio_sus_id FOREIGN KEY (modalidade_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_ciha_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_ciha_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_ciha_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_ciha_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_ciha_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_ciha_cid_principal_termo_terminologia_id FOREIGN KEY (cid_principal_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_ciha_cid_secundario_termo_terminologia_id FOREIGN KEY (cid_secundario_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_ciha_motivo_saida_dominio_sus_id FOREIGN KEY (motivo_saida_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_ciha_declaracao_obito_id FOREIGN KEY (declaracao_obito_id) REFERENCES declaracao_obito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_ciha_fonte_remuneracao_dominio_sus_id FOREIGN KEY (fonte_remuneracao_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_ciha_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_ciha_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE registro_ciha_procedimento
  ADD CONSTRAINT fk_registro_ciha_procedimento_registro_ciha_id FOREIGN KEY (registro_ciha_id) REFERENCES registro_ciha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_ciha_procedimento_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_ciha_procedimento_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE registro_raas
  ADD CONSTRAINT fk_registro_raas_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_raas_competencia_sus_id FOREIGN KEY (competencia_sus_id) REFERENCES competencia_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_raas_remessa_raas_id FOREIGN KEY (remessa_raas_id) REFERENCES remessa_raas (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_raas_continuacao_registro_raas_id FOREIGN KEY (continuacao_registro_raas_id) REFERENCES registro_raas (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_raas_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_raas_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_raas_origem_paciente_dominio_sus_id FOREIGN KEY (origem_paciente_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_raas_cid_principal_termo_terminologia_id FOREIGN KEY (cid_principal_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_raas_cid_secundario1_termo_terminologia_id FOREIGN KEY (cid_secundario1_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_raas_cid_secundario2_termo_terminologia_id FOREIGN KEY (cid_secundario2_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_raas_cid_secundario3_termo_terminologia_id FOREIGN KEY (cid_secundario3_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_raas_cid_causa_associada_termo_terminologia_id FOREIGN KEY (cid_causa_associada_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_raas_destino_dominio_sus_id FOREIGN KEY (destino_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_raas_fechado_por_usuario_id FOREIGN KEY (fechado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE registro_raas_procedimento
  ADD CONSTRAINT fk_registro_raas_procedimento_registro_raas_id FOREIGN KEY (registro_raas_id) REFERENCES registro_raas (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_raas_procedimento_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_raas_procedimento_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_raas_procedimento_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_raas_procedimento_servico_classificacao_sigtap_id FOREIGN KEY (servico_classificacao_sigtap_id) REFERENCES servico_classificacao_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_raas_procedimento_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE regra_agrupamento_producao_sus
  ADD CONSTRAINT fk_regra_agrupamento_producao_sus_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_agrupamento_producao_sus_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_agrupamento_producao_sus_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_agrupamento_producao_sus_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_agrupamento_producao_sus_tipo_vinculo_trabalho_id FOREIGN KEY (tipo_vinculo_trabalho_id) REFERENCES tipo_vinculo_trabalho (id) ON DELETE RESTRICT;
ALTER TABLE regra_critica_sus
  ADD CONSTRAINT fk_regra_critica_sus_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_critica_sus_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_critica_sus_grupo_sigtap_id FOREIGN KEY (grupo_sigtap_id) REFERENCES grupo_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_critica_sus_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_critica_sus_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT;
ALTER TABLE regra_geracao_ciha
  ADD CONSTRAINT fk_regra_geracao_ciha_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_geracao_ciha_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_geracao_ciha_local_atendimento_id FOREIGN KEY (local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_geracao_ciha_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_geracao_ciha_modalidade_dominio_sus_id FOREIGN KEY (modalidade_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_geracao_ciha_fonte_remuneracao_dominio_sus_id FOREIGN KEY (fonte_remuneracao_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT;
ALTER TABLE regra_prestador_sus
  ADD CONSTRAINT fk_regra_prestador_sus_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_prestador_sus_tipo_prestador_dominio_sigtap_id FOREIGN KEY (tipo_prestador_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_prestador_sus_natureza_juridica_id FOREIGN KEY (natureza_juridica_id) REFERENCES natureza_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_prestador_sus_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_prestador_sus_grupo_sigtap_id FOREIGN KEY (grupo_sigtap_id) REFERENCES grupo_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_prestador_sus_servico_classificacao_sigtap_id FOREIGN KEY (servico_classificacao_sigtap_id) REFERENCES servico_classificacao_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_prestador_sus_instrumento_dominio_sigtap_id FOREIGN KEY (instrumento_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT;
ALTER TABLE regra_profissional_automatico_aih
  ADD CONSTRAINT fk_regra_profissional_automatico_aih_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_profissional_automatico_aih_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_profissional_automatico_aih_grupo_sigtap_id FOREIGN KEY (grupo_sigtap_id) REFERENCES grupo_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_profissional_automatico_aih_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_profissional_automatico_aih_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT;
ALTER TABLE regra_rateio_sadt_aih
  ADD CONSTRAINT fk_regra_rateio_sadt_aih_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_rateio_sadt_aih_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_rateio_sadt_aih_grupo_sigtap_id FOREIGN KEY (grupo_sigtap_id) REFERENCES grupo_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_rateio_sadt_aih_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_rateio_sadt_aih_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE regra_repasse_sus
  ADD CONSTRAINT fk_regra_repasse_sus_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_sus_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_sus_grupo_sigtap_id FOREIGN KEY (grupo_sigtap_id) REFERENCES grupo_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_sus_especialidade_leito_id FOREIGN KEY (especialidade_leito_id) REFERENCES especialidade_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_sus_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_sus_local_atendimento_id FOREIGN KEY (local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_sus_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE regra_servico_classificacao_sus
  ADD CONSTRAINT fk_regra_servico_classificacao_sus_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_servico_classificacao_sus_servico_classificacao__ad100f FOREIGN KEY (servico_classificacao_sigtap_id) REFERENCES servico_classificacao_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_servico_classificacao_sus_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_servico_classificacao_sus_grupo_sigtap_id FOREIGN KEY (grupo_sigtap_id) REFERENCES grupo_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_servico_classificacao_sus_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_servico_classificacao_sus_local_atendimento_id FOREIGN KEY (local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE rejeicao_sus
  ADD CONSTRAINT fk_rejeicao_sus_retorno_sus_id FOREIGN KEY (retorno_sus_id) REFERENCES retorno_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rejeicao_sus_competencia_sus_id FOREIGN KEY (competencia_sus_id) REFERENCES competencia_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rejeicao_sus_motivo_rejeicao_sus_id FOREIGN KEY (motivo_rejeicao_sus_id) REFERENCES motivo_rejeicao_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rejeicao_sus_justificativa_rejeicao_sus_id FOREIGN KEY (justificativa_rejeicao_sus_id) REFERENCES justificativa_rejeicao_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rejeicao_sus_conta_aih_id FOREIGN KEY (conta_aih_id) REFERENCES conta_aih (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rejeicao_sus_apac_id FOREIGN KEY (apac_id) REFERENCES apac (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rejeicao_sus_producao_ambulatorial_sus_item_id FOREIGN KEY (producao_ambulatorial_sus_item_id) REFERENCES producao_ambulatorial_sus_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rejeicao_sus_registro_raas_id FOREIGN KEY (registro_raas_id) REFERENCES registro_raas (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rejeicao_sus_registro_ciha_id FOREIGN KEY (registro_ciha_id) REFERENCES registro_ciha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rejeicao_sus_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT;
ALTER TABLE remessa_apac
  ADD CONSTRAINT fk_remessa_apac_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_apac_competencia_sus_id FOREIGN KEY (competencia_sus_id) REFERENCES competencia_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_apac_responsavel_setor_funcional_id FOREIGN KEY (responsavel_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_apac_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_apac_fechada_por_usuario_id FOREIGN KEY (fechada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
