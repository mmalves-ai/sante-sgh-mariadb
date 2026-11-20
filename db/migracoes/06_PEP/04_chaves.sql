-- Chaves do lote 06_PEP-04 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE equipe_assistencial_padrao
  ADD CONSTRAINT fk_equipe_assistencial_padrao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_assistencial_padrao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_assistencial_padrao_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT;
ALTER TABLE equipe_assistencial_padrao_membro
  ADD CONSTRAINT fk_equipe_assistencial_padrao_membro_equipe_assistencia_d08c1ad7 FOREIGN KEY (equipe_assistencial_padrao_id) REFERENCES equipe_assistencial_padrao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_assistencial_padrao_membro_funcao_equipe_assi_53108d7f FOREIGN KEY (funcao_equipe_assistencial_id) REFERENCES funcao_equipe_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_assistencial_padrao_membro_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE equipe_referencia
  ADD CONSTRAINT fk_equipe_referencia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_referencia_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE equipe_referencia_membro
  ADD CONSTRAINT fk_equipe_referencia_membro_equipe_referencia_id FOREIGN KEY (equipe_referencia_id) REFERENCES equipe_referencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_referencia_membro_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_referencia_membro_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT;
ALTER TABLE escala_clinica
  ADD CONSTRAINT fk_escala_clinica_tipo_documento_clinico_id FOREIGN KEY (tipo_documento_clinico_id) REFERENCES tipo_documento_clinico (id) ON DELETE RESTRICT;
ALTER TABLE escala_clinica_faixa
  ADD CONSTRAINT fk_escala_clinica_faixa_escala_clinica_id FOREIGN KEY (escala_clinica_id) REFERENCES escala_clinica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escala_clinica_faixa_escala_clinica_variavel_id FOREIGN KEY (escala_clinica_variavel_id) REFERENCES escala_clinica_variavel (id) ON DELETE RESTRICT;
ALTER TABLE escala_clinica_opcao
  ADD CONSTRAINT fk_escala_clinica_opcao_escala_clinica_variavel_id FOREIGN KEY (escala_clinica_variavel_id) REFERENCES escala_clinica_variavel (id) ON DELETE RESTRICT;
ALTER TABLE escala_clinica_regra_condicao
  ADD CONSTRAINT fk_escala_clinica_regra_condicao_escala_clinica_regra_e_eca24c22 FOREIGN KEY (escala_clinica_regra_exibicao_id) REFERENCES escala_clinica_regra_exibicao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escala_clinica_regra_condicao_escala_clinica_variavel_id FOREIGN KEY (escala_clinica_variavel_id) REFERENCES escala_clinica_variavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escala_clinica_regra_condicao_escala_clinica_opcao_id FOREIGN KEY (escala_clinica_opcao_id) REFERENCES escala_clinica_opcao (id) ON DELETE RESTRICT;
ALTER TABLE escala_clinica_regra_exibicao
  ADD CONSTRAINT fk_escala_clinica_regra_exibicao_escala_clinica_id FOREIGN KEY (escala_clinica_id) REFERENCES escala_clinica (id) ON DELETE RESTRICT;
