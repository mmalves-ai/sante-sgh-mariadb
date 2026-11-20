-- Chaves do módulo PEP, lote 05 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE frequencia_horario_relativo
  ADD CONSTRAINT fk_frequencia_horario_relativo_frequencia_administracao_id FOREIGN KEY (frequencia_administracao_id) REFERENCES frequencia_administracao (id) ON DELETE RESTRICT;
ALTER TABLE funcao_equipe_assistencial_escopo
  ADD CONSTRAINT fk_funcao_equipe_assistencial_escopo_funcao_equipe_assistencial_ FOREIGN KEY (funcao_equipe_assistencial_id) REFERENCES funcao_equipe_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_funcao_equipe_assistencial_escopo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_funcao_equipe_assistencial_escopo_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_funcao_equipe_assistencial_escopo_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE gabarito_acuidade_visual
  ADD CONSTRAINT fk_gabarito_acuidade_visual_tipo_acuidade_visual_id FOREIGN KEY (tipo_acuidade_visual_id) REFERENCES tipo_acuidade_visual (id) ON DELETE RESTRICT;
ALTER TABLE gestacao_paciente
  ADD CONSTRAINT fk_gestacao_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_gestacao_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_gestacao_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_gestacao_paciente_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_gestacao_paciente_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_gestacao_paciente_tipo_parto_id FOREIGN KEY (tipo_parto_id) REFERENCES tipo_parto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_gestacao_paciente_motivo_parto_cirurgico_id FOREIGN KEY (motivo_parto_cirurgico_id) REFERENCES motivo_parto_cirurgico (id) ON DELETE RESTRICT;
