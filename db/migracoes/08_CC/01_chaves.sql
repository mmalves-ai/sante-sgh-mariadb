-- Módulo CC, lote 01: chaves estrangeiras (aplicadas depois de todos os tabelas.sql).
ALTER TABLE agendamento_cirurgico
  ADD CONSTRAINT fk_agendamento_cirurgico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_sala_cirurgica_id FOREIGN KEY (sala_cirurgica_id) REFERENCES sala_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_cirurgiao_profissional_id FOREIGN KEY (cirurgiao_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_carater_cirurgia_id FOREIGN KEY (carater_cirurgia_id) REFERENCES carater_cirurgia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_tipo_anestesia_id FOREIGN KEY (tipo_anestesia_id) REFERENCES tipo_anestesia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_classe_contaminacao_cirurgica_id FOREIGN KEY (classe_contaminacao_cirurgica_id) REFERENCES classe_contaminacao_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_motivo_reprovacao_agendamento_cirurgico FOREIGN KEY (motivo_reprovacao_agendamento_cirurgico_id) REFERENCES motivo_reprovacao_agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_motivo_suspensao_cirurgia_id FOREIGN KEY (motivo_suspensao_cirurgia_id) REFERENCES motivo_suspensao_cirurgia (id) ON DELETE RESTRICT;
ALTER TABLE agendamento_cirurgico_equipe
  ADD CONSTRAINT fk_agendamento_cirurgico_equipe_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_equipe_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_equipe_funcao_equipe_cirurgica_id FOREIGN KEY (funcao_equipe_cirurgica_id) REFERENCES funcao_equipe_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_equipe_agendamento_cirurgico_procedimen FOREIGN KEY (agendamento_cirurgico_procedimento_id) REFERENCES agendamento_cirurgico_procedimento (id) ON DELETE RESTRICT;
ALTER TABLE agendamento_cirurgico_exame
  ADD CONSTRAINT fk_agendamento_cirurgico_exame_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_exame_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_exame_agendamento_cirurgico_procediment FOREIGN KEY (agendamento_cirurgico_procedimento_id) REFERENCES agendamento_cirurgico_procedimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_exame_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_exame_requisicao_exame_id FOREIGN KEY (requisicao_exame_id) REFERENCES requisicao_exame (id) ON DELETE RESTRICT;
ALTER TABLE agendamento_cirurgico_material
  ADD CONSTRAINT fk_agendamento_cirurgico_material_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_material_agendamento_cirurgico_procedim FOREIGN KEY (agendamento_cirurgico_procedimento_id) REFERENCES agendamento_cirurgico_procedimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_material_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_material_caixa_instrumental_id FOREIGN KEY (caixa_instrumental_id) REFERENCES caixa_instrumental (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_material_kit_material_id FOREIGN KEY (kit_material_id) REFERENCES kit_material (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_material_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_material_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_material_solicitacao_opme_id FOREIGN KEY (solicitacao_opme_id) REFERENCES solicitacao_opme (id) ON DELETE RESTRICT;
ALTER TABLE agendamento_cirurgico_procedimento
  ADD CONSTRAINT fk_agendamento_cirurgico_procedimento_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_procedimento_procedimento_cirurgico_id FOREIGN KEY (procedimento_cirurgico_id) REFERENCES procedimento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_procedimento_via_acesso_cirurgico_id FOREIGN KEY (via_acesso_cirurgico_id) REFERENCES via_acesso_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_cirurgico_procedimento_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT;
ALTER TABLE ato_cirurgico
  ADD CONSTRAINT fk_ato_cirurgico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ato_cirurgico_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ato_cirurgico_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ato_cirurgico_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ato_cirurgico_sala_cirurgica_id FOREIGN KEY (sala_cirurgica_id) REFERENCES sala_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ato_cirurgico_carater_cirurgia_id FOREIGN KEY (carater_cirurgia_id) REFERENCES carater_cirurgia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ato_cirurgico_tipo_anestesia_id FOREIGN KEY (tipo_anestesia_id) REFERENCES tipo_anestesia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ato_cirurgico_classe_contaminacao_cirurgica_id FOREIGN KEY (classe_contaminacao_cirurgica_id) REFERENCES classe_contaminacao_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ato_cirurgico_porte_cirurgico_id FOREIGN KEY (porte_cirurgico_id) REFERENCES porte_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ato_cirurgico_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ato_cirurgico_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE ato_cirurgico_exame
  ADD CONSTRAINT fk_ato_cirurgico_exame_ato_cirurgico_id FOREIGN KEY (ato_cirurgico_id) REFERENCES ato_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ato_cirurgico_exame_laudo_diagnostico_id FOREIGN KEY (laudo_diagnostico_id) REFERENCES laudo_diagnostico (id) ON DELETE RESTRICT;
ALTER TABLE ato_cirurgico_procedimento
  ADD CONSTRAINT fk_ato_cirurgico_procedimento_ato_cirurgico_id FOREIGN KEY (ato_cirurgico_id) REFERENCES ato_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ato_cirurgico_procedimento_procedimento_cirurgico_id FOREIGN KEY (procedimento_cirurgico_id) REFERENCES procedimento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ato_cirurgico_procedimento_via_acesso_cirurgico_id FOREIGN KEY (via_acesso_cirurgico_id) REFERENCES via_acesso_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ato_cirurgico_procedimento_porte_cirurgico_id FOREIGN KEY (porte_cirurgico_id) REFERENCES porte_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ato_cirurgico_procedimento_conta_hospitalar_item_id FOREIGN KEY (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT;
ALTER TABLE auditoria_profilaxia_cirurgica
  ADD CONSTRAINT fk_auditoria_profilaxia_cirurgica_ato_cirurgico_id FOREIGN KEY (ato_cirurgico_id) REFERENCES ato_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_profilaxia_cirurgica_protocolo_profilaxia_cirurgica FOREIGN KEY (protocolo_profilaxia_cirurgica_id) REFERENCES protocolo_profilaxia_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_profilaxia_cirurgica_antimicrobiano_id FOREIGN KEY (antimicrobiano_id) REFERENCES antimicrobiano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_profilaxia_cirurgica_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_profilaxia_cirurgica_avaliador_usuario_id FOREIGN KEY (avaliador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE avaliacao_pre_anestesica
  ADD CONSTRAINT fk_avaliacao_pre_anestesica_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_pre_anestesica_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_pre_anestesica_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_pre_anestesica_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_pre_anestesica_anestesista_profissional_id FOREIGN KEY (anestesista_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_pre_anestesica_classificacao_asa_id FOREIGN KEY (classificacao_asa_id) REFERENCES classificacao_asa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_pre_anestesica_tipo_anestesia_id FOREIGN KEY (tipo_anestesia_id) REFERENCES tipo_anestesia (id) ON DELETE RESTRICT;
ALTER TABLE avaliacao_recuperacao_anestesica
  ADD CONSTRAINT fk_avaliacao_recuperacao_anestesica_registro_recuperacao_anestes FOREIGN KEY (registro_recuperacao_anestesica_id) REFERENCES registro_recuperacao_anestesica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_recuperacao_anestesica_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE bloqueio_sala_cirurgica
  ADD CONSTRAINT fk_bloqueio_sala_cirurgica_sala_cirurgica_id FOREIGN KEY (sala_cirurgica_id) REFERENCES sala_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_sala_cirurgica_motivo_bloqueio_sala_cirurgica_id FOREIGN KEY (motivo_bloqueio_sala_cirurgica_id) REFERENCES motivo_bloqueio_sala_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_sala_cirurgica_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_sala_cirurgica_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_sala_cirurgica_cancelado_por_usuario_id FOREIGN KEY (cancelado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE caixa_instrumental
  ADD CONSTRAINT fk_caixa_instrumental_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caixa_instrumental_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caixa_instrumental_metodo_esterilizacao_id FOREIGN KEY (metodo_esterilizacao_id) REFERENCES metodo_esterilizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caixa_instrumental_tipo_embalagem_esteril_id FOREIGN KEY (tipo_embalagem_esteril_id) REFERENCES tipo_embalagem_esteril (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caixa_instrumental_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caixa_instrumental_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caixa_instrumental_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caixa_instrumental_foto_arquivo_id FOREIGN KEY (foto_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE caixa_instrumental_item
  ADD CONSTRAINT fk_caixa_instrumental_item_caixa_instrumental_id FOREIGN KEY (caixa_instrumental_id) REFERENCES caixa_instrumental (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caixa_instrumental_item_produto_reprocessavel_id FOREIGN KEY (produto_reprocessavel_id) REFERENCES produto_reprocessavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caixa_instrumental_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caixa_instrumental_item_bem_patrimonial_id FOREIGN KEY (bem_patrimonial_id) REFERENCES bem_patrimonial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caixa_instrumental_item_foto_arquivo_id FOREIGN KEY (foto_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE carater_cirurgia_contato
  ADD CONSTRAINT fk_carater_cirurgia_contato_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_carater_cirurgia_contato_carater_cirurgia_id FOREIGN KEY (carater_cirurgia_id) REFERENCES carater_cirurgia (id) ON DELETE RESTRICT;
ALTER TABLE cartao_preferencia_cirurgiao
  ADD CONSTRAINT fk_cartao_preferencia_cirurgiao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cartao_preferencia_cirurgiao_cirurgiao_profissional_id FOREIGN KEY (cirurgiao_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cartao_preferencia_cirurgiao_procedimento_cirurgico_id FOREIGN KEY (procedimento_cirurgico_id) REFERENCES procedimento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cartao_preferencia_cirurgiao_grupo_procedimento_cirurgico_id FOREIGN KEY (grupo_procedimento_cirurgico_id) REFERENCES grupo_procedimento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cartao_preferencia_cirurgiao_posicao_cirurgica_id FOREIGN KEY (posicao_cirurgica_id) REFERENCES posicao_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cartao_preferencia_cirurgiao_sala_cirurgica_id FOREIGN KEY (sala_cirurgica_id) REFERENCES sala_cirurgica (id) ON DELETE RESTRICT;
ALTER TABLE cartao_preferencia_cirurgiao_item
  ADD CONSTRAINT fk_cartao_preferencia_cirurgiao_item_cartao_preferencia_cirurgia FOREIGN KEY (cartao_preferencia_cirurgiao_id) REFERENCES cartao_preferencia_cirurgiao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cartao_preferencia_cirurgiao_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cartao_preferencia_cirurgiao_item_caixa_instrumental_id FOREIGN KEY (caixa_instrumental_id) REFERENCES caixa_instrumental (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cartao_preferencia_cirurgiao_item_equipamento_saude_id FOREIGN KEY (equipamento_saude_id) REFERENCES equipamento_saude (id) ON DELETE RESTRICT;
ALTER TABLE checklist_cirurgia_segura
  ADD CONSTRAINT fk_checklist_cirurgia_segura_ato_cirurgico_id FOREIGN KEY (ato_cirurgico_id) REFERENCES ato_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_checklist_cirurgia_segura_modelo_checklist_cirurgia_id FOREIGN KEY (modelo_checklist_cirurgia_id) REFERENCES modelo_checklist_cirurgia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_checklist_cirurgia_segura_inducao_profissional_id FOREIGN KEY (inducao_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_checklist_cirurgia_segura_incisao_profissional_id FOREIGN KEY (incisao_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_checklist_cirurgia_segura_saida_profissional_id FOREIGN KEY (saida_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE ciclo_esterilizacao
  ADD CONSTRAINT fk_ciclo_esterilizacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciclo_esterilizacao_equipamento_esterilizacao_id FOREIGN KEY (equipamento_esterilizacao_id) REFERENCES equipamento_esterilizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciclo_esterilizacao_metodo_esterilizacao_id FOREIGN KEY (metodo_esterilizacao_id) REFERENCES metodo_esterilizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciclo_esterilizacao_operador_usuario_id FOREIGN KEY (operador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciclo_esterilizacao_encerrado_por_usuario_id FOREIGN KEY (encerrado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciclo_esterilizacao_liberado_por_usuario_id FOREIGN KEY (liberado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE ciclo_esterilizacao_item
  ADD CONSTRAINT fk_ciclo_esterilizacao_item_ciclo_esterilizacao_id FOREIGN KEY (ciclo_esterilizacao_id) REFERENCES ciclo_esterilizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciclo_esterilizacao_item_pacote_esteril_id FOREIGN KEY (pacote_esteril_id) REFERENCES pacote_esteril (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciclo_esterilizacao_item_solicitacao_material_esteril_id FOREIGN KEY (solicitacao_material_esteril_id) REFERENCES solicitacao_material_esteril (id) ON DELETE RESTRICT;
ALTER TABLE configuracao_monitoracao_anestesica
  ADD CONSTRAINT fk_configuracao_monitoracao_anestesica_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_monitoracao_anestesica_tipo_anestesia_id FOREIGN KEY (tipo_anestesia_id) REFERENCES tipo_anestesia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_monitoracao_anestesica_tipo_sinal_monitorado_id FOREIGN KEY (tipo_sinal_monitorado_id) REFERENCES tipo_sinal_monitorado (id) ON DELETE RESTRICT;
ALTER TABLE configuracao_usuario_bloco
  ADD CONSTRAINT fk_configuracao_usuario_bloco_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_usuario_bloco_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_usuario_bloco_unidade_cirurgica_id FOREIGN KEY (unidade_cirurgica_id) REFERENCES unidade_cirurgica (id) ON DELETE RESTRICT;
ALTER TABLE confirmacao_checklist_cirurgia
  ADD CONSTRAINT fk_confirmacao_checklist_cirurgia_checklist_cirurgia_segura_id FOREIGN KEY (checklist_cirurgia_segura_id) REFERENCES checklist_cirurgia_segura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_confirmacao_checklist_cirurgia_item_checklist_cirurgia_id FOREIGN KEY (item_checklist_cirurgia_id) REFERENCES item_checklist_cirurgia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_confirmacao_checklist_cirurgia_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE consumo_cirurgia
  ADD CONSTRAINT fk_consumo_cirurgia_ato_cirurgico_id FOREIGN KEY (ato_cirurgico_id) REFERENCES ato_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_cirurgia_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_cirurgia_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_cirurgia_conferido_por_usuario_id FOREIGN KEY (conferido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE consumo_cirurgia_item
  ADD CONSTRAINT fk_consumo_cirurgia_item_consumo_cirurgia_id FOREIGN KEY (consumo_cirurgia_id) REFERENCES consumo_cirurgia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_cirurgia_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_cirurgia_item_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_cirurgia_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_cirurgia_item_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_cirurgia_item_movimento_estoque_id FOREIGN KEY (movimento_estoque_id) REFERENCES movimento_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_cirurgia_item_conta_hospitalar_item_id FOREIGN KEY (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_cirurgia_item_solicitacao_opme_item_id FOREIGN KEY (solicitacao_opme_item_id) REFERENCES solicitacao_opme_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_cirurgia_item_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT;
ALTER TABLE contagem_instrumental_cirurgia
  ADD CONSTRAINT fk_contagem_instrumental_cirurgia_ato_cirurgico_id FOREIGN KEY (ato_cirurgico_id) REFERENCES ato_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contagem_instrumental_cirurgia_caixa_instrumental_id FOREIGN KEY (caixa_instrumental_id) REFERENCES caixa_instrumental (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contagem_instrumental_cirurgia_contado_por_profissional_id FOREIGN KEY (contado_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contagem_instrumental_cirurgia_conferido_por_profissional_id FOREIGN KEY (conferido_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE descricao_cirurgica
  ADD CONSTRAINT fk_descricao_cirurgica_ato_cirurgico_id FOREIGN KEY (ato_cirurgico_id) REFERENCES ato_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_descricao_cirurgica_cirurgiao_profissional_id FOREIGN KEY (cirurgiao_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_descricao_cirurgica_concluido_por_usuario_id FOREIGN KEY (concluido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_descricao_cirurgica_assinado_por_usuario_id FOREIGN KEY (assinado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_descricao_cirurgica_documento_assinado_id FOREIGN KEY (documento_assinado_id) REFERENCES documento_assinado (id) ON DELETE RESTRICT;
ALTER TABLE descricao_cirurgica_achado
  ADD CONSTRAINT fk_descricao_cirurgica_achado_descricao_cirurgica_id FOREIGN KEY (descricao_cirurgica_id) REFERENCES descricao_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_descricao_cirurgica_achado_achado_cirurgico_padrao_id FOREIGN KEY (achado_cirurgico_padrao_id) REFERENCES achado_cirurgico_padrao (id) ON DELETE RESTRICT;
ALTER TABLE documento_cirurgia_apresentado
  ADD CONSTRAINT fk_documento_cirurgia_apresentado_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_cirurgia_apresentado_tipo_documento_pre_operatorio_ FOREIGN KEY (tipo_documento_pre_operatorio_id) REFERENCES tipo_documento_pre_operatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_cirurgia_apresentado_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_cirurgia_apresentado_conferido_por_usuario_id FOREIGN KEY (conferido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE documento_exigido_cirurgia
  ADD CONSTRAINT fk_documento_exigido_cirurgia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_exigido_cirurgia_tipo_documento_pre_operatorio_id FOREIGN KEY (tipo_documento_pre_operatorio_id) REFERENCES tipo_documento_pre_operatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_exigido_cirurgia_procedimento_cirurgico_id FOREIGN KEY (procedimento_cirurgico_id) REFERENCES procedimento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_exigido_cirurgia_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_exigido_cirurgia_faixa_etaria_id FOREIGN KEY (faixa_etaria_id) REFERENCES faixa_etaria (id) ON DELETE RESTRICT;
ALTER TABLE equipamento_esterilizacao
  ADD CONSTRAINT fk_equipamento_esterilizacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipamento_esterilizacao_equipamento_saude_id FOREIGN KEY (equipamento_saude_id) REFERENCES equipamento_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipamento_esterilizacao_bem_patrimonial_id FOREIGN KEY (bem_patrimonial_id) REFERENCES bem_patrimonial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipamento_esterilizacao_metodo_esterilizacao_id FOREIGN KEY (metodo_esterilizacao_id) REFERENCES metodo_esterilizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipamento_esterilizacao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE equipe_padrao_cirurgiao
  ADD CONSTRAINT fk_equipe_padrao_cirurgiao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_padrao_cirurgiao_cirurgiao_profissional_id FOREIGN KEY (cirurgiao_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_padrao_cirurgiao_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_padrao_cirurgiao_funcao_equipe_cirurgica_id FOREIGN KEY (funcao_equipe_cirurgica_id) REFERENCES funcao_equipe_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_padrao_cirurgiao_procedimento_cirurgico_id FOREIGN KEY (procedimento_cirurgico_id) REFERENCES procedimento_cirurgico (id) ON DELETE RESTRICT;
ALTER TABLE ficha_anestesica
  ADD CONSTRAINT fk_ficha_anestesica_ato_cirurgico_id FOREIGN KEY (ato_cirurgico_id) REFERENCES ato_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_anestesica_avaliacao_pre_anestesica_id FOREIGN KEY (avaliacao_pre_anestesica_id) REFERENCES avaliacao_pre_anestesica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_anestesica_anestesista_profissional_id FOREIGN KEY (anestesista_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_anestesica_tipo_anestesia_id FOREIGN KEY (tipo_anestesia_id) REFERENCES tipo_anestesia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_anestesica_classificacao_asa_id FOREIGN KEY (classificacao_asa_id) REFERENCES classificacao_asa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_anestesica_posicao_cirurgica_id FOREIGN KEY (posicao_cirurgica_id) REFERENCES posicao_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_anestesica_modo_ventilatorio_id FOREIGN KEY (modo_ventilatorio_id) REFERENCES modo_ventilatorio (id) ON DELETE RESTRICT;
ALTER TABLE ficha_anestesica_tecnica
  ADD CONSTRAINT fk_ficha_anestesica_tecnica_ficha_anestesica_id FOREIGN KEY (ficha_anestesica_id) REFERENCES ficha_anestesica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_anestesica_tecnica_tipo_anestesia_id FOREIGN KEY (tipo_anestesia_id) REFERENCES tipo_anestesia (id) ON DELETE RESTRICT;
ALTER TABLE grade_sala_cirurgica
  ADD CONSTRAINT fk_grade_sala_cirurgica_sala_cirurgica_id FOREIGN KEY (sala_cirurgica_id) REFERENCES sala_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grade_sala_cirurgica_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grade_sala_cirurgica_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE grupo_procedimento_cirurgico
  ADD CONSTRAINT fk_grupo_procedimento_cirurgico_grupo_superior_id FOREIGN KEY (grupo_superior_id) REFERENCES grupo_procedimento_cirurgico (id) ON DELETE RESTRICT;
ALTER TABLE hemocomponente_padrao_procedimento
  ADD CONSTRAINT fk_hemocomponente_padrao_procedimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_hemocomponente_padrao_procedimento_procedimento_cirurgico_id FOREIGN KEY (procedimento_cirurgico_id) REFERENCES procedimento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_hemocomponente_padrao_procedimento_hemocomponente_id FOREIGN KEY (hemocomponente_id) REFERENCES hemocomponente (id) ON DELETE RESTRICT;
ALTER TABLE intercorrencia_cirurgica
  ADD CONSTRAINT fk_intercorrencia_cirurgica_ato_cirurgico_id FOREIGN KEY (ato_cirurgico_id) REFERENCES ato_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_intercorrencia_cirurgica_tipo_intercorrencia_cirurgica_id FOREIGN KEY (tipo_intercorrencia_cirurgica_id) REFERENCES tipo_intercorrencia_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_intercorrencia_cirurgica_registrado_por_profissional_id FOREIGN KEY (registrado_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_intercorrencia_cirurgica_notificacao_incidente_id FOREIGN KEY (notificacao_incidente_id) REFERENCES notificacao_incidente (id) ON DELETE RESTRICT;
ALTER TABLE item_checklist_cirurgia
  ADD CONSTRAINT fk_item_checklist_cirurgia_modelo_checklist_cirurgia_id FOREIGN KEY (modelo_checklist_cirurgia_id) REFERENCES modelo_checklist_cirurgia (id) ON DELETE RESTRICT;