ALTER TABLE escala_clinica_setor
  ADD CONSTRAINT fk_escala_clinica_setor_escala_clinica_id FOREIGN KEY (escala_clinica_id) REFERENCES escala_clinica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escala_clinica_setor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE escala_clinica_variavel
  ADD CONSTRAINT fk_escala_clinica_variavel_escala_clinica_id FOREIGN KEY (escala_clinica_id) REFERENCES escala_clinica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escala_clinica_variavel_parametro_vital_id FOREIGN KEY (parametro_vital_id) REFERENCES parametro_vital (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escala_clinica_variavel_analito_id FOREIGN KEY (analito_id) REFERENCES analito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escala_clinica_variavel_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE escala_clinica_versao
  ADD CONSTRAINT fk_escala_clinica_versao_escala_clinica_id FOREIGN KEY (escala_clinica_id) REFERENCES escala_clinica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escala_clinica_versao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE escala_insulina
  ADD CONSTRAINT fk_escala_insulina_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escala_insulina_insulina_item_prescritivel_id FOREIGN KEY (insulina_item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escala_insulina_procedimento_item_prescritivel_id FOREIGN KEY (procedimento_item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escala_insulina_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escala_insulina_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escala_insulina_frequencia_administracao_id FOREIGN KEY (frequencia_administracao_id) REFERENCES frequencia_administracao (id) ON DELETE RESTRICT;
ALTER TABLE escala_insulina_faixa
  ADD CONSTRAINT fk_escala_insulina_faixa_escala_insulina_id FOREIGN KEY (escala_insulina_id) REFERENCES escala_insulina (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escala_insulina_faixa_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT;
ALTER TABLE especialidade_classificacao_risco
  ADD CONSTRAINT fk_especialidade_classificacao_risco_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_especialidade_classificacao_risco_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT;
ALTER TABLE especialidade_destino_parecer
  ADD CONSTRAINT fk_especialidade_destino_parecer_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_especialidade_destino_parecer_setor_origem_id FOREIGN KEY (setor_origem_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_especialidade_destino_parecer_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT;
ALTER TABLE estadiamento_tumor
  ADD CONSTRAINT fk_estadiamento_tumor_diagnostico_oncologico_id FOREIGN KEY (diagnostico_oncologico_id) REFERENCES diagnostico_oncologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estadiamento_tumor_estadio_clinico_id FOREIGN KEY (estadio_clinico_id) REFERENCES estadio_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estadiamento_tumor_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estadiamento_tumor_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estadiamento_tumor_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE estagio_lesao_pele
  ADD CONSTRAINT fk_estagio_lesao_pele_tipo_lesao_pele_id FOREIGN KEY (tipo_lesao_pele_id) REFERENCES tipo_lesao_pele (id) ON DELETE RESTRICT;
ALTER TABLE estratificacao_risco_paciente
  ADD CONSTRAINT fk_estratificacao_risco_paciente_programa_cuidado_paciente_id FOREIGN KEY (programa_cuidado_paciente_id) REFERENCES programa_cuidado_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estratificacao_risco_paciente_aplicacao_escala_id FOREIGN KEY (aplicacao_escala_id) REFERENCES aplicacao_escala (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estratificacao_risco_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estratificacao_risco_paciente_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE evento_adverso_padrao
  ADD CONSTRAINT fk_evento_adverso_padrao_grupo_evento_adverso_id FOREIGN KEY (grupo_evento_adverso_id) REFERENCES grupo_evento_adverso (id) ON DELETE RESTRICT;
ALTER TABLE exame_fisico_achado
  ADD CONSTRAINT fk_exame_fisico_achado_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_fisico_achado_sistema_corporal_id FOREIGN KEY (sistema_corporal_id) REFERENCES sistema_corporal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_fisico_achado_regiao_corporal_id FOREIGN KEY (regiao_corporal_id) REFERENCES regiao_corporal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_fisico_achado_achado_exame_fisico_padrao_id FOREIGN KEY (achado_exame_fisico_padrao_id) REFERENCES achado_exame_fisico_padrao (id) ON DELETE RESTRICT;
ALTER TABLE exame_lancado_prontuario
  ADD CONSTRAINT fk_exame_lancado_prontuario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_lancado_prontuario_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_lancado_prontuario_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_lancado_prontuario_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_lancado_prontuario_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_lancado_prontuario_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_lancado_prontuario_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_lancado_prontuario_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_lancado_prontuario_suspenso_por_profissional_id FOREIGN KEY (suspenso_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE exame_lancado_valor
  ADD CONSTRAINT fk_exame_lancado_valor_exame_lancado_prontuario_id FOREIGN KEY (exame_lancado_prontuario_id) REFERENCES exame_lancado_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_lancado_valor_analito_id FOREIGN KEY (analito_id) REFERENCES analito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_lancado_valor_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE exame_oftalmologico
  ADD CONSTRAINT fk_exame_oftalmologico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_oftalmologico_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_oftalmologico_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_oftalmologico_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_oftalmologico_tipo_exame_oftalmologico_id FOREIGN KEY (tipo_exame_oftalmologico_id) REFERENCES tipo_exame_oftalmologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_oftalmologico_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_oftalmologico_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE exame_oftalmologico_valor
  ADD CONSTRAINT fk_exame_oftalmologico_valor_exame_oftalmologico_id FOREIGN KEY (exame_oftalmologico_id) REFERENCES exame_oftalmologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_oftalmologico_valor_grupo_exame_oftalmologico_id FOREIGN KEY (grupo_exame_oftalmologico_id) REFERENCES grupo_exame_oftalmologico (id) ON DELETE RESTRICT;
ALTER TABLE faixa_sinal_vital_classificacao
  ADD CONSTRAINT fk_faixa_sinal_vital_classificacao_protocolo_classifica_45364cd2 FOREIGN KEY (protocolo_classificacao_risco_versao_id) REFERENCES protocolo_classificacao_risco_versao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_faixa_sinal_vital_classificacao_parametro_vital_id FOREIGN KEY (parametro_vital_id) REFERENCES parametro_vital (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_faixa_sinal_vital_classificacao_discriminador_classi_2378f9c1 FOREIGN KEY (discriminador_classificacao_risco_id) REFERENCES discriminador_classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_faixa_sinal_vital_classificacao_nivel_prioridade_id FOREIGN KEY (nivel_prioridade_id) REFERENCES nivel_prioridade (id) ON DELETE RESTRICT;
ALTER TABLE fator_interferencia_sinal_vital
  ADD CONSTRAINT fk_fator_interferencia_sinal_vital_parametro_vital_id FOREIGN KEY (parametro_vital_id) REFERENCES parametro_vital (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fator_interferencia_sinal_vital_protocolo_classifica_bc3399b0 FOREIGN KEY (protocolo_classificacao_risco_id) REFERENCES protocolo_classificacao_risco (id) ON DELETE RESTRICT;
ALTER TABLE favorito_prescritor
  ADD CONSTRAINT fk_favorito_prescritor_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_favorito_prescritor_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_favorito_prescritor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_favorito_prescritor_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_favorito_prescritor_protocolo_prescricao_id FOREIGN KEY (protocolo_prescricao_id) REFERENCES protocolo_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_favorito_prescritor_kit_prescricao_id FOREIGN KEY (kit_prescricao_id) REFERENCES kit_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_favorito_prescritor_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_favorito_prescritor_principio_ativo_id FOREIGN KEY (principio_ativo_id) REFERENCES principio_ativo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_favorito_prescritor_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_favorito_prescritor_modelo_documento_clinico_id FOREIGN KEY (modelo_documento_clinico_id) REFERENCES modelo_documento_clinico (id) ON DELETE RESTRICT;
ALTER TABLE fechamento_horario_checagem
  ADD CONSTRAINT fk_fechamento_horario_checagem_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_horario_checagem_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_horario_checagem_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_horario_checagem_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_horario_checagem_fechado_por_usuario_id FOREIGN KEY (fechado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_horario_checagem_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_horario_checagem_reaberto_por_usuario_id FOREIGN KEY (reaberto_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE ficha_antimicrobiano
  ADD CONSTRAINT fk_ficha_antimicrobiano_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_antimicrobiano_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_antimicrobiano_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_antimicrobiano_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_antimicrobiano_antimicrobiano_id FOREIGN KEY (antimicrobiano_id) REFERENCES antimicrobiano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_antimicrobiano_liberacao_antimicrobiano_id FOREIGN KEY (liberacao_antimicrobiano_id) REFERENCES liberacao_antimicrobiano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_antimicrobiano_ficha_antimicrobiano_anterior_id FOREIGN KEY (ficha_antimicrobiano_anterior_id) REFERENCES ficha_antimicrobiano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_antimicrobiano_prescritor_profissional_id FOREIGN KEY (prescritor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_antimicrobiano_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_antimicrobiano_finalidade_terapeutica_id FOREIGN KEY (finalidade_terapeutica_id) REFERENCES finalidade_terapeutica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_antimicrobiano_sitio_infeccao_id FOREIGN KEY (sitio_infeccao_id) REFERENCES sitio_infeccao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_antimicrobiano_resultado_cultura_id FOREIGN KEY (resultado_cultura_id) REFERENCES resultado_cultura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_antimicrobiano_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_antimicrobiano_frequencia_administracao_id FOREIGN KEY (frequencia_administracao_id) REFERENCES frequencia_administracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_antimicrobiano_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_antimicrobiano_avaliado_por_profissional_id FOREIGN KEY (avaliado_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE filtro_resultado_usuario
  ADD CONSTRAINT fk_filtro_resultado_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE fluxo_situacao_documento
  ADD CONSTRAINT fk_fluxo_situacao_documento_tipo_documento_clinico_id FOREIGN KEY (tipo_documento_clinico_id) REFERENCES tipo_documento_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fluxo_situacao_documento_situacao_origem_id FOREIGN KEY (situacao_origem_id) REFERENCES situacao_documento_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fluxo_situacao_documento_situacao_destino_id FOREIGN KEY (situacao_destino_id) REFERENCES situacao_documento_prontuario (id) ON DELETE RESTRICT;
ALTER TABLE fluxograma_classificacao_risco
  ADD CONSTRAINT fk_fluxograma_classificacao_risco_protocolo_classificac_2153b228 FOREIGN KEY (protocolo_classificacao_risco_versao_id) REFERENCES protocolo_classificacao_risco_versao (id) ON DELETE RESTRICT;
ALTER TABLE fluxograma_classificacao_risco_especialidade
  ADD CONSTRAINT fk_fluxograma_classificacao_risco_especialidade_fluxogr_1106488a FOREIGN KEY (fluxograma_classificacao_risco_id) REFERENCES fluxograma_classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fluxograma_classificacao_risco_especialidade_especia_b89f13ed FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fluxograma_classificacao_risco_especialidade_estabel_a490ad83 FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE fluxograma_classificacao_risco_grupo
  ADD CONSTRAINT fk_fluxograma_classificacao_risco_grupo_fluxograma_clas_611112dc FOREIGN KEY (fluxograma_classificacao_risco_id) REFERENCES fluxograma_classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fluxograma_classificacao_risco_grupo_grupo_queixa_cl_744d3425 FOREIGN KEY (grupo_queixa_classificacao_id) REFERENCES grupo_queixa_classificacao (id) ON DELETE RESTRICT;
ALTER TABLE formato_envio_operadora
  ADD CONSTRAINT fk_formato_envio_operadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE formula_calculo_dose
  ADD CONSTRAINT fk_formula_calculo_dose_unidade_resultado_id FOREIGN KEY (unidade_resultado_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE formulacao_parenteral
  ADD CONSTRAINT fk_formulacao_parenteral_prescricao_id FOREIGN KEY (prescricao_id) REFERENCES prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_formulacao_parenteral_terapia_nutricional_id FOREIGN KEY (terapia_nutricional_id) REFERENCES terapia_nutricional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_formulacao_parenteral_calculado_por_profissional_id FOREIGN KEY (calculado_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_formulacao_parenteral_liberado_por_profissional_id FOREIGN KEY (liberado_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE formulario_declaracao_obito
  ADD CONSTRAINT fk_formulario_declaracao_obito_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_formulario_declaracao_obito_declaracao_obito_id FOREIGN KEY (declaracao_obito_id) REFERENCES declaracao_obito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_formulario_declaracao_obito_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE frequencia_administracao
  ADD CONSTRAINT fk_frequencia_administracao_frequencia_agrupadora_id FOREIGN KEY (frequencia_agrupadora_id) REFERENCES frequencia_administracao (id) ON DELETE RESTRICT;
ALTER TABLE frequencia_administracao_setor
  ADD CONSTRAINT fk_frequencia_administracao_setor_frequencia_administracao_id FOREIGN KEY (frequencia_administracao_id) REFERENCES frequencia_administracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_frequencia_administracao_setor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
