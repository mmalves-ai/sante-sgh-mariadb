-- Chaves do módulo AGE, lote 02 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE perfil_marcacao_usuario
  ADD CONSTRAINT fk_perfil_marcacao_usuario_perfil_marcacao_id FOREIGN KEY (perfil_marcacao_id) REFERENCES perfil_marcacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_marcacao_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_tratamento_seriado
  ADD CONSTRAINT fk_protocolo_tratamento_seriado_item_agendavel_id FOREIGN KEY (item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_tratamento_seriado_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_tratamento_seriado_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_tratamento_seriado_dependencia
  ADD CONSTRAINT fk_protocolo_tratamento_seriado_dependencia_protocolo_id FOREIGN KEY (protocolo_tratamento_seriado_id) REFERENCES protocolo_tratamento_seriado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_tratamento_seriado_dependencia_dependente_id FOREIGN KEY (dependente_protocolo_tratamento_seriado_id) REFERENCES protocolo_tratamento_seriado (id) ON DELETE RESTRICT;
ALTER TABLE recurso_agendavel
  ADD CONSTRAINT fk_recurso_agendavel_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_agendavel_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_agendavel_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_agendavel_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_agendavel_local_fisico_id FOREIGN KEY (local_fisico_id) REFERENCES local_fisico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_agendavel_equipamento_saude_id FOREIGN KEY (equipamento_saude_id) REFERENCES equipamento_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_agendavel_complexidade_sessao_id FOREIGN KEY (complexidade_sessao_id) REFERENCES complexidade_sessao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_agendavel_duracao_sessao_id FOREIGN KEY (duracao_sessao_id) REFERENCES duracao_sessao (id) ON DELETE RESTRICT;
ALTER TABLE plano_sessao
  ADD CONSTRAINT fk_plano_sessao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_sessao_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_sessao_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_sessao_protocolo_tratamento_seriado_id FOREIGN KEY (protocolo_tratamento_seriado_id) REFERENCES protocolo_tratamento_seriado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_sessao_item_agendavel_id FOREIGN KEY (item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_sessao_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_sessao_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_sessao_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_sessao_tipo_marcacao_id FOREIGN KEY (tipo_marcacao_id) REFERENCES tipo_marcacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_sessao_agenda_servico_id FOREIGN KEY (agenda_servico_id) REFERENCES agenda_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_sessao_recurso_agendavel_id FOREIGN KEY (recurso_agendavel_id) REFERENCES recurso_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_sessao_fase_tratamento_id FOREIGN KEY (fase_tratamento_id) REFERENCES fase_tratamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_sessao_complexidade_sessao_id FOREIGN KEY (complexidade_sessao_id) REFERENCES complexidade_sessao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_sessao_duracao_sessao_id FOREIGN KEY (duracao_sessao_id) REFERENCES duracao_sessao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_sessao_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_sessao_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_sessao_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_sessao_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_sessao_guia_tiss_id FOREIGN KEY (guia_tiss_id) REFERENCES guia_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_sessao_encaminhamento_paciente_id FOREIGN KEY (encaminhamento_paciente_id) REFERENCES encaminhamento_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_sessao_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_sessao_tratamento_oncologico_id FOREIGN KEY (tratamento_oncologico_id) REFERENCES tratamento_oncologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_sessao_cancelado_usuario_id FOREIGN KEY (cancelado_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE plano_sessao_material
  ADD CONSTRAINT fk_plano_sessao_material_plano_sessao_id FOREIGN KEY (plano_sessao_id) REFERENCES plano_sessao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_sessao_material_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_sessao_material_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE prazo_aviso_marcacao
  ADD CONSTRAINT fk_prazo_aviso_marcacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prazo_aviso_marcacao_item_agendavel_id FOREIGN KEY (item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prazo_aviso_marcacao_agenda_servico_id FOREIGN KEY (agenda_servico_id) REFERENCES agenda_servico (id) ON DELETE RESTRICT;
ALTER TABLE pre_checkin
  ADD CONSTRAINT fk_pre_checkin_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pre_checkin_marcacao_horario_id FOREIGN KEY (marcacao_horario_id) REFERENCES marcacao_horario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pre_checkin_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pre_checkin_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pre_checkin_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pre_checkin_termo_consentimento_paciente_id FOREIGN KEY (termo_consentimento_paciente_id) REFERENCES termo_consentimento_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pre_checkin_conferido_usuario_id FOREIGN KEY (conferido_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE profissional_aviso
  ADD CONSTRAINT fk_profissional_aviso_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_aviso_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_aviso_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT;
ALTER TABLE profissional_recurso_agendavel
  ADD CONSTRAINT fk_profissional_recurso_agendavel_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_recurso_agendavel_recurso_agendavel_id FOREIGN KEY (recurso_agendavel_id) REFERENCES recurso_agendavel (id) ON DELETE RESTRICT;
ALTER TABLE recusa_rede_credenciada
  ADD CONSTRAINT fk_recusa_rede_credenciada_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recusa_rede_credenciada_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recusa_rede_credenciada_item_agendavel_id FOREIGN KEY (item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recusa_rede_credenciada_lista_espera_id FOREIGN KEY (lista_espera_id) REFERENCES lista_espera (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recusa_rede_credenciada_oferecido_estabelecimento_externo_id FOREIGN KEY (oferecido_estabelecimento_externo_id) REFERENCES estabelecimento_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recusa_rede_credenciada_oferecido_prestador_terceiro_id FOREIGN KEY (oferecido_prestador_terceiro_id) REFERENCES prestador_terceiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recusa_rede_credenciada_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE regra_lembrete_marcacao
  ADD CONSTRAINT fk_regra_lembrete_marcacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_lembrete_marcacao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_lembrete_marcacao_agenda_servico_id FOREIGN KEY (agenda_servico_id) REFERENCES agenda_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_lembrete_marcacao_item_agendavel_id FOREIGN KEY (item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_lembrete_marcacao_tipo_marcacao_id FOREIGN KEY (tipo_marcacao_id) REFERENCES tipo_marcacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_lembrete_marcacao_canal_notificacao_id FOREIGN KEY (canal_notificacao_id) REFERENCES canal_notificacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_lembrete_marcacao_modelo_mensagem_paciente_id FOREIGN KEY (modelo_mensagem_paciente_id) REFERENCES modelo_mensagem_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_lembrete_marcacao_recusa_motivo_id FOREIGN KEY (recusa_motivo_cancelamento_operacao_id) REFERENCES motivo_cancelamento_operacao (id) ON DELETE RESTRICT;
ALTER TABLE regra_marcacao_apos_falta
  ADD CONSTRAINT fk_regra_marcacao_apos_falta_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_marcacao_apos_falta_item_agendavel_id FOREIGN KEY (item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT;
ALTER TABLE regra_redistribuicao_vaga
  ADD CONSTRAINT fk_regra_redistribuicao_vaga_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_redistribuicao_vaga_origem_servico_atendimento_id FOREIGN KEY (origem_servico_atendimento_id) REFERENCES servico_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_redistribuicao_vaga_destino_servico_atendimento_id FOREIGN KEY (destino_servico_atendimento_id) REFERENCES servico_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_redistribuicao_vaga_origem_tipo_marcacao_id FOREIGN KEY (origem_tipo_marcacao_id) REFERENCES tipo_marcacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_redistribuicao_vaga_destino_tipo_marcacao_id FOREIGN KEY (destino_tipo_marcacao_id) REFERENCES tipo_marcacao (id) ON DELETE RESTRICT;
ALTER TABLE regra_redistribuicao_vaga_profissional
  ADD CONSTRAINT fk_regra_redistribuicao_vaga_profissional_regra_id FOREIGN KEY (regra_redistribuicao_vaga_id) REFERENCES regra_redistribuicao_vaga (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_redistribuicao_vaga_profissional_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE regra_retorno_consulta
  ADD CONSTRAINT fk_regra_retorno_consulta_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_retorno_consulta_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_retorno_consulta_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_retorno_consulta_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_retorno_consulta_agenda_servico_id FOREIGN KEY (agenda_servico_id) REFERENCES agenda_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_retorno_consulta_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_retorno_consulta_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE sessao_terapeutica
  ADD CONSTRAINT fk_sessao_terapeutica_plano_sessao_id FOREIGN KEY (plano_sessao_id) REFERENCES plano_sessao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_terapeutica_marcacao_horario_id FOREIGN KEY (marcacao_horario_id) REFERENCES marcacao_horario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_terapeutica_horario_agenda_id FOREIGN KEY (horario_agenda_id) REFERENCES horario_agenda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_terapeutica_recurso_agendavel_id FOREIGN KEY (recurso_agendavel_id) REFERENCES recurso_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_terapeutica_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_terapeutica_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_terapeutica_guia_tiss_id FOREIGN KEY (guia_tiss_id) REFERENCES guia_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_terapeutica_cancelado_usuario_id FOREIGN KEY (cancelado_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_terapeutica_motivo_cancelamento_operacao_id FOREIGN KEY (motivo_cancelamento_operacao_id) REFERENCES motivo_cancelamento_operacao (id) ON DELETE RESTRICT;
ALTER TABLE situacao_marcacao
  ADD CONSTRAINT fk_situacao_marcacao_icone_arquivo_id FOREIGN KEY (icone_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE tipo_marcacao
  ADD CONSTRAINT fk_tipo_marcacao_carater_atendimento_tiss_id FOREIGN KEY (carater_atendimento_tiss_id) REFERENCES carater_atendimento_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_marcacao_servico_atendimento_id FOREIGN KEY (servico_atendimento_id) REFERENCES servico_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE teleconsulta
  ADD CONSTRAINT fk_teleconsulta_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teleconsulta_marcacao_horario_id FOREIGN KEY (marcacao_horario_id) REFERENCES marcacao_horario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teleconsulta_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teleconsulta_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teleconsulta_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teleconsulta_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teleconsulta_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teleconsulta_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teleconsulta_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teleconsulta_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teleconsulta_local_paciente_unidade_federativa_id FOREIGN KEY (local_paciente_unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teleconsulta_termo_consentimento_paciente_id FOREIGN KEY (termo_consentimento_paciente_id) REFERENCES termo_consentimento_paciente (id) ON DELETE RESTRICT;
ALTER TABLE teleconsulta_participante
  ADD CONSTRAINT fk_teleconsulta_participante_teleconsulta_id FOREIGN KEY (teleconsulta_id) REFERENCES teleconsulta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teleconsulta_participante_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teleconsulta_participante_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teleconsulta_participante_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE turma_atividade
  ADD CONSTRAINT fk_turma_atividade_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_atividade_tipo_turma_atividade_id FOREIGN KEY (tipo_turma_atividade_id) REFERENCES tipo_turma_atividade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_atividade_item_agendavel_id FOREIGN KEY (item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_atividade_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_atividade_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_atividade_servico_atendimento_id FOREIGN KEY (servico_atendimento_id) REFERENCES servico_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_atividade_tipo_marcacao_id FOREIGN KEY (tipo_marcacao_id) REFERENCES tipo_marcacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_atividade_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_atividade_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_atividade_local_fisico_id FOREIGN KEY (local_fisico_id) REFERENCES local_fisico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_atividade_sexo_id FOREIGN KEY (sexo_id) REFERENCES sexo (id) ON DELETE RESTRICT;
ALTER TABLE turma_escala
  ADD CONSTRAINT fk_turma_escala_turma_atividade_id FOREIGN KEY (turma_atividade_id) REFERENCES turma_atividade (id) ON DELETE RESTRICT;
ALTER TABLE turma_encontro
  ADD CONSTRAINT fk_turma_encontro_turma_atividade_id FOREIGN KEY (turma_atividade_id) REFERENCES turma_atividade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_encontro_turma_escala_id FOREIGN KEY (turma_escala_id) REFERENCES turma_escala (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_encontro_local_fisico_id FOREIGN KEY (local_fisico_id) REFERENCES local_fisico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_encontro_condutor_profissional_id FOREIGN KEY (condutor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_encontro_horario_agenda_id FOREIGN KEY (horario_agenda_id) REFERENCES horario_agenda (id) ON DELETE RESTRICT;
ALTER TABLE turma_fonte_pagadora
  ADD CONSTRAINT fk_turma_fonte_pagadora_turma_atividade_id FOREIGN KEY (turma_atividade_id) REFERENCES turma_atividade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_fonte_pagadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_fonte_pagadora_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE turma_participante
  ADD CONSTRAINT fk_turma_participante_turma_atividade_id FOREIGN KEY (turma_atividade_id) REFERENCES turma_atividade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_participante_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_participante_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_participante_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_participante_plano_sessao_id FOREIGN KEY (plano_sessao_id) REFERENCES plano_sessao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_participante_indicacao_profissional_id FOREIGN KEY (indicacao_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_participante_marcacao_horario_id FOREIGN KEY (marcacao_horario_id) REFERENCES marcacao_horario (id) ON DELETE RESTRICT;
ALTER TABLE turma_presenca
  ADD CONSTRAINT fk_turma_presenca_turma_encontro_id FOREIGN KEY (turma_encontro_id) REFERENCES turma_encontro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_presenca_turma_participante_id FOREIGN KEY (turma_participante_id) REFERENCES turma_participante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_presenca_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT;
ALTER TABLE turma_profissional
  ADD CONSTRAINT fk_turma_profissional_turma_atividade_id FOREIGN KEY (turma_atividade_id) REFERENCES turma_atividade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_profissional_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
