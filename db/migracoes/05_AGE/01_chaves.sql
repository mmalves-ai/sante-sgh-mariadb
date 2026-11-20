-- Módulo AGE, lote 01: chaves estrangeiras (aplicadas depois de todos os tabelas.sql).
ALTER TABLE agenda_escala
  ADD CONSTRAINT fk_agenda_escala_agenda_servico_id FOREIGN KEY (agenda_servico_id) REFERENCES agenda_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_escala_tipo_marcacao_id FOREIGN KEY (tipo_marcacao_id) REFERENCES tipo_marcacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_escala_recurso_agendavel_id FOREIGN KEY (recurso_agendavel_id) REFERENCES recurso_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_escala_local_atendimento_id FOREIGN KEY (local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE agenda_escala_restricao
  ADD CONSTRAINT fk_agenda_escala_restricao_agenda_escala_id FOREIGN KEY (agenda_escala_id) REFERENCES agenda_escala (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_escala_restricao_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_escala_restricao_tipo_marcacao_id FOREIGN KEY (tipo_marcacao_id) REFERENCES tipo_marcacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_escala_restricao_item_agendavel_id FOREIGN KEY (item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT;
ALTER TABLE agenda_especialidade
  ADD CONSTRAINT fk_agenda_especialidade_agenda_servico_id FOREIGN KEY (agenda_servico_id) REFERENCES agenda_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_especialidade_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT;
ALTER TABLE agenda_fonte_pagadora
  ADD CONSTRAINT fk_agenda_fonte_pagadora_agenda_servico_id FOREIGN KEY (agenda_servico_id) REFERENCES agenda_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_fonte_pagadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE agenda_item_agendavel
  ADD CONSTRAINT fk_agenda_item_agendavel_agenda_servico_id FOREIGN KEY (agenda_servico_id) REFERENCES agenda_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_item_agendavel_item_agendavel_id FOREIGN KEY (item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT;
ALTER TABLE agenda_recurso
  ADD CONSTRAINT fk_agenda_recurso_agenda_servico_id FOREIGN KEY (agenda_servico_id) REFERENCES agenda_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_recurso_recurso_agendavel_id FOREIGN KEY (recurso_agendavel_id) REFERENCES recurso_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_recurso_complexidade_sessao_id FOREIGN KEY (complexidade_sessao_id) REFERENCES complexidade_sessao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_recurso_duracao_sessao_id FOREIGN KEY (duracao_sessao_id) REFERENCES duracao_sessao (id) ON DELETE RESTRICT;
ALTER TABLE agenda_servico
  ADD CONSTRAINT fk_agenda_servico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_servico_categoria_agenda_id FOREIGN KEY (categoria_agenda_id) REFERENCES categoria_agenda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_servico_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_servico_recurso_agendavel_id FOREIGN KEY (recurso_agendavel_id) REFERENCES recurso_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_servico_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_servico_local_atendimento_id FOREIGN KEY (local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_servico_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_servico_modo_agendamento_online_id FOREIGN KEY (modo_agendamento_online_id) REFERENCES modo_agendamento_online (id) ON DELETE RESTRICT;
ALTER TABLE agenda_servico_tipo_marcacao
  ADD CONSTRAINT fk_agenda_servico_tipo_marcacao_agenda_servico_id FOREIGN KEY (agenda_servico_id) REFERENCES agenda_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_servico_tipo_marcacao_tipo_marcacao_id FOREIGN KEY (tipo_marcacao_id) REFERENCES tipo_marcacao (id) ON DELETE RESTRICT;
ALTER TABLE agenda_usuario
  ADD CONSTRAINT fk_agenda_usuario_agenda_servico_id FOREIGN KEY (agenda_servico_id) REFERENCES agenda_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE bloqueio_agenda
  ADD CONSTRAINT fk_bloqueio_agenda_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_agenda_agenda_servico_id FOREIGN KEY (agenda_servico_id) REFERENCES agenda_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_agenda_recurso_agendavel_id FOREIGN KEY (recurso_agendavel_id) REFERENCES recurso_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_agenda_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_agenda_motivo_bloqueio_agenda_id FOREIGN KEY (motivo_bloqueio_agenda_id) REFERENCES motivo_bloqueio_agenda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_agenda_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_agenda_desbloqueio_usuario_id FOREIGN KEY (desbloqueio_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE cancelamento_marcacao
  ADD CONSTRAINT fk_cancelamento_marcacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_marcacao_marcacao_horario_id FOREIGN KEY (marcacao_horario_id) REFERENCES marcacao_horario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_marcacao_motivo_cancelamento_operacao_id FOREIGN KEY (motivo_cancelamento_operacao_id) REFERENCES motivo_cancelamento_operacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_marcacao_canal_marcacao_id FOREIGN KEY (canal_marcacao_id) REFERENCES canal_marcacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_marcacao_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_marcacao_nova_marcacao_horario_id FOREIGN KEY (nova_marcacao_horario_id) REFERENCES marcacao_horario (id) ON DELETE RESTRICT;
ALTER TABLE confirmacao_marcacao
  ADD CONSTRAINT fk_confirmacao_marcacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_confirmacao_marcacao_marcacao_horario_id FOREIGN KEY (marcacao_horario_id) REFERENCES marcacao_horario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_confirmacao_marcacao_canal_marcacao_id FOREIGN KEY (canal_marcacao_id) REFERENCES canal_marcacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_confirmacao_marcacao_situacao_confirmacao_id FOREIGN KEY (situacao_confirmacao_id) REFERENCES situacao_confirmacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_confirmacao_marcacao_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_confirmacao_marcacao_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE cota_marcacao
  ADD CONSTRAINT fk_cota_marcacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cota_marcacao_agenda_servico_id FOREIGN KEY (agenda_servico_id) REFERENCES agenda_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cota_marcacao_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cota_marcacao_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cota_marcacao_tipo_marcacao_id FOREIGN KEY (tipo_marcacao_id) REFERENCES tipo_marcacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cota_marcacao_item_agendavel_id FOREIGN KEY (item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT;
ALTER TABLE geracao_grade
  ADD CONSTRAINT fk_geracao_grade_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_geracao_grade_agenda_servico_id FOREIGN KEY (agenda_servico_id) REFERENCES agenda_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_geracao_grade_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_geracao_grade_reversao_usuario_id FOREIGN KEY (reversao_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE geracao_grade_periodo
  ADD CONSTRAINT fk_geracao_grade_periodo_geracao_grade_id FOREIGN KEY (geracao_grade_id) REFERENCES geracao_grade (id) ON DELETE RESTRICT;
ALTER TABLE horario_agenda
  ADD CONSTRAINT fk_horario_agenda_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_agenda_agenda_servico_id FOREIGN KEY (agenda_servico_id) REFERENCES agenda_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_agenda_geracao_grade_id FOREIGN KEY (geracao_grade_id) REFERENCES geracao_grade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_agenda_tipo_marcacao_id FOREIGN KEY (tipo_marcacao_id) REFERENCES tipo_marcacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_agenda_recurso_agendavel_id FOREIGN KEY (recurso_agendavel_id) REFERENCES recurso_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_agenda_local_atendimento_id FOREIGN KEY (local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_agenda_bloqueio_agenda_id FOREIGN KEY (bloqueio_agenda_id) REFERENCES bloqueio_agenda (id) ON DELETE RESTRICT;
ALTER TABLE intervalo_minimo_servico
  ADD CONSTRAINT fk_intervalo_minimo_servico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_intervalo_minimo_servico_agenda_servico_id FOREIGN KEY (agenda_servico_id) REFERENCES agenda_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_intervalo_minimo_servico_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_intervalo_minimo_servico_item_agendavel_id FOREIGN KEY (item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_intervalo_minimo_servico_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_intervalo_minimo_servico_tipo_marcacao_id FOREIGN KEY (tipo_marcacao_id) REFERENCES tipo_marcacao (id) ON DELETE RESTRICT;
ALTER TABLE item_agendavel
  ADD CONSTRAINT fk_item_agendavel_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_agendavel_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT;
ALTER TABLE item_agendavel_composicao
  ADD CONSTRAINT fk_item_agendavel_composicao_item_agendavel_id FOREIGN KEY (item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_agendavel_composicao_componente_item_agendavel_id FOREIGN KEY (componente_item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT;
ALTER TABLE item_agendavel_conflito
  ADD CONSTRAINT fk_item_agendavel_conflito_item_agendavel_id FOREIGN KEY (item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_agendavel_conflito_conflito_item_agendavel_id FOREIGN KEY (conflito_item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT;
ALTER TABLE item_agendavel_especialidade
  ADD CONSTRAINT fk_item_agendavel_especialidade_item_agendavel_id FOREIGN KEY (item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_agendavel_especialidade_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT;
ALTER TABLE item_agendavel_orientacao_fonte_pagadora
  ADD CONSTRAINT fk_item_agendavel_orientacao_fonte_pagadora_item_agendavel_id FOREIGN KEY (item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_agendavel_orientacao_fonte_pagadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE item_agendavel_pre_requisito
  ADD CONSTRAINT fk_item_agendavel_pre_requisito_item_agendavel_id FOREIGN KEY (item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_agendavel_pre_requisito_requisito_item_agendavel_id FOREIGN KEY (requisito_item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT;
ALTER TABLE item_agendavel_profissional
  ADD CONSTRAINT fk_item_agendavel_profissional_item_agendavel_id FOREIGN KEY (item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_agendavel_profissional_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE item_agendavel_recurso
  ADD CONSTRAINT fk_item_agendavel_recurso_item_agendavel_id FOREIGN KEY (item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_agendavel_recurso_recurso_agendavel_id FOREIGN KEY (recurso_agendavel_id) REFERENCES recurso_agendavel (id) ON DELETE RESTRICT;
ALTER TABLE linha_cuidado_item_agendavel
  ADD CONSTRAINT fk_linha_cuidado_item_agendavel_linha_cuidado_id FOREIGN KEY (linha_cuidado_id) REFERENCES linha_cuidado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_linha_cuidado_item_agendavel_item_agendavel_id FOREIGN KEY (item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT;
ALTER TABLE lista_espera
  ADD CONSTRAINT fk_lista_espera_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_espera_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_espera_pre_cadastro_id FOREIGN KEY (pre_cadastro_id) REFERENCES pre_cadastro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_espera_agenda_servico_id FOREIGN KEY (agenda_servico_id) REFERENCES agenda_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_espera_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_espera_item_agendavel_id FOREIGN KEY (item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_espera_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_espera_recurso_agendavel_id FOREIGN KEY (recurso_agendavel_id) REFERENCES recurso_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_espera_tipo_marcacao_id FOREIGN KEY (tipo_marcacao_id) REFERENCES tipo_marcacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_espera_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_espera_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_espera_grupo_prioridade_legal_id FOREIGN KEY (grupo_prioridade_legal_id) REFERENCES grupo_prioridade_legal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_espera_canal_marcacao_id FOREIGN KEY (canal_marcacao_id) REFERENCES canal_marcacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_espera_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_espera_solicitacao_regulacao_id FOREIGN KEY (solicitacao_regulacao_id) REFERENCES solicitacao_regulacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_espera_marcacao_horario_id FOREIGN KEY (marcacao_horario_id) REFERENCES marcacao_horario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_espera_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE lista_espera_historico
  ADD CONSTRAINT fk_lista_espera_historico_lista_espera_id FOREIGN KEY (lista_espera_id) REFERENCES lista_espera (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_espera_historico_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE lista_espera_item
  ADD CONSTRAINT fk_lista_espera_item_lista_espera_id FOREIGN KEY (lista_espera_id) REFERENCES lista_espera (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_espera_item_item_agendavel_id FOREIGN KEY (item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_espera_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_espera_item_marcacao_horario_id FOREIGN KEY (marcacao_horario_id) REFERENCES marcacao_horario (id) ON DELETE RESTRICT;
ALTER TABLE marcacao_equipamento
  ADD CONSTRAINT fk_marcacao_equipamento_marcacao_horario_id FOREIGN KEY (marcacao_horario_id) REFERENCES marcacao_horario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_equipamento_equipamento_saude_id FOREIGN KEY (equipamento_saude_id) REFERENCES equipamento_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_equipamento_item_agendavel_id FOREIGN KEY (item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT;
ALTER TABLE marcacao_horario
  ADD CONSTRAINT fk_marcacao_horario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_horario_horario_agenda_id FOREIGN KEY (horario_agenda_id) REFERENCES horario_agenda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_horario_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_horario_pre_cadastro_id FOREIGN KEY (pre_cadastro_id) REFERENCES pre_cadastro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_horario_tipo_marcacao_id FOREIGN KEY (tipo_marcacao_id) REFERENCES tipo_marcacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_horario_situacao_marcacao_id FOREIGN KEY (situacao_marcacao_id) REFERENCES situacao_marcacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_horario_canal_marcacao_id FOREIGN KEY (canal_marcacao_id) REFERENCES canal_marcacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_horario_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_horario_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_horario_item_agendavel_id FOREIGN KEY (item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_horario_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_horario_executante_profissional_id FOREIGN KEY (executante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_horario_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_horario_solicitante_externo_id FOREIGN KEY (solicitante_externo_id) REFERENCES solicitante_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_horario_motivo_marcacao_id FOREIGN KEY (motivo_marcacao_id) REFERENCES motivo_marcacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_horario_ajuste_tempo_marcacao_id FOREIGN KEY (ajuste_tempo_marcacao_id) REFERENCES ajuste_tempo_marcacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_horario_grupo_prioridade_legal_id FOREIGN KEY (grupo_prioridade_legal_id) REFERENCES grupo_prioridade_legal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_horario_fase_tratamento_id FOREIGN KEY (fase_tratamento_id) REFERENCES fase_tratamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_horario_lista_espera_id FOREIGN KEY (lista_espera_id) REFERENCES lista_espera (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_horario_retorno_marcacao_horario_id FOREIGN KEY (retorno_marcacao_horario_id) REFERENCES marcacao_horario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_horario_remarcada_marcacao_horario_id FOREIGN KEY (remarcada_marcacao_horario_id) REFERENCES marcacao_horario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_horario_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_horario_guia_tiss_id FOREIGN KEY (guia_tiss_id) REFERENCES guia_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_horario_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE marcacao_horario_historico
  ADD CONSTRAINT fk_marcacao_horario_historico_marcacao_horario_id FOREIGN KEY (marcacao_horario_id) REFERENCES marcacao_horario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_horario_historico_situacao_marcacao_id FOREIGN KEY (situacao_marcacao_id) REFERENCES situacao_marcacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_horario_historico_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE marcacao_horario_item
  ADD CONSTRAINT fk_marcacao_horario_item_marcacao_horario_id FOREIGN KEY (marcacao_horario_id) REFERENCES marcacao_horario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_horario_item_item_agendavel_id FOREIGN KEY (item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_horario_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_horario_item_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT;
ALTER TABLE motivo_marcacao
  ADD CONSTRAINT fk_motivo_marcacao_tipo_marcacao_id FOREIGN KEY (tipo_marcacao_id) REFERENCES tipo_marcacao (id) ON DELETE RESTRICT;
ALTER TABLE paciente_prioridade_legal
  ADD CONSTRAINT fk_paciente_prioridade_legal_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_prioridade_legal_grupo_prioridade_legal_id FOREIGN KEY (grupo_prioridade_legal_id) REFERENCES grupo_prioridade_legal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_prioridade_legal_comprovante_arquivo_id FOREIGN KEY (comprovante_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_prioridade_legal_verificador_usuario_id FOREIGN KEY (verificador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE perfil_marcacao
  ADD CONSTRAINT fk_perfil_marcacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE perfil_marcacao_escopo
  ADD CONSTRAINT fk_perfil_marcacao_escopo_perfil_marcacao_id FOREIGN KEY (perfil_marcacao_id) REFERENCES perfil_marcacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_marcacao_escopo_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_marcacao_escopo_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_marcacao_escopo_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_marcacao_escopo_agenda_servico_id FOREIGN KEY (agenda_servico_id) REFERENCES agenda_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_marcacao_escopo_escopo_estabelecimento_id FOREIGN KEY (escopo_estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_marcacao_escopo_item_agendavel_id FOREIGN KEY (item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_marcacao_escopo_categoria_profissional_id FOREIGN KEY (categoria_profissional_id) REFERENCES categoria_profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_marcacao_escopo_tipo_marcacao_id FOREIGN KEY (tipo_marcacao_id) REFERENCES tipo_marcacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_marcacao_escopo_recurso_agendavel_id FOREIGN KEY (recurso_agendavel_id) REFERENCES recurso_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_marcacao_escopo_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
