-- Chaves do lote 06_PEP-01 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE acao_gravidade_interacao
  ADD CONSTRAINT fk_acao_gravidade_interacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acao_gravidade_interacao_gravidade_interacao_id FOREIGN KEY (gravidade_interacao_id) REFERENCES gravidade_interacao (id) ON DELETE RESTRICT;
ALTER TABLE achado_exame_fisico_padrao
  ADD CONSTRAINT fk_achado_exame_fisico_padrao_sistema_corporal_id FOREIGN KEY (sistema_corporal_id) REFERENCES sistema_corporal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_achado_exame_fisico_padrao_regiao_corporal_id FOREIGN KEY (regiao_corporal_id) REFERENCES regiao_corporal (id) ON DELETE RESTRICT;
ALTER TABLE acionamento_resposta_rapida
  ADD CONSTRAINT fk_acionamento_resposta_rapida_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acionamento_resposta_rapida_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acionamento_resposta_rapida_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acionamento_resposta_rapida_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acionamento_resposta_rapida_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acionamento_resposta_rapida_aplicacao_escala_id FOREIGN KEY (aplicacao_escala_id) REFERENCES aplicacao_escala (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acionamento_resposta_rapida_criterio_resposta_rapida_id FOREIGN KEY (criterio_resposta_rapida_id) REFERENCES criterio_resposta_rapida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acionamento_resposta_rapida_acionado_por_usuario_id FOREIGN KEY (acionado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acionamento_resposta_rapida_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE acompanhamento_oncologico
  ADD CONSTRAINT fk_acompanhamento_oncologico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acompanhamento_oncologico_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acompanhamento_oncologico_diagnostico_oncologico_id FOREIGN KEY (diagnostico_oncologico_id) REFERENCES diagnostico_oncologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acompanhamento_oncologico_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE acompanhamento_oncologico_evento
  ADD CONSTRAINT fk_acompanhamento_oncologico_evento_acompanhamento_oncologico_id FOREIGN KEY (acompanhamento_oncologico_id) REFERENCES acompanhamento_oncologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acompanhamento_oncologico_evento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acompanhamento_oncologico_evento_motivo_registro_flu_55f8da72 FOREIGN KEY (motivo_registro_fluxo_oncologico_id) REFERENCES motivo_registro_fluxo_oncologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acompanhamento_oncologico_evento_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acompanhamento_oncologico_evento_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE acompanhamento_pos_transplante
  ADD CONSTRAINT fk_acompanhamento_pos_transplante_receptor_transplante_id FOREIGN KEY (receptor_transplante_id) REFERENCES receptor_transplante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acompanhamento_pos_transplante_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acompanhamento_pos_transplante_registrado_profissional_id FOREIGN KEY (registrado_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE administracao_dupla_checagem
  ADD CONSTRAINT fk_administracao_dupla_checagem_horario_administracao_id FOREIGN KEY (horario_administracao_id) REFERENCES horario_administracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_administracao_dupla_checagem_componente_prescricao_item_id FOREIGN KEY (componente_prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_administracao_dupla_checagem_conferente_usuario_id FOREIGN KEY (conferente_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_administracao_dupla_checagem_conferente_profissional_id FOREIGN KEY (conferente_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE administracao_lote_lido
  ADD CONSTRAINT fk_administracao_lote_lido_horario_administracao_id FOREIGN KEY (horario_administracao_id) REFERENCES horario_administracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_administracao_lote_lido_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_administracao_lote_lido_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_administracao_lote_lido_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_administracao_lote_lido_lido_por_usuario_id FOREIGN KEY (lido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE afericao
  ADD CONSTRAINT fk_afericao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_afericao_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_afericao_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_afericao_classificacao_risco_id FOREIGN KEY (classificacao_risco_id) REFERENCES classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_afericao_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_afericao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_afericao_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE afericao_valor
  ADD CONSTRAINT fk_afericao_valor_afericao_id FOREIGN KEY (afericao_id) REFERENCES afericao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_afericao_valor_parametro_vital_id FOREIGN KEY (parametro_vital_id) REFERENCES parametro_vital (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_afericao_valor_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_afericao_valor_instrumento_afericao_id FOREIGN KEY (instrumento_afericao_id) REFERENCES instrumento_afericao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_afericao_valor_local_afericao_id FOREIGN KEY (local_afericao_id) REFERENCES local_afericao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_afericao_valor_posicao_afericao_id FOREIGN KEY (posicao_afericao_id) REFERENCES posicao_afericao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_afericao_valor_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_afericao_valor_motivo_nao_afericao_id FOREIGN KEY (motivo_nao_afericao_id) REFERENCES motivo_nao_afericao (id) ON DELETE RESTRICT;
ALTER TABLE agravo_notificavel
  ADD CONSTRAINT fk_agravo_notificavel_tipo_notificacao_agravo_id FOREIGN KEY (tipo_notificacao_agravo_id) REFERENCES tipo_notificacao_agravo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agravo_notificavel_periodicidade_notificacao_id FOREIGN KEY (periodicidade_notificacao_id) REFERENCES periodicidade_notificacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agravo_notificavel_autoridade_notificacao_id FOREIGN KEY (autoridade_notificacao_id) REFERENCES autoridade_notificacao (id) ON DELETE RESTRICT;
ALTER TABLE agravo_notificavel_cid
  ADD CONSTRAINT fk_agravo_notificavel_cid_agravo_notificavel_id FOREIGN KEY (agravo_notificavel_id) REFERENCES agravo_notificavel (id) ON DELETE RESTRICT;
ALTER TABLE agravo_pergunta
  ADD CONSTRAINT fk_agravo_pergunta_agravo_notificavel_id FOREIGN KEY (agravo_notificavel_id) REFERENCES agravo_notificavel (id) ON DELETE RESTRICT;
ALTER TABLE agrupador_historico_prontuario_tipo
  ADD CONSTRAINT fk_agrupador_historico_prontuario_tipo_agrupador_histor_b8ed8cf0 FOREIGN KEY (agrupador_historico_prontuario_id) REFERENCES agrupador_historico_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agrupador_historico_prontuario_tipo_tipo_documento_clinico_id FOREIGN KEY (tipo_documento_clinico_id) REFERENCES tipo_documento_clinico (id) ON DELETE RESTRICT;
ALTER TABLE ajuste_dose_renal
  ADD CONSTRAINT fk_ajuste_dose_renal_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_dose_renal_principio_ativo_id FOREIGN KEY (principio_ativo_id) REFERENCES principio_ativo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_dose_renal_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE alergeno
  ADD CONSTRAINT fk_alergeno_categoria_alergeno_id FOREIGN KEY (categoria_alergeno_id) REFERENCES categoria_alergeno (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alergeno_tipo_alergia_id FOREIGN KEY (tipo_alergia_id) REFERENCES tipo_alergia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alergeno_acao_alerta_alergia_id FOREIGN KEY (acao_alerta_alergia_id) REFERENCES acao_alerta_alergia (id) ON DELETE RESTRICT;
ALTER TABLE alergeno_principio_ativo
  ADD CONSTRAINT fk_alergeno_principio_ativo_alergeno_id FOREIGN KEY (alergeno_id) REFERENCES alergeno (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alergeno_principio_ativo_principio_ativo_id FOREIGN KEY (principio_ativo_id) REFERENCES principio_ativo (id) ON DELETE RESTRICT;
ALTER TABLE alergia_paciente
  ADD CONSTRAINT fk_alergia_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alergia_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alergia_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alergia_paciente_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alergia_paciente_classificacao_risco_id FOREIGN KEY (classificacao_risco_id) REFERENCES classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alergia_paciente_alergeno_id FOREIGN KEY (alergeno_id) REFERENCES alergeno (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alergia_paciente_registrado_profissional_id FOREIGN KEY (registrado_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alergia_paciente_inativado_por_usuario_id FOREIGN KEY (inativado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alergia_paciente_inativado_profissional_id FOREIGN KEY (inativado_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE alergia_paciente_evento
  ADD CONSTRAINT fk_alergia_paciente_evento_alergia_paciente_id FOREIGN KEY (alergia_paciente_id) REFERENCES alergia_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alergia_paciente_evento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alergia_paciente_evento_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alergia_paciente_evento_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE alergia_paciente_manifestacao
  ADD CONSTRAINT fk_alergia_paciente_manifestacao_alergia_paciente_id FOREIGN KEY (alergia_paciente_id) REFERENCES alergia_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alergia_paciente_manifestacao_manifestacao_alergica_id FOREIGN KEY (manifestacao_alergica_id) REFERENCES manifestacao_alergica (id) ON DELETE RESTRICT;
ALTER TABLE alergia_paciente_principio
  ADD CONSTRAINT fk_alergia_paciente_principio_alergia_paciente_id FOREIGN KEY (alergia_paciente_id) REFERENCES alergia_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alergia_paciente_principio_principio_ativo_id FOREIGN KEY (principio_ativo_id) REFERENCES principio_ativo (id) ON DELETE RESTRICT;
ALTER TABLE alerta_item_diagnostico
  ADD CONSTRAINT fk_alerta_item_diagnostico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alerta_item_diagnostico_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT;
ALTER TABLE alerta_item_diagnostico_cid
  ADD CONSTRAINT fk_alerta_item_diagnostico_cid_alerta_item_diagnostico_id FOREIGN KEY (alerta_item_diagnostico_id) REFERENCES alerta_item_diagnostico (id) ON DELETE RESTRICT;
ALTER TABLE alerta_item_resultado_exame
  ADD CONSTRAINT fk_alerta_item_resultado_exame_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alerta_item_resultado_exame_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alerta_item_resultado_exame_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE alerta_item_resultado_exame_faixa
  ADD CONSTRAINT fk_alerta_item_resultado_exame_faixa_alerta_item_result_09baafde FOREIGN KEY (alerta_item_resultado_exame_id) REFERENCES alerta_item_resultado_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alerta_item_resultado_exame_faixa_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alerta_item_resultado_exame_faixa_analito_id FOREIGN KEY (analito_id) REFERENCES analito (id) ON DELETE RESTRICT;
ALTER TABLE alta_medica
  ADD CONSTRAINT fk_alta_medica_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alta_medica_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alta_medica_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alta_medica_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alta_medica_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alta_medica_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alta_medica_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alta_medica_motivo_saida_hospitalar_id FOREIGN KEY (motivo_saida_hospitalar_id) REFERENCES motivo_saida_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alta_medica_modalidade_assistencial_id FOREIGN KEY (modalidade_assistencial_id) REFERENCES modalidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alta_medica_obito_setor_funcional_id FOREIGN KEY (obito_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alta_medica_cancelada_por_usuario_id FOREIGN KEY (cancelada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alta_medica_motivo_cancelamento_alta_id FOREIGN KEY (motivo_cancelamento_alta_id) REFERENCES motivo_cancelamento_alta (id) ON DELETE RESTRICT;
ALTER TABLE anexo_prontuario
  ADD CONSTRAINT fk_anexo_prontuario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_anexo_prontuario_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_anexo_prontuario_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_anexo_prontuario_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_anexo_prontuario_tipo_anexo_id FOREIGN KEY (tipo_anexo_id) REFERENCES tipo_anexo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_anexo_prontuario_tipo_documento_clinico_id FOREIGN KEY (tipo_documento_clinico_id) REFERENCES tipo_documento_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_anexo_prontuario_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_anexo_prontuario_importado_profissional_id FOREIGN KEY (importado_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_anexo_prontuario_estacao_trabalho_id FOREIGN KEY (estacao_trabalho_id) REFERENCES estacao_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_anexo_prontuario_suspenso_por_usuario_id FOREIGN KEY (suspenso_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE anotacao_administrativa_caso
  ADD CONSTRAINT fk_anotacao_administrativa_caso_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_anotacao_administrativa_caso_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_anotacao_administrativa_caso_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_anotacao_administrativa_caso_categoria_anotacao_admi_86e0c9b1 FOREIGN KEY (categoria_anotacao_administrativa_id) REFERENCES categoria_anotacao_administrativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_anotacao_administrativa_caso_reserva_leito_id FOREIGN KEY (reserva_leito_id) REFERENCES reserva_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_anotacao_administrativa_caso_registrado_por_usuario_id FOREIGN KEY (registrado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_anotacao_administrativa_caso_cancelada_por_usuario_id FOREIGN KEY (cancelada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE anotacao_administrativa_caso_destinatario
  ADD CONSTRAINT fk_anotacao_administrativa_caso_destinatario_anotacao_a_1ce1a3e3 FOREIGN KEY (anotacao_administrativa_caso_id) REFERENCES anotacao_administrativa_caso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_anotacao_administrativa_caso_destinatario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE aparelho_radioterapia
  ADD CONSTRAINT fk_aparelho_radioterapia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aparelho_radioterapia_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aparelho_radioterapia_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE aplicacao_escala
  ADD CONSTRAINT fk_aplicacao_escala_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aplicacao_escala_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aplicacao_escala_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aplicacao_escala_escala_clinica_id FOREIGN KEY (escala_clinica_id) REFERENCES escala_clinica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aplicacao_escala_afericao_id FOREIGN KEY (afericao_id) REFERENCES afericao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aplicacao_escala_classificacao_risco_id FOREIGN KEY (classificacao_risco_id) REFERENCES classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aplicacao_escala_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aplicacao_escala_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aplicacao_escala_escala_clinica_faixa_id FOREIGN KEY (escala_clinica_faixa_id) REFERENCES escala_clinica_faixa (id) ON DELETE RESTRICT;
ALTER TABLE aplicacao_escala_item
  ADD CONSTRAINT fk_aplicacao_escala_item_aplicacao_escala_id FOREIGN KEY (aplicacao_escala_id) REFERENCES aplicacao_escala (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aplicacao_escala_item_escala_clinica_variavel_id FOREIGN KEY (escala_clinica_variavel_id) REFERENCES escala_clinica_variavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aplicacao_escala_item_escala_clinica_opcao_id FOREIGN KEY (escala_clinica_opcao_id) REFERENCES escala_clinica_opcao (id) ON DELETE RESTRICT;
ALTER TABLE atividade_intervencao_enfermagem
  ADD CONSTRAINT fk_atividade_intervencao_enfermagem_intervencao_enfermagem_id FOREIGN KEY (intervencao_enfermagem_id) REFERENCES intervencao_enfermagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atividade_intervencao_enfermagem_cuidado_enfermagem_id FOREIGN KEY (cuidado_enfermagem_id) REFERENCES cuidado_enfermagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atividade_intervencao_enfermagem_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT;
ALTER TABLE auditoria_checagem
  ADD CONSTRAINT fk_auditoria_checagem_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_checagem_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_checagem_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_checagem_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_checagem_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT;
ALTER TABLE auditoria_checagem_auditor
  ADD CONSTRAINT fk_auditoria_checagem_auditor_auditoria_checagem_id FOREIGN KEY (auditoria_checagem_id) REFERENCES auditoria_checagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_checagem_auditor_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE auditoria_checagem_item
  ADD CONSTRAINT fk_auditoria_checagem_item_auditoria_checagem_id FOREIGN KEY (auditoria_checagem_id) REFERENCES auditoria_checagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_checagem_item_horario_administracao_id FOREIGN KEY (horario_administracao_id) REFERENCES horario_administracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_checagem_item_auditor_usuario_id FOREIGN KEY (auditor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_checagem_item_motivo_nao_conformidade_checagem_id FOREIGN KEY (motivo_nao_conformidade_checagem_id) REFERENCES motivo_nao_conformidade_checagem (id) ON DELETE RESTRICT;
ALTER TABLE auditoria_classificacao_risco
  ADD CONSTRAINT fk_auditoria_classificacao_risco_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_classificacao_risco_protocolo_classificaca_dbcca885 FOREIGN KEY (protocolo_classificacao_risco_id) REFERENCES protocolo_classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_classificacao_risco_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_classificacao_risco_relacionada_auditoria__80d0480b FOREIGN KEY (relacionada_auditoria_classificacao_risco_id) REFERENCES auditoria_classificacao_risco (id) ON DELETE RESTRICT;
ALTER TABLE auditoria_classificacao_risco_auditor
  ADD CONSTRAINT fk_auditoria_classificacao_risco_auditor_auditoria_clas_6b2fd7a7 FOREIGN KEY (auditoria_classificacao_risco_id) REFERENCES auditoria_classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_classificacao_risco_auditor_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE auditoria_classificacao_risco_item
  ADD CONSTRAINT fk_auditoria_classificacao_risco_item_auditoria_classif_3fc34cec FOREIGN KEY (auditoria_classificacao_risco_id) REFERENCES auditoria_classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_classificacao_risco_item_classificacao_risco_id FOREIGN KEY (classificacao_risco_id) REFERENCES classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_classificacao_risco_item_atribuido_nivel_p_f5cc62d7 FOREIGN KEY (atribuido_nivel_prioridade_id) REFERENCES nivel_prioridade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_classificacao_risco_item_correto_nivel_pri_bd68dba5 FOREIGN KEY (correto_nivel_prioridade_id) REFERENCES nivel_prioridade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_classificacao_risco_item_auditor_usuario_id FOREIGN KEY (auditor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE auditoria_prescricao_ccih
  ADD CONSTRAINT fk_auditoria_prescricao_ccih_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_prescricao_ccih_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_prescricao_ccih_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_prescricao_ccih_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_prescricao_ccih_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_prescricao_ccih_ficha_antimicrobiano_id FOREIGN KEY (ficha_antimicrobiano_id) REFERENCES ficha_antimicrobiano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_prescricao_ccih_tipo_auditoria_ccih_id FOREIGN KEY (tipo_auditoria_ccih_id) REFERENCES tipo_auditoria_ccih (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_prescricao_ccih_parecer_padrao_auditoria_a_5d39cf0f FOREIGN KEY (parecer_padrao_auditoria_antimicrobiano_id) REFERENCES parecer_padrao_auditoria_antimicrobiano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_prescricao_ccih_auditor_usuario_id FOREIGN KEY (auditor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE autorizacao_acesso_prontuario_restrito
  ADD CONSTRAINT fk_autorizacao_acesso_prontuario_restrito_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_acesso_prontuario_restrito_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_acesso_prontuario_restrito_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_acesso_prontuario_restrito_pedido_acesso_da4ce5b5 FOREIGN KEY (pedido_acesso_prontuario_restrito_id) REFERENCES pedido_acesso_prontuario_restrito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_acesso_prontuario_restrito_autorizado_pr_bbc85dff FOREIGN KEY (autorizado_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_acesso_prontuario_restrito_autorizado_usuario_id FOREIGN KEY (autorizado_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_acesso_prontuario_restrito_equipe_profissional_id FOREIGN KEY (equipe_profissional_id) REFERENCES equipe_profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_acesso_prontuario_restrito_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_acesso_prontuario_restrito_concedente_usuario_id FOREIGN KEY (concedente_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_acesso_prontuario_restrito_revogada_por__91c88dfe FOREIGN KEY (revogada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE avaliacao_farmaceutica
  ADD CONSTRAINT fk_avaliacao_farmaceutica_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_farmaceutica_prescricao_id FOREIGN KEY (prescricao_id) REFERENCES prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_farmaceutica_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_farmaceutica_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_farmaceutica_farmaceutico_profissional_id FOREIGN KEY (farmaceutico_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_farmaceutica_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_farmaceutica_substituta_prescricao_id FOREIGN KEY (substituta_prescricao_id) REFERENCES prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_farmaceutica_autorizador_profissional_id FOREIGN KEY (autorizador_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
