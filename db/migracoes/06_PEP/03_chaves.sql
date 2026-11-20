-- PEP, lote 03: chaves (aplicadas depois de todos os tabelas.sql)
-- Nomes de chave com mais de 64 caracteres (limite do MariaDB) foram encurtados: 55 primeiros caracteres + 8 do md5 do nome completo.
ALTER TABLE contencao_paciente_avaliacao
  ADD CONSTRAINT fk_contencao_paciente_avaliacao_contencao_paciente_id FOREIGN KEY (contencao_paciente_id) REFERENCES contencao_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contencao_paciente_avaliacao_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE conversao_unidade_afericao
  ADD CONSTRAINT fk_conversao_unidade_afericao_parametro_vital_id FOREIGN KEY (parametro_vital_id) REFERENCES parametro_vital (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conversao_unidade_afericao_base_unidade_medida_id FOREIGN KEY (base_unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conversao_unidade_afericao_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE copia_contingencia_prontuario
  ADD CONSTRAINT fk_copia_contingencia_prontuario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_copia_contingencia_prontuario_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_copia_contingencia_prontuario_tipo_documento_clinico_id FOREIGN KEY (tipo_documento_clinico_id) REFERENCES tipo_documento_clinico (id) ON DELETE RESTRICT;
ALTER TABLE correspondencia_ciap_cid
  ADD CONSTRAINT fk_correspondencia_ciap_cid_ciap_termo_terminologia_id FOREIGN KEY (ciap_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_correspondencia_ciap_cid_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE correspondencia_cid_morfologia
  ADD CONSTRAINT fk_correspondencia_cid_morfologia_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_correspondencia_cid_morfologia_morfologia_termo_term_4ee8e614 FOREIGN KEY (morfologia_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE criterio_resposta_rapida
  ADD CONSTRAINT fk_criterio_resposta_rapida_parametro_vital_id FOREIGN KEY (parametro_vital_id) REFERENCES parametro_vital (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_criterio_resposta_rapida_escala_clinica_id FOREIGN KEY (escala_clinica_id) REFERENCES escala_clinica (id) ON DELETE RESTRICT;
ALTER TABLE cuidado_enfermagem
  ADD CONSTRAINT fk_cuidado_enfermagem_frequencia_administracao_id FOREIGN KEY (frequencia_administracao_id) REFERENCES frequencia_administracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cuidado_enfermagem_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cuidado_enfermagem_sexo_id FOREIGN KEY (sexo_id) REFERENCES sexo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cuidado_enfermagem_idade_minima_unidade_idade_id FOREIGN KEY (idade_minima_unidade_idade_id) REFERENCES unidade_idade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cuidado_enfermagem_idade_maxima_unidade_idade_id FOREIGN KEY (idade_maxima_unidade_idade_id) REFERENCES unidade_idade (id) ON DELETE RESTRICT;
ALTER TABLE cuidado_sugerido_achado
  ADD CONSTRAINT fk_cuidado_sugerido_achado_achado_exame_fisico_padrao_id FOREIGN KEY (achado_exame_fisico_padrao_id) REFERENCES achado_exame_fisico_padrao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cuidado_sugerido_achado_cuidado_enfermagem_id FOREIGN KEY (cuidado_enfermagem_id) REFERENCES cuidado_enfermagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cuidado_sugerido_achado_frequencia_administracao_id FOREIGN KEY (frequencia_administracao_id) REFERENCES frequencia_administracao (id) ON DELETE RESTRICT;
ALTER TABLE curva_referencia
  ADD CONSTRAINT fk_curva_referencia_sexo_id FOREIGN KEY (sexo_id) REFERENCES sexo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_curva_referencia_parametro_vital_id FOREIGN KEY (parametro_vital_id) REFERENCES parametro_vital (id) ON DELETE RESTRICT;
ALTER TABLE curva_referencia_ponto
  ADD CONSTRAINT fk_curva_referencia_ponto_curva_referencia_id FOREIGN KEY (curva_referencia_id) REFERENCES curva_referencia (id) ON DELETE RESTRICT;
ALTER TABLE decisao_alerta
  ADD CONSTRAINT fk_decisao_alerta_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_decisao_alerta_regra_alerta_id FOREIGN KEY (regra_alerta_id) REFERENCES regra_alerta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_decisao_alerta_tipo_alerta_clinico_id FOREIGN KEY (tipo_alerta_clinico_id) REFERENCES tipo_alerta_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_decisao_alerta_decidido_por_profissional_id FOREIGN KEY (decidido_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_decisao_alerta_avaliacao_farmaceutica_id FOREIGN KEY (avaliacao_farmaceutica_id) REFERENCES avaliacao_farmaceutica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_decisao_alerta_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT;
ALTER TABLE declaracao_nascido_vivo
  ADD CONSTRAINT fk_declaracao_nascido_vivo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_nascido_vivo_registro_nascimento_id FOREIGN KEY (registro_nascimento_id) REFERENCES registro_nascimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_nascido_vivo_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_nascido_vivo_recem_nascido_paciente_id FOREIGN KEY (recem_nascido_paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_nascido_vivo_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_nascido_vivo_cancelada_por_usuario_id FOREIGN KEY (cancelada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE declaracao_obito
  ADD CONSTRAINT fk_declaracao_obito_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_obito_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_obito_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_obito_formulario_declaracao_obito_id FOREIGN KEY (formulario_declaracao_obito_id) REFERENCES formulario_declaracao_obito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_obito_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_obito_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_obito_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_obito_servico_funerario_id FOREIGN KEY (servico_funerario_id) REFERENCES servico_funerario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_obito_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT;
ALTER TABLE declaracao_obito_causa
  ADD CONSTRAINT fk_declaracao_obito_causa_declaracao_obito_id FOREIGN KEY (declaracao_obito_id) REFERENCES declaracao_obito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_obito_causa_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE declaracao_obito_evento
  ADD CONSTRAINT fk_declaracao_obito_evento_declaracao_obito_id FOREIGN KEY (declaracao_obito_id) REFERENCES declaracao_obito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_obito_evento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE destino_campo_estruturado
  ADD CONSTRAINT fk_destino_campo_estruturado_parametro_vital_id FOREIGN KEY (parametro_vital_id) REFERENCES parametro_vital (id) ON DELETE RESTRICT;
ALTER TABLE destino_encaminhamento_externo
  ADD CONSTRAINT fk_destino_encaminhamento_externo_estabelecimento_externo_id FOREIGN KEY (estabelecimento_externo_id) REFERENCES estabelecimento_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_destino_encaminhamento_externo_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE diagnostico_atendimento
  ADD CONSTRAINT fk_diagnostico_atendimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_atendimento_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_atendimento_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_atendimento_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_atendimento_snomed_termo_terminologia_id FOREIGN KEY (snomed_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_atendimento_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_atendimento_diagnostico_pai_id FOREIGN KEY (diagnostico_pai_id) REFERENCES diagnostico_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_atendimento_prescricao_id FOREIGN KEY (prescricao_id) REFERENCES prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_atendimento_protocolo_gerenciado_id FOREIGN KEY (protocolo_gerenciado_id) REFERENCES protocolo_gerenciado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_atendimento_problema_paciente_id FOREIGN KEY (problema_paciente_id) REFERENCES problema_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_atendimento_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_atendimento_inativado_por_profissional_id FOREIGN KEY (inativado_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE diagnostico_enfermagem
  ADD CONSTRAINT fk_diagnostico_enfermagem_dominio_diagnostico_enfermagem_id FOREIGN KEY (dominio_diagnostico_enfermagem_id) REFERENCES dominio_diagnostico_enfermagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_enfermagem_classe_diagnostico_enfermagem_id FOREIGN KEY (classe_diagnostico_enfermagem_id) REFERENCES classe_diagnostico_enfermagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_enfermagem_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE diagnostico_enfermagem_associado
  ADD CONSTRAINT fk_diagnostico_enfermagem_associado_diagnostico_enfermagem_id FOREIGN KEY (diagnostico_enfermagem_id) REFERENCES diagnostico_enfermagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_enfermagem_associado_associado_diagnosti_b4d81e33 FOREIGN KEY (associado_diagnostico_enfermagem_id) REFERENCES diagnostico_enfermagem (id) ON DELETE RESTRICT;
ALTER TABLE diagnostico_enfermagem_caracteristica
  ADD CONSTRAINT fk_diagnostico_enfermagem_caracteristica_diagnostico_en_a4d90e39 FOREIGN KEY (diagnostico_enfermagem_id) REFERENCES diagnostico_enfermagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_enfermagem_caracteristica_caracteristica_2ad1af38 FOREIGN KEY (caracteristica_diagnostico_enfermagem_id) REFERENCES caracteristica_diagnostico_enfermagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_enfermagem_caracteristica_grupo_caracter_dc24e760 FOREIGN KEY (grupo_caracteristica_enfermagem_id) REFERENCES grupo_caracteristica_enfermagem (id) ON DELETE RESTRICT;
ALTER TABLE diagnostico_enfermagem_paciente
  ADD CONSTRAINT fk_diagnostico_enfermagem_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_enfermagem_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_enfermagem_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_enfermagem_paciente_diagnostico_enfermagem_id FOREIGN KEY (diagnostico_enfermagem_id) REFERENCES diagnostico_enfermagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_enfermagem_paciente_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_enfermagem_paciente_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_enfermagem_paciente_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_enfermagem_paciente_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_enfermagem_paciente_resolvido_por_profissional_id FOREIGN KEY (resolvido_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE diagnostico_enfermagem_paciente_caracteristica
  ADD CONSTRAINT fk_diagnostico_enfermagem_paciente_caracteristica_diagn_5a6718c8 FOREIGN KEY (diagnostico_enfermagem_paciente_id) REFERENCES diagnostico_enfermagem_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_enfermagem_paciente_caracteristica_carac_c2a9b901 FOREIGN KEY (caracteristica_diagnostico_enfermagem_id) REFERENCES caracteristica_diagnostico_enfermagem (id) ON DELETE RESTRICT;
ALTER TABLE diagnostico_enfermagem_setor
  ADD CONSTRAINT fk_diagnostico_enfermagem_setor_diagnostico_enfermagem_id FOREIGN KEY (diagnostico_enfermagem_id) REFERENCES diagnostico_enfermagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_enfermagem_setor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE diagnostico_oncologico
  ADD CONSTRAINT fk_diagnostico_oncologico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_oncologico_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_oncologico_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_oncologico_diagnostico_atendimento_id FOREIGN KEY (diagnostico_atendimento_id) REFERENCES diagnostico_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_oncologico_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_oncologico_topografia_tumor_id FOREIGN KEY (topografia_tumor_id) REFERENCES topografia_tumor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_oncologico_morfologia_termo_terminologia_id FOREIGN KEY (morfologia_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_oncologico_grau_histologico_id FOREIGN KEY (grau_histologico_id) REFERENCES grau_histologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_oncologico_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_oncologico_inativado_por_profissional_id FOREIGN KEY (inativado_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE diagnostico_resultado_enfermagem
  ADD CONSTRAINT fk_diagnostico_resultado_enfermagem_diagnostico_enfermagem_id FOREIGN KEY (diagnostico_enfermagem_id) REFERENCES diagnostico_enfermagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_resultado_enfermagem_resultado_enfermagem_id FOREIGN KEY (resultado_enfermagem_id) REFERENCES resultado_enfermagem (id) ON DELETE RESTRICT;
ALTER TABLE dialisador
  ADD CONSTRAINT fk_dialisador_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dialisador_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dialisador_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dialisador_aberto_por_usuario_id FOREIGN KEY (aberto_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dialisador_fechado_por_usuario_id FOREIGN KEY (fechado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dialisador_desativado_por_usuario_id FOREIGN KEY (desativado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE discriminador_classificacao_risco
  ADD CONSTRAINT fk_discriminador_classificacao_risco_fluxograma_classif_7904910c FOREIGN KEY (fluxograma_classificacao_risco_id) REFERENCES fluxograma_classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_discriminador_classificacao_risco_nivel_prioridade_id FOREIGN KEY (nivel_prioridade_id) REFERENCES nivel_prioridade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_discriminador_classificacao_risco_parametro_vital_id FOREIGN KEY (parametro_vital_id) REFERENCES parametro_vital (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_discriminador_classificacao_risco_escala_clinica_id FOREIGN KEY (escala_clinica_id) REFERENCES escala_clinica (id) ON DELETE RESTRICT;
ALTER TABLE discriminador_fator_afericao
  ADD CONSTRAINT fk_discriminador_fator_afericao_discriminador_classific_ba6eb723 FOREIGN KEY (discriminador_classificacao_risco_id) REFERENCES discriminador_classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_discriminador_fator_afericao_parametro_vital_id FOREIGN KEY (parametro_vital_id) REFERENCES parametro_vital (id) ON DELETE RESTRICT;
ALTER TABLE dispositivo_invasivo_paciente
  ADD CONSTRAINT fk_dispositivo_invasivo_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispositivo_invasivo_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispositivo_invasivo_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispositivo_invasivo_paciente_tipo_dispositivo_invasivo_id FOREIGN KEY (tipo_dispositivo_invasivo_id) REFERENCES tipo_dispositivo_invasivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispositivo_invasivo_paciente_local_acesso_invasivo_id FOREIGN KEY (local_acesso_invasivo_id) REFERENCES local_acesso_invasivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispositivo_invasivo_paciente_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispositivo_invasivo_paciente_ato_cirurgico_id FOREIGN KEY (ato_cirurgico_id) REFERENCES ato_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispositivo_invasivo_paciente_insercao_prescricao_item_id FOREIGN KEY (insercao_prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispositivo_invasivo_paciente_retirada_prescricao_item_id FOREIGN KEY (retirada_prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispositivo_invasivo_paciente_inserido_por_profissional_id FOREIGN KEY (inserido_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispositivo_invasivo_paciente_retirado_por_profissional_id FOREIGN KEY (retirado_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispositivo_invasivo_paciente_cancelado_por_usuario_id FOREIGN KEY (cancelado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE dispositivo_invasivo_evento
  ADD CONSTRAINT fk_dispositivo_invasivo_evento_dispositivo_invasivo_paciente_id FOREIGN KEY (dispositivo_invasivo_paciente_id) REFERENCES dispositivo_invasivo_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispositivo_invasivo_evento_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispositivo_invasivo_evento_local_afericao_id FOREIGN KEY (local_afericao_id) REFERENCES local_afericao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispositivo_invasivo_evento_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispositivo_invasivo_evento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE doador_orgao
  ADD CONSTRAINT fk_doador_orgao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_doador_orgao_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_doador_orgao_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_doador_orgao_tipo_parentesco_id FOREIGN KEY (tipo_parentesco_id) REFERENCES tipo_parentesco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_doador_orgao_captacao_municipio_ibge_id FOREIGN KEY (captacao_municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_doador_orgao_captacao_estabelecimento_externo_id FOREIGN KEY (captacao_estabelecimento_externo_id) REFERENCES estabelecimento_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_doador_orgao_equipe_profissional_id FOREIGN KEY (equipe_profissional_id) REFERENCES equipe_profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_doador_orgao_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_doador_orgao_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT;
ALTER TABLE doador_antibiotico
  ADD CONSTRAINT fk_doador_antibiotico_doador_orgao_id FOREIGN KEY (doador_orgao_id) REFERENCES doador_orgao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_doador_antibiotico_antimicrobiano_id FOREIGN KEY (antimicrobiano_id) REFERENCES antimicrobiano (id) ON DELETE RESTRICT;
ALTER TABLE doador_receptor
  ADD CONSTRAINT fk_doador_receptor_doador_orgao_id FOREIGN KEY (doador_orgao_id) REFERENCES doador_orgao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_doador_receptor_receptor_transplante_id FOREIGN KEY (receptor_transplante_id) REFERENCES receptor_transplante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_doador_receptor_orgao_transplante_id FOREIGN KEY (orgao_transplante_id) REFERENCES orgao_transplante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_doador_receptor_tipo_parentesco_id FOREIGN KEY (tipo_parentesco_id) REFERENCES tipo_parentesco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_doador_receptor_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT;
ALTER TABLE documento_prontuario
  ADD CONSTRAINT fk_documento_prontuario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_prontuario_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_prontuario_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_prontuario_tipo_documento_clinico_id FOREIGN KEY (tipo_documento_clinico_id) REFERENCES tipo_documento_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_prontuario_modelo_documento_clinico_id FOREIGN KEY (modelo_documento_clinico_id) REFERENCES modelo_documento_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_prontuario_situacao_documento_prontuario_id FOREIGN KEY (situacao_documento_prontuario_id) REFERENCES situacao_documento_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_prontuario_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_prontuario_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_prontuario_autorizador_profissional_id FOREIGN KEY (autorizador_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_prontuario_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_prontuario_local_assistencia_id FOREIGN KEY (local_assistencia_id) REFERENCES local_assistencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_prontuario_substitui_documento_prontuario_id FOREIGN KEY (substitui_documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_prontuario_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_prontuario_documento_assinado_id FOREIGN KEY (documento_assinado_id) REFERENCES documento_assinado (id) ON DELETE RESTRICT;
ALTER TABLE documento_prontuario_evento
  ADD CONSTRAINT fk_documento_prontuario_evento_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_prontuario_evento_situacao_documento_prontuario_id FOREIGN KEY (situacao_documento_prontuario_id) REFERENCES situacao_documento_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_prontuario_evento_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_prontuario_evento_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_prontuario_evento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE documento_emitido
  ADD CONSTRAINT fk_documento_emitido_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_emitido_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_emitido_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_emitido_modelo_documento_clinico_id FOREIGN KEY (modelo_documento_clinico_id) REFERENCES modelo_documento_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_emitido_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_emitido_acompanhante_responsavel_profissional_id FOREIGN KEY (acompanhante_responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_emitido_local_assistencia_id FOREIGN KEY (local_assistencia_id) REFERENCES local_assistencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_emitido_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_emitido_suspenso_por_profissional_id FOREIGN KEY (suspenso_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_emitido_corrige_documento_emitido_id FOREIGN KEY (corrige_documento_emitido_id) REFERENCES documento_emitido (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_emitido_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_emitido_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE documento_emitido_versao
  ADD CONSTRAINT fk_documento_emitido_versao_documento_emitido_id FOREIGN KEY (documento_emitido_id) REFERENCES documento_emitido (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_emitido_versao_motivo_reimpressao_id FOREIGN KEY (motivo_reimpressao_id) REFERENCES motivo_reimpressao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_emitido_versao_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_emitido_versao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE dominio_diagnostico_enfermagem
  ADD CONSTRAINT fk_dominio_diagnostico_enfermagem_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE encaminhamento_externo_classificacao
  ADD CONSTRAINT fk_encaminhamento_externo_classificacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encaminhamento_externo_classificacao_classificacao_risco_id FOREIGN KEY (classificacao_risco_id) REFERENCES classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encaminhamento_externo_classificacao_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encaminhamento_externo_classificacao_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encaminhamento_externo_classificacao_destino_encamin_c427bb59 FOREIGN KEY (destino_encaminhamento_externo_id) REFERENCES destino_encaminhamento_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encaminhamento_externo_classificacao_encaminhado_por_75292408 FOREIGN KEY (encaminhado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encaminhamento_externo_classificacao_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encaminhamento_externo_classificacao_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT;
ALTER TABLE encaminhamento_paciente
  ADD CONSTRAINT fk_encaminhamento_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encaminhamento_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encaminhamento_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encaminhamento_paciente_tipo_encaminhamento_id FOREIGN KEY (tipo_encaminhamento_id) REFERENCES tipo_encaminhamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encaminhamento_paciente_origem_profissional_id FOREIGN KEY (origem_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encaminhamento_paciente_origem_especialidade_medica_id FOREIGN KEY (origem_especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encaminhamento_paciente_destino_profissional_id FOREIGN KEY (destino_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encaminhamento_paciente_destino_especialidade_medica_id FOREIGN KEY (destino_especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encaminhamento_paciente_destino_servico_atendimento_id FOREIGN KEY (destino_servico_atendimento_id) REFERENCES servico_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encaminhamento_paciente_destino_estabelecimento_externo_id FOREIGN KEY (destino_estabelecimento_externo_id) REFERENCES estabelecimento_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encaminhamento_paciente_prioridade_interconsulta_id FOREIGN KEY (prioridade_interconsulta_id) REFERENCES prioridade_interconsulta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encaminhamento_paciente_marcacao_horario_id FOREIGN KEY (marcacao_horario_id) REFERENCES marcacao_horario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encaminhamento_paciente_destino_atendimento_id FOREIGN KEY (destino_atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encaminhamento_paciente_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT;
ALTER TABLE equipe_assistencial_paciente
  ADD CONSTRAINT fk_equipe_assistencial_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_assistencial_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_assistencial_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_assistencial_paciente_equipe_assistencial_padrao_id FOREIGN KEY (equipe_assistencial_padrao_id) REFERENCES equipe_assistencial_padrao (id) ON DELETE RESTRICT;
ALTER TABLE equipe_assistencial_membro
  ADD CONSTRAINT fk_equipe_assistencial_membro_equipe_assistencial_paciente_id FOREIGN KEY (equipe_assistencial_paciente_id) REFERENCES equipe_assistencial_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_assistencial_membro_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_assistencial_membro_funcao_equipe_assistencial_id FOREIGN KEY (funcao_equipe_assistencial_id) REFERENCES funcao_equipe_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_assistencial_membro_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT;