ALTER TABLE grade_horario_unidade
  ADD CONSTRAINT fk_grade_horario_unidade_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grade_horario_unidade_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grade_horario_unidade_bloco_internacao_id FOREIGN KEY (bloco_internacao_id) REFERENCES bloco_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grade_horario_unidade_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE grafico_clinico_padrao
  ADD CONSTRAINT fk_grafico_clinico_padrao_eixo_x_parametro_vital_id FOREIGN KEY (eixo_x_parametro_vital_id) REFERENCES parametro_vital (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grafico_clinico_padrao_eixo_x_unidade_medida_id FOREIGN KEY (eixo_x_unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grafico_clinico_padrao_eixo_y_parametro_vital_id FOREIGN KEY (eixo_y_parametro_vital_id) REFERENCES parametro_vital (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grafico_clinico_padrao_eixo_y_unidade_medida_id FOREIGN KEY (eixo_y_unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE grau_evento_adverso
  ADD CONSTRAINT fk_grau_evento_adverso_evento_adverso_padrao_id FOREIGN KEY (evento_adverso_padrao_id) REFERENCES evento_adverso_padrao (id) ON DELETE RESTRICT;
ALTER TABLE gravidade_interacao
  ADD CONSTRAINT fk_gravidade_interacao_acao_gravidade_interacao_id FOREIGN KEY (acao_gravidade_interacao_id) REFERENCES acao_gravidade_interacao (id) ON DELETE RESTRICT;
ALTER TABLE grupo_caracteristica_enfermagem
  ADD CONSTRAINT fk_grupo_caracteristica_enfermagem_grupo_pai_id FOREIGN KEY (grupo_pai_id) REFERENCES grupo_caracteristica_enfermagem (id) ON DELETE RESTRICT;
ALTER TABLE grupo_conferencia_checagem
  ADD CONSTRAINT fk_grupo_conferencia_checagem_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_conferencia_checagem_tipo_item_prescricao_id FOREIGN KEY (tipo_item_prescricao_id) REFERENCES tipo_item_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_conferencia_checagem_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT;
ALTER TABLE grupo_evento_adverso
  ADD CONSTRAINT fk_grupo_evento_adverso_grupo_pai_id FOREIGN KEY (grupo_pai_id) REFERENCES grupo_evento_adverso (id) ON DELETE RESTRICT;
ALTER TABLE grupo_exibicao_prescricao_item
  ADD CONSTRAINT fk_grupo_exibicao_prescricao_item_grupo_exibicao_prescricao_id FOREIGN KEY (grupo_exibicao_prescricao_id) REFERENCES grupo_exibicao_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_exibicao_prescricao_item_tipo_item_prescricao_id FOREIGN KEY (tipo_item_prescricao_id) REFERENCES tipo_item_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_exibicao_prescricao_item_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_exibicao_prescricao_item_item_prescritivel_pai_id FOREIGN KEY (item_prescritivel_pai_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_exibicao_prescricao_item_subgrupo_exibicao_prescricao_i FOREIGN KEY (subgrupo_exibicao_prescricao_id) REFERENCES subgrupo_exibicao_prescricao (id) ON DELETE RESTRICT;
ALTER TABLE grupo_queixa_classificacao
  ADD CONSTRAINT fk_grupo_queixa_classificacao_protocolo_classificacao_risco_id FOREIGN KEY (protocolo_classificacao_risco_id) REFERENCES protocolo_classificacao_risco (id) ON DELETE RESTRICT;
ALTER TABLE horario_administracao
  ADD CONSTRAINT fk_horario_administracao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_administracao_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_administracao_prescricao_id FOREIGN KEY (prescricao_id) REFERENCES prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_administracao_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_administracao_frequencia_horario_relativo_id FOREIGN KEY (frequencia_horario_relativo_id) REFERENCES frequencia_horario_relativo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_administracao_situacao_checagem_id FOREIGN KEY (situacao_checagem_id) REFERENCES situacao_checagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_administracao_situacao_aprazamento_id FOREIGN KEY (situacao_aprazamento_id) REFERENCES situacao_aprazamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_administracao_aprazado_por_profissional_id FOREIGN KEY (aprazado_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_administracao_unidade_prescricao_id FOREIGN KEY (unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_administracao_administrado_por_profissional_id FOREIGN KEY (administrado_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_administracao_conferido_por_profissional_id FOREIGN KEY (conferido_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_administracao_motivo_nao_administracao_id FOREIGN KEY (motivo_nao_administracao_id) REFERENCES motivo_nao_administracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_administracao_justificativa_padrao_medicacao_id FOREIGN KEY (justificativa_padrao_medicacao_id) REFERENCES justificativa_padrao_medicacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_administracao_fechamento_horario_checagem_id FOREIGN KEY (fechamento_horario_checagem_id) REFERENCES fechamento_horario_checagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_administracao_dispensacao_id FOREIGN KEY (dispensacao_id) REFERENCES dispensacao (id) ON DELETE RESTRICT;
ALTER TABLE horario_administracao_evento
  ADD CONSTRAINT fk_horario_administracao_evento_horario_administracao_id FOREIGN KEY (horario_administracao_id) REFERENCES horario_administracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_administracao_evento_situacao_checagem_id FOREIGN KEY (situacao_checagem_id) REFERENCES situacao_checagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_administracao_evento_situacao_aprazamento_id FOREIGN KEY (situacao_aprazamento_id) REFERENCES situacao_aprazamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_administracao_evento_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_administracao_evento_motivo_nao_administracao_id FOREIGN KEY (motivo_nao_administracao_id) REFERENCES motivo_nao_administracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_administracao_evento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE horario_padrao_dose
  ADD CONSTRAINT fk_horario_padrao_dose_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_padrao_dose_grade_horario_unidade_id FOREIGN KEY (grade_horario_unidade_id) REFERENCES grade_horario_unidade (id) ON DELETE RESTRICT;
ALTER TABLE imagem_anotacao_modelo
  ADD CONSTRAINT fk_imagem_anotacao_modelo_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_imagem_anotacao_modelo_modelo_documento_clinico_id FOREIGN KEY (modelo_documento_clinico_id) REFERENCES modelo_documento_clinico (id) ON DELETE RESTRICT;
ALTER TABLE imunobiologico
  ADD CONSTRAINT fk_imunobiologico_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_imunobiologico_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT;
ALTER TABLE inclusao_protocolo_criterio
  ADD CONSTRAINT fk_inclusao_protocolo_criterio_inclusao_protocolo_paciente_id FOREIGN KEY (inclusao_protocolo_paciente_id) REFERENCES inclusao_protocolo_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inclusao_protocolo_criterio_protocolo_gerenciado_criterio_id FOREIGN KEY (protocolo_gerenciado_criterio_id) REFERENCES protocolo_gerenciado_criterio (id) ON DELETE RESTRICT;
ALTER TABLE inclusao_protocolo_etapa
  ADD CONSTRAINT fk_inclusao_protocolo_etapa_inclusao_protocolo_paciente_id FOREIGN KEY (inclusao_protocolo_paciente_id) REFERENCES inclusao_protocolo_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inclusao_protocolo_etapa_protocolo_gerenciado_etapa_id FOREIGN KEY (protocolo_gerenciado_etapa_id) REFERENCES protocolo_gerenciado_etapa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inclusao_protocolo_etapa_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inclusao_protocolo_etapa_motivo_saida_protocolo_id FOREIGN KEY (motivo_saida_protocolo_id) REFERENCES motivo_saida_protocolo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inclusao_protocolo_etapa_motivo_nao_adesao_protocolo_id FOREIGN KEY (motivo_nao_adesao_protocolo_id) REFERENCES motivo_nao_adesao_protocolo (id) ON DELETE RESTRICT;
ALTER TABLE inclusao_protocolo_evento
  ADD CONSTRAINT fk_inclusao_protocolo_evento_inclusao_protocolo_paciente_id FOREIGN KEY (inclusao_protocolo_paciente_id) REFERENCES inclusao_protocolo_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inclusao_protocolo_evento_protocolo_gerenciado_etapa_id FOREIGN KEY (protocolo_gerenciado_etapa_id) REFERENCES protocolo_gerenciado_etapa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inclusao_protocolo_evento_motivo_saida_protocolo_id FOREIGN KEY (motivo_saida_protocolo_id) REFERENCES motivo_saida_protocolo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inclusao_protocolo_evento_motivo_nao_adesao_protocolo_id FOREIGN KEY (motivo_nao_adesao_protocolo_id) REFERENCES motivo_nao_adesao_protocolo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inclusao_protocolo_evento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE inclusao_protocolo_paciente
  ADD CONSTRAINT fk_inclusao_protocolo_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inclusao_protocolo_paciente_protocolo_gerenciado_id FOREIGN KEY (protocolo_gerenciado_id) REFERENCES protocolo_gerenciado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inclusao_protocolo_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inclusao_protocolo_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inclusao_protocolo_paciente_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inclusao_protocolo_paciente_protocolo_gerenciado_etapa_id FOREIGN KEY (protocolo_gerenciado_etapa_id) REFERENCES protocolo_gerenciado_etapa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inclusao_protocolo_paciente_aceito_por_usuario_id FOREIGN KEY (aceito_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inclusao_protocolo_paciente_descartado_por_usuario_id FOREIGN KEY (descartado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inclusao_protocolo_paciente_motivo_nao_adesao_protocolo_id FOREIGN KEY (motivo_nao_adesao_protocolo_id) REFERENCES motivo_nao_adesao_protocolo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inclusao_protocolo_paciente_encerrado_por_usuario_id FOREIGN KEY (encerrado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inclusao_protocolo_paciente_motivo_saida_protocolo_id FOREIGN KEY (motivo_saida_protocolo_id) REFERENCES motivo_saida_protocolo (id) ON DELETE RESTRICT;
ALTER TABLE indicador_resultado_enfermagem
  ADD CONSTRAINT fk_indicador_resultado_enfermagem_resultado_enfermagem_id FOREIGN KEY (resultado_enfermagem_id) REFERENCES resultado_enfermagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_indicador_resultado_enfermagem_escala_resultado_enfermagem_id FOREIGN KEY (escala_resultado_enfermagem_id) REFERENCES escala_resultado_enfermagem (id) ON DELETE RESTRICT;
ALTER TABLE informacao_clinica_operadora
  ADD CONSTRAINT fk_informacao_clinica_operadora_grupo_informacao_clinica_operado FOREIGN KEY (grupo_informacao_clinica_operadora_id) REFERENCES grupo_informacao_clinica_operadora (id) ON DELETE RESTRICT;
ALTER TABLE instrumento_afericao
  ADD CONSTRAINT fk_instrumento_afericao_parametro_vital_id FOREIGN KEY (parametro_vital_id) REFERENCES parametro_vital (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_instrumento_afericao_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE intencao_tratamento_oncologico
  ADD CONSTRAINT fk_intencao_tratamento_oncologico_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE interacao_medicamento_alimento
  ADD CONSTRAINT fk_interacao_medicamento_alimento_principio_ativo_id FOREIGN KEY (principio_ativo_id) REFERENCES principio_ativo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interacao_medicamento_alimento_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interacao_medicamento_alimento_alimento_referencia_id FOREIGN KEY (alimento_referencia_id) REFERENCES alimento_referencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interacao_medicamento_alimento_nutriente_referencia_id FOREIGN KEY (nutriente_referencia_id) REFERENCES nutriente_referencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interacao_medicamento_alimento_grupo_alimento_id FOREIGN KEY (grupo_alimento_id) REFERENCES grupo_alimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interacao_medicamento_alimento_gravidade_interacao_id FOREIGN KEY (gravidade_interacao_id) REFERENCES gravidade_interacao (id) ON DELETE RESTRICT;
ALTER TABLE interacao_medicamento_exame
  ADD CONSTRAINT fk_interacao_medicamento_exame_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interacao_medicamento_exame_principio_ativo_id FOREIGN KEY (principio_ativo_id) REFERENCES principio_ativo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interacao_medicamento_exame_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT;
ALTER TABLE interacao_medicamentosa
  ADD CONSTRAINT fk_interacao_medicamentosa_principio_ativo_id FOREIGN KEY (principio_ativo_id) REFERENCES principio_ativo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interacao_medicamentosa_interagente_principio_ativo_id FOREIGN KEY (interagente_principio_ativo_id) REFERENCES principio_ativo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interacao_medicamentosa_gravidade_interacao_id FOREIGN KEY (gravidade_interacao_id) REFERENCES gravidade_interacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interacao_medicamentosa_tipo_interacao_id FOREIGN KEY (tipo_interacao_id) REFERENCES tipo_interacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interacao_medicamentosa_probabilidade_interacao_id FOREIGN KEY (probabilidade_interacao_id) REFERENCES probabilidade_interacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interacao_medicamentosa_classificacao_interacao_id FOREIGN KEY (classificacao_interacao_id) REFERENCES classificacao_interacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interacao_medicamentosa_forma_validacao_interacao_id FOREIGN KEY (forma_validacao_interacao_id) REFERENCES forma_validacao_interacao (id) ON DELETE RESTRICT;
ALTER TABLE interconsulta
  ADD CONSTRAINT fk_interconsulta_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interconsulta_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interconsulta_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interconsulta_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interconsulta_solicitante_especialidade_medica_id FOREIGN KEY (solicitante_especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interconsulta_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interconsulta_requisitado_profissional_id FOREIGN KEY (requisitado_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interconsulta_equipe_assistencial_paciente_id FOREIGN KEY (equipe_assistencial_paciente_id) REFERENCES equipe_assistencial_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interconsulta_pedido_registro_assistencial_id FOREIGN KEY (pedido_registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interconsulta_aceito_por_profissional_id FOREIGN KEY (aceito_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interconsulta_cancelado_por_profissional_id FOREIGN KEY (cancelado_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE interconsulta_resposta
  ADD CONSTRAINT fk_interconsulta_resposta_interconsulta_id FOREIGN KEY (interconsulta_id) REFERENCES interconsulta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interconsulta_resposta_respondente_profissional_id FOREIGN KEY (respondente_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interconsulta_resposta_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interconsulta_resposta_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT;
ALTER TABLE intervencao_enfermagem
  ADD CONSTRAINT fk_intervencao_enfermagem_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT;
ALTER TABLE intervencao_farmaceutica
  ADD CONSTRAINT fk_intervencao_farmaceutica_avaliacao_farmaceutica_id FOREIGN KEY (avaliacao_farmaceutica_id) REFERENCES avaliacao_farmaceutica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_intervencao_farmaceutica_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_intervencao_farmaceutica_tipo_intervencao_farmaceutica_id FOREIGN KEY (tipo_intervencao_farmaceutica_id) REFERENCES tipo_intervencao_farmaceutica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_intervencao_farmaceutica_farmaceutico_profissional_id FOREIGN KEY (farmaceutico_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_intervencao_farmaceutica_prescritor_profissional_id FOREIGN KEY (prescritor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_intervencao_farmaceutica_desfecho_intervencao_farmaceutica_id FOREIGN KEY (desfecho_intervencao_farmaceutica_id) REFERENCES desfecho_intervencao_farmaceutica (id) ON DELETE RESTRICT;
ALTER TABLE intervencao_salva_vidas
  ADD CONSTRAINT fk_intervencao_salva_vidas_protocolo_classificacao_risco_id FOREIGN KEY (protocolo_classificacao_risco_id) REFERENCES protocolo_classificacao_risco (id) ON DELETE RESTRICT;
ALTER TABLE item_nao_padronizado
  ADD CONSTRAINT fk_item_nao_padronizado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_nao_padronizado_tipo_item_prescricao_id FOREIGN KEY (tipo_item_prescricao_id) REFERENCES tipo_item_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_nao_padronizado_unidade_prescricao_id FOREIGN KEY (unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_nao_padronizado_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_nao_padronizado_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_nao_padronizado_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_nao_padronizado_analisado_por_usuario_id FOREIGN KEY (analisado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE item_nao_padronizado_principio
  ADD CONSTRAINT fk_item_nao_padronizado_principio_item_nao_padronizado_id FOREIGN KEY (item_nao_padronizado_id) REFERENCES item_nao_padronizado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_nao_padronizado_principio_principio_ativo_id FOREIGN KEY (principio_ativo_id) REFERENCES principio_ativo (id) ON DELETE RESTRICT;
