-- Chaves do lote 06_PEP-11 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE solucao_preservacao_orgao
  ADD CONSTRAINT fk_solucao_preservacao_orgao_doador_orgao_id FOREIGN KEY (doador_orgao_id) REFERENCES doador_orgao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solucao_preservacao_orgao_orgao_transplante_id FOREIGN KEY (orgao_transplante_id) REFERENCES orgao_transplante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solucao_preservacao_orgao_receptor_transplante_id FOREIGN KEY (receptor_transplante_id) REFERENCES receptor_transplante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solucao_preservacao_orgao_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE subgrupo_exibicao_prescricao
  ADD CONSTRAINT fk_subgrupo_exibicao_prescricao_grupo_exibicao_prescricao_id FOREIGN KEY (grupo_exibicao_prescricao_id) REFERENCES grupo_exibicao_prescricao (id) ON DELETE RESTRICT;
ALTER TABLE sumario_alta
  ADD CONSTRAINT fk_sumario_alta_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sumario_alta_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sumario_alta_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sumario_alta_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sumario_alta_alta_medica_id FOREIGN KEY (alta_medica_id) REFERENCES alta_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sumario_alta_motivo_saida_hospitalar_id FOREIGN KEY (motivo_saida_hospitalar_id) REFERENCES motivo_saida_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sumario_alta_tipo_encaminhamento_id FOREIGN KEY (tipo_encaminhamento_id) REFERENCES tipo_encaminhamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sumario_alta_modalidade_assistencial_id FOREIGN KEY (modalidade_assistencial_id) REFERENCES modalidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sumario_alta_servico_atendimento_id FOREIGN KEY (servico_atendimento_id) REFERENCES servico_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sumario_alta_procedimento_entrada_item_faturavel_id FOREIGN KEY (procedimento_entrada_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sumario_alta_procedimento_principal_item_faturavel_id FOREIGN KEY (procedimento_principal_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sumario_alta_declaracao_obito_id FOREIGN KEY (declaracao_obito_id) REFERENCES declaracao_obito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sumario_alta_obito_setor_funcional_id FOREIGN KEY (obito_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sumario_alta_finalizado_usuario_id FOREIGN KEY (finalizado_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sumario_alta_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sumario_alta_retificado_sumario_alta_id FOREIGN KEY (retificado_sumario_alta_id) REFERENCES sumario_alta (id) ON DELETE RESTRICT;
ALTER TABLE sumario_alta_secao
  ADD CONSTRAINT fk_sumario_alta_secao_sumario_alta_id FOREIGN KEY (sumario_alta_id) REFERENCES sumario_alta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sumario_alta_secao_tipo_diagnostico_id FOREIGN KEY (tipo_diagnostico_id) REFERENCES tipo_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sumario_alta_secao_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sumario_alta_secao_situacao_procedimento_prescrito_id FOREIGN KEY (situacao_procedimento_prescrito_id) REFERENCES situacao_procedimento_prescrito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sumario_alta_secao_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sumario_alta_secao_alergia_paciente_id FOREIGN KEY (alergia_paciente_id) REFERENCES alergia_paciente (id) ON DELETE RESTRICT;
ALTER TABLE talonario_receita_controle
  ADD CONSTRAINT fk_talonario_receita_controle_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_talonario_receita_controle_tipo_receita_id FOREIGN KEY (tipo_receita_id) REFERENCES tipo_receita (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_talonario_receita_controle_unidade_federativa_id FOREIGN KEY (unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_talonario_receita_controle_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE terapia_nutricional
  ADD CONSTRAINT fk_terapia_nutricional_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_terapia_nutricional_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_terapia_nutricional_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_terapia_nutricional_prescricao_id FOREIGN KEY (prescricao_id) REFERENCES prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_terapia_nutricional_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_terapia_nutricional_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_terapia_nutricional_calculo_profissional_id FOREIGN KEY (calculo_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_terapia_nutricional_liberada_usuario_id FOREIGN KEY (liberada_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE termo_consentimento_modelo
  ADD CONSTRAINT fk_termo_consentimento_modelo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_consentimento_modelo_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_consentimento_modelo_proprietario_profissional_id FOREIGN KEY (proprietario_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_consentimento_modelo_tipo_documento_clinico_id FOREIGN KEY (tipo_documento_clinico_id) REFERENCES tipo_documento_clinico (id) ON DELETE RESTRICT;
ALTER TABLE termo_consentimento_modelo_profissional
  ADD CONSTRAINT fk_termo_consentimento_modelo_profissional_termo_consen_46e6decf FOREIGN KEY (termo_consentimento_modelo_id) REFERENCES termo_consentimento_modelo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_consentimento_modelo_profissional_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE termo_consentimento_paciente
  ADD CONSTRAINT fk_termo_consentimento_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_consentimento_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_consentimento_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_consentimento_paciente_termo_consentimento_modelo_id FOREIGN KEY (termo_consentimento_modelo_id) REFERENCES termo_consentimento_modelo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_consentimento_paciente_situacao_termo_consentimento_id FOREIGN KEY (situacao_termo_consentimento_id) REFERENCES situacao_termo_consentimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_consentimento_paciente_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_consentimento_paciente_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_consentimento_paciente_tipo_assinante_id FOREIGN KEY (tipo_assinante_id) REFERENCES tipo_assinante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_consentimento_paciente_responsavel_pessoa_fisica_id FOREIGN KEY (responsavel_pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_consentimento_paciente_tipo_parentesco_id FOREIGN KEY (tipo_parentesco_id) REFERENCES tipo_parentesco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_consentimento_paciente_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_consentimento_paciente_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE termo_consentimento_procedimento
  ADD CONSTRAINT fk_termo_consentimento_procedimento_termo_consentimento_450f46b4 FOREIGN KEY (termo_consentimento_modelo_id) REFERENCES termo_consentimento_modelo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_consentimento_procedimento_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE texto_padrao_campo_contexto
  ADD CONSTRAINT fk_texto_padrao_campo_contexto_texto_padrao_campo_modelo_id FOREIGN KEY (texto_padrao_campo_modelo_id) REFERENCES texto_padrao_campo_modelo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_texto_padrao_campo_contexto_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_texto_padrao_campo_contexto_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_texto_padrao_campo_contexto_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_texto_padrao_campo_contexto_categoria_atendimento_id FOREIGN KEY (categoria_atendimento_id) REFERENCES categoria_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_texto_padrao_campo_contexto_categoria_profissional_id FOREIGN KEY (categoria_profissional_id) REFERENCES categoria_profissional (id) ON DELETE RESTRICT;
ALTER TABLE texto_padrao_campo_modelo
  ADD CONSTRAINT fk_texto_padrao_campo_modelo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_texto_padrao_campo_modelo_modelo_campo_id FOREIGN KEY (modelo_campo_id) REFERENCES modelo_campo (id) ON DELETE RESTRICT;
ALTER TABLE tipo_acuidade_visual
  ADD CONSTRAINT fk_tipo_acuidade_visual_tipo_exame_oftalmologico_id FOREIGN KEY (tipo_exame_oftalmologico_id) REFERENCES tipo_exame_oftalmologico (id) ON DELETE RESTRICT;
ALTER TABLE tipo_alergia
  ADD CONSTRAINT fk_tipo_alergia_categoria_alergeno_id FOREIGN KEY (categoria_alergeno_id) REFERENCES categoria_alergeno (id) ON DELETE RESTRICT;
ALTER TABLE tipo_dispositivo_invasivo
  ADD CONSTRAINT fk_tipo_dispositivo_invasivo_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_dispositivo_invasivo_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_dispositivo_invasivo_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT;
ALTER TABLE tipo_documento_clinico
  ADD CONSTRAINT fk_tipo_documento_clinico_tipo_exigencia_assinatura_id FOREIGN KEY (tipo_exigencia_assinatura_id) REFERENCES tipo_exigencia_assinatura (id) ON DELETE RESTRICT;
ALTER TABLE tipo_evento_oncologico_profissional
  ADD CONSTRAINT fk_tipo_evento_oncologico_profissional_tipo_evento_oncologico_id FOREIGN KEY (tipo_evento_oncologico_id) REFERENCES tipo_evento_oncologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_evento_oncologico_profissional_categoria_profissional_id FOREIGN KEY (categoria_profissional_id) REFERENCES categoria_profissional (id) ON DELETE RESTRICT;
ALTER TABLE tipo_exame_oftalmologico
  ADD CONSTRAINT fk_tipo_exame_oftalmologico_grupo_exame_oftalmologico_id FOREIGN KEY (grupo_exame_oftalmologico_id) REFERENCES grupo_exame_oftalmologico (id) ON DELETE RESTRICT;
ALTER TABLE tipo_ganho_perda
  ADD CONSTRAINT fk_tipo_ganho_perda_grupo_balanco_hidrico_id FOREIGN KEY (grupo_balanco_hidrico_id) REFERENCES grupo_balanco_hidrico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_ganho_perda_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE tipo_item_prescricao
  ADD CONSTRAINT fk_tipo_item_prescricao_grupo_exibicao_prescricao_id FOREIGN KEY (grupo_exibicao_prescricao_id) REFERENCES grupo_exibicao_prescricao (id) ON DELETE RESTRICT;
ALTER TABLE tipo_item_prescricao_frequencia
  ADD CONSTRAINT fk_tipo_item_prescricao_frequencia_tipo_item_prescricao_id FOREIGN KEY (tipo_item_prescricao_id) REFERENCES tipo_item_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_item_prescricao_frequencia_frequencia_administracao_id FOREIGN KEY (frequencia_administracao_id) REFERENCES frequencia_administracao (id) ON DELETE RESTRICT;
ALTER TABLE tipo_item_prescricao_infusao
  ADD CONSTRAINT fk_tipo_item_prescricao_infusao_tipo_item_prescricao_id FOREIGN KEY (tipo_item_prescricao_id) REFERENCES tipo_item_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_item_prescricao_infusao_tipo_infusao_id FOREIGN KEY (tipo_infusao_id) REFERENCES tipo_infusao (id) ON DELETE RESTRICT;
ALTER TABLE tipo_item_prescricao_unidade
  ADD CONSTRAINT fk_tipo_item_prescricao_unidade_tipo_item_prescricao_id FOREIGN KEY (tipo_item_prescricao_id) REFERENCES tipo_item_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_item_prescricao_unidade_unidade_prescricao_id FOREIGN KEY (unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT;
ALTER TABLE tipo_item_prescricao_via
  ADD CONSTRAINT fk_tipo_item_prescricao_via_tipo_item_prescricao_id FOREIGN KEY (tipo_item_prescricao_id) REFERENCES tipo_item_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_item_prescricao_via_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT;
