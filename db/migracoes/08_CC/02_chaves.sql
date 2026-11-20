-- Chaves do módulo CC, lote 02 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE lancamento_ficha_anestesica
  ADD CONSTRAINT fk_lancamento_ficha_anestesica_ficha_anestesica_id FOREIGN KEY (ficha_anestesica_id) REFERENCES ficha_anestesica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_ficha_anestesica_tipo_sinal_monitorado_id FOREIGN KEY (tipo_sinal_monitorado_id) REFERENCES tipo_sinal_monitorado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_ficha_anestesica_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_ficha_anestesica_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_ficha_anestesica_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_ficha_anestesica_hemocomponente_id FOREIGN KEY (hemocomponente_id) REFERENCES hemocomponente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_ficha_anestesica_modo_ventilatorio_id FOREIGN KEY (modo_ventilatorio_id) REFERENCES modo_ventilatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_ficha_anestesica_posicao_cirurgica_id FOREIGN KEY (posicao_cirurgica_id) REFERENCES posicao_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_ficha_anestesica_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_ficha_anestesica_funcao_equipe_cirurgica_id FOREIGN KEY (funcao_equipe_cirurgica_id) REFERENCES funcao_equipe_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_ficha_anestesica_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT;
ALTER TABLE lista_material_procedimento
  ADD CONSTRAINT fk_lista_material_procedimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_material_procedimento_procedimento_cirurgico_id FOREIGN KEY (procedimento_cirurgico_id) REFERENCES procedimento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_material_procedimento_cirurgiao_profissional_id FOREIGN KEY (cirurgiao_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_material_procedimento_tipo_anestesia_id FOREIGN KEY (tipo_anestesia_id) REFERENCES tipo_anestesia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_material_procedimento_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_material_procedimento_kit_material_id FOREIGN KEY (kit_material_id) REFERENCES kit_material (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_material_procedimento_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE marco_ficha_anestesica
  ADD CONSTRAINT fk_marco_ficha_anestesica_ficha_anestesica_id FOREIGN KEY (ficha_anestesica_id) REFERENCES ficha_anestesica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marco_ficha_anestesica_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE material_terceiro_reprocessamento
  ADD CONSTRAINT fk_material_terceiro_reprocessamento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_material_terceiro_reprocessamento_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_material_terceiro_reprocessamento_proprietario_profi_0c216e3b FOREIGN KEY (proprietario_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_material_terceiro_reprocessamento_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_material_terceiro_reprocessamento_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_material_terceiro_reprocessamento_arsenal_setor_funcional_id FOREIGN KEY (arsenal_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE modelo_checklist_cirurgia
  ADD CONSTRAINT fk_modelo_checklist_cirurgia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE motivo_rejeicao_reprocessamento
  ADD CONSTRAINT fk_motivo_rejeicao_reprocessamento_fase_reprocessamento_id FOREIGN KEY (fase_reprocessamento_id) REFERENCES fase_reprocessamento (id) ON DELETE RESTRICT;
ALTER TABLE movimento_material_esteril
  ADD CONSTRAINT fk_movimento_material_esteril_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_material_esteril_cme_setor_funcional_id FOREIGN KEY (cme_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_material_esteril_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_material_esteril_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_material_esteril_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_material_esteril_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_material_esteril_solicitacao_material_esteril_id FOREIGN KEY (solicitacao_material_esteril_id) REFERENCES solicitacao_material_esteril (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_material_esteril_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_material_esteril_recebedor_usuario_id FOREIGN KEY (recebedor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_material_esteril_conferido_por_usuario_id FOREIGN KEY (conferido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE movimento_material_esteril_item
  ADD CONSTRAINT fk_movimento_material_esteril_item_movimento_material_esteril_id FOREIGN KEY (movimento_material_esteril_id) REFERENCES movimento_material_esteril (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_material_esteril_item_pacote_esteril_id FOREIGN KEY (pacote_esteril_id) REFERENCES pacote_esteril (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_material_esteril_item_caixa_instrumental_id FOREIGN KEY (caixa_instrumental_id) REFERENCES caixa_instrumental (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_material_esteril_item_produto_reprocessavel_id FOREIGN KEY (produto_reprocessavel_id) REFERENCES produto_reprocessavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_material_esteril_item_material_terceiro_re_95c85b34 FOREIGN KEY (material_terceiro_reprocessamento_id) REFERENCES material_terceiro_reprocessamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_material_esteril_item_destino_setor_funcional_id FOREIGN KEY (destino_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE movimento_paciente_bloco
  ADD CONSTRAINT fk_movimento_paciente_bloco_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_paciente_bloco_unidade_cirurgica_id FOREIGN KEY (unidade_cirurgica_id) REFERENCES unidade_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_paciente_bloco_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_paciente_bloco_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_paciente_bloco_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_paciente_bloco_tipo_movimento_bloco_id FOREIGN KEY (tipo_movimento_bloco_id) REFERENCES tipo_movimento_bloco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_paciente_bloco_local_bloco_id FOREIGN KEY (local_bloco_id) REFERENCES local_bloco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_paciente_bloco_anterior_local_bloco_id FOREIGN KEY (anterior_local_bloco_id) REFERENCES local_bloco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_paciente_bloco_sala_cirurgica_id FOREIGN KEY (sala_cirurgica_id) REFERENCES sala_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_paciente_bloco_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_paciente_bloco_situacao_bloco_id FOREIGN KEY (situacao_bloco_id) REFERENCES situacao_bloco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_paciente_bloco_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_paciente_bloco_desfeito_movimento_paciente_bloco_id FOREIGN KEY (desfeito_movimento_paciente_bloco_id) REFERENCES movimento_paciente_bloco (id) ON DELETE RESTRICT;
ALTER TABLE pacote_esteril
  ADD CONSTRAINT fk_pacote_esteril_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_esteril_caixa_instrumental_id FOREIGN KEY (caixa_instrumental_id) REFERENCES caixa_instrumental (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_esteril_produto_reprocessavel_id FOREIGN KEY (produto_reprocessavel_id) REFERENCES produto_reprocessavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_esteril_material_terceiro_reprocessamento_id FOREIGN KEY (material_terceiro_reprocessamento_id) REFERENCES material_terceiro_reprocessamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_esteril_kit_material_id FOREIGN KEY (kit_material_id) REFERENCES kit_material (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_esteril_ciclo_esterilizacao_id FOREIGN KEY (ciclo_esterilizacao_id) REFERENCES ciclo_esterilizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_esteril_metodo_esterilizacao_id FOREIGN KEY (metodo_esterilizacao_id) REFERENCES metodo_esterilizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_esteril_tipo_embalagem_esteril_id FOREIGN KEY (tipo_embalagem_esteril_id) REFERENCES tipo_embalagem_esteril (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_esteril_preparado_por_usuario_id FOREIGN KEY (preparado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_esteril_guarda_setor_funcional_id FOREIGN KEY (guarda_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE pacote_esteril_conteudo
  ADD CONSTRAINT fk_pacote_esteril_conteudo_pacote_esteril_id FOREIGN KEY (pacote_esteril_id) REFERENCES pacote_esteril (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_esteril_conteudo_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_esteril_conteudo_produto_reprocessavel_id FOREIGN KEY (produto_reprocessavel_id) REFERENCES produto_reprocessavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_esteril_conteudo_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT;
ALTER TABLE participante_cirurgia
  ADD CONSTRAINT fk_participante_cirurgia_ato_cirurgico_id FOREIGN KEY (ato_cirurgico_id) REFERENCES ato_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_participante_cirurgia_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_participante_cirurgia_funcao_equipe_cirurgica_id FOREIGN KEY (funcao_equipe_cirurgica_id) REFERENCES funcao_equipe_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_participante_cirurgia_ato_cirurgico_procedimento_id FOREIGN KEY (ato_cirurgico_procedimento_id) REFERENCES ato_cirurgico_procedimento (id) ON DELETE RESTRICT;
ALTER TABLE pendencia_agendamento_cirurgico
  ADD CONSTRAINT fk_pendencia_agendamento_cirurgico_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_agendamento_cirurgico_tipo_pendencia_cirurgica_id FOREIGN KEY (tipo_pendencia_cirurgica_id) REFERENCES tipo_pendencia_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_agendamento_cirurgico_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_agendamento_cirurgico_responsavel_setor_fu_02577bb2 FOREIGN KEY (responsavel_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_agendamento_cirurgico_resolvida_por_usuario_id FOREIGN KEY (resolvida_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE permissao_sala_usuario
  ADD CONSTRAINT fk_permissao_sala_usuario_sala_cirurgica_id FOREIGN KEY (sala_cirurgica_id) REFERENCES sala_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_permissao_sala_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE permissao_setor_cme
  ADD CONSTRAINT fk_permissao_setor_cme_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_permissao_setor_cme_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE posicao_cirurgica
  ADD CONSTRAINT fk_posicao_cirurgica_icone_arquivo_id FOREIGN KEY (icone_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE prazo_agendamento_cirurgico
  ADD CONSTRAINT fk_prazo_agendamento_cirurgico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prazo_agendamento_cirurgico_carater_cirurgia_id FOREIGN KEY (carater_cirurgia_id) REFERENCES carater_cirurgia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prazo_agendamento_cirurgico_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prazo_agendamento_cirurgico_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT;
ALTER TABLE procedimento_cirurgico
  ADD CONSTRAINT fk_procedimento_cirurgico_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_cirurgico_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_cirurgico_grupo_procedimento_cirurgico_id FOREIGN KEY (grupo_procedimento_cirurgico_id) REFERENCES grupo_procedimento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_cirurgico_porte_cirurgico_id FOREIGN KEY (porte_cirurgico_id) REFERENCES porte_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_cirurgico_via_acesso_cirurgico_id FOREIGN KEY (via_acesso_cirurgico_id) REFERENCES via_acesso_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_cirurgico_classe_contaminacao_cirurgica_id FOREIGN KEY (classe_contaminacao_cirurgica_id) REFERENCES classe_contaminacao_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_cirurgico_tipo_anestesia_id FOREIGN KEY (tipo_anestesia_id) REFERENCES tipo_anestesia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_cirurgico_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT;
ALTER TABLE procedimento_cirurgico_equipamento
  ADD CONSTRAINT fk_procedimento_cirurgico_equipamento_procedimento_cirurgico_id FOREIGN KEY (procedimento_cirurgico_id) REFERENCES procedimento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_cirurgico_equipamento_equipamento_saude_id FOREIGN KEY (equipamento_saude_id) REFERENCES equipamento_saude (id) ON DELETE RESTRICT;
ALTER TABLE procedimento_cirurgico_especialidade
  ADD CONSTRAINT fk_procedimento_cirurgico_especialidade_procedimento_ci_8fe46ab9 FOREIGN KEY (procedimento_cirurgico_id) REFERENCES procedimento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_cirurgico_especialidade_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT;
ALTER TABLE procedimento_cirurgico_exame
  ADD CONSTRAINT fk_procedimento_cirurgico_exame_procedimento_cirurgico_id FOREIGN KEY (procedimento_cirurgico_id) REFERENCES procedimento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_cirurgico_exame_unidade_cirurgica_id FOREIGN KEY (unidade_cirurgica_id) REFERENCES unidade_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_cirurgico_exame_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_cirurgico_exame_executor_setor_funcional_id FOREIGN KEY (executor_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE produto_fase_reprocessamento
  ADD CONSTRAINT fk_produto_fase_reprocessamento_produto_reprocessavel_id FOREIGN KEY (produto_reprocessavel_id) REFERENCES produto_reprocessavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_produto_fase_reprocessamento_caixa_instrumental_id FOREIGN KEY (caixa_instrumental_id) REFERENCES caixa_instrumental (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_produto_fase_reprocessamento_fase_reprocessamento_id FOREIGN KEY (fase_reprocessamento_id) REFERENCES fase_reprocessamento (id) ON DELETE RESTRICT;
ALTER TABLE produto_reprocessavel
  ADD CONSTRAINT fk_produto_reprocessavel_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_produto_reprocessavel_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_produto_reprocessavel_bem_patrimonial_id FOREIGN KEY (bem_patrimonial_id) REFERENCES bem_patrimonial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_produto_reprocessavel_metodo_esterilizacao_id FOREIGN KEY (metodo_esterilizacao_id) REFERENCES metodo_esterilizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_produto_reprocessavel_tipo_embalagem_esteril_id FOREIGN KEY (tipo_embalagem_esteril_id) REFERENCES tipo_embalagem_esteril (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_produto_reprocessavel_guarda_setor_funcional_id FOREIGN KEY (guarda_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE projeto_mutirao_cirurgico
  ADD CONSTRAINT fk_projeto_mutirao_cirurgico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_projeto_mutirao_cirurgico_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_projeto_mutirao_cirurgico_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_projeto_mutirao_cirurgico_projeto_id FOREIGN KEY (projeto_id) REFERENCES projeto (id) ON DELETE RESTRICT;
ALTER TABLE projeto_mutirao_cirurgico_fornecedor
  ADD CONSTRAINT fk_projeto_mutirao_cirurgico_fornecedor_projeto_mutirao_d4a013c1 FOREIGN KEY (projeto_mutirao_cirurgico_id) REFERENCES projeto_mutirao_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_projeto_mutirao_cirurgico_fornecedor_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT;
ALTER TABLE projeto_mutirao_cirurgico_insumo
  ADD CONSTRAINT fk_projeto_mutirao_cirurgico_insumo_projeto_mutirao_cirurgico_id FOREIGN KEY (projeto_mutirao_cirurgico_id) REFERENCES projeto_mutirao_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_projeto_mutirao_cirurgico_insumo_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_projeto_mutirao_cirurgico_insumo_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE projeto_mutirao_cirurgico_procedimento
  ADD CONSTRAINT fk_projeto_mutirao_cirurgico_procedimento_projeto_mutir_f0048070 FOREIGN KEY (projeto_mutirao_cirurgico_id) REFERENCES projeto_mutirao_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_projeto_mutirao_cirurgico_procedimento_procedimento__f62c68fd FOREIGN KEY (procedimento_cirurgico_id) REFERENCES procedimento_cirurgico (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_esterilizacao
  ADD CONSTRAINT fk_protocolo_esterilizacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_esterilizacao_equipamento_esterilizacao_id FOREIGN KEY (equipamento_esterilizacao_id) REFERENCES equipamento_esterilizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_esterilizacao_metodo_esterilizacao_id FOREIGN KEY (metodo_esterilizacao_id) REFERENCES metodo_esterilizacao (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_profilaxia_cirurgica
  ADD CONSTRAINT fk_protocolo_profilaxia_cirurgica_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_profilaxia_cirurgica_procedimento_cirurgico_id FOREIGN KEY (procedimento_cirurgico_id) REFERENCES procedimento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_profilaxia_cirurgica_grupo_procedimento_ci_04db2ab7 FOREIGN KEY (grupo_procedimento_cirurgico_id) REFERENCES grupo_procedimento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_profilaxia_cirurgica_classe_contaminacao_c_c8edf22e FOREIGN KEY (classe_contaminacao_cirurgica_id) REFERENCES classe_contaminacao_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_profilaxia_cirurgica_antimicrobiano_id FOREIGN KEY (antimicrobiano_id) REFERENCES antimicrobiano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_profilaxia_cirurgica_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_profilaxia_cirurgica_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_profilaxia_cirurgica_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT;
ALTER TABLE reagendamento_cirurgico
  ADD CONSTRAINT fk_reagendamento_cirurgico_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reagendamento_cirurgico_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reagendamento_cirurgico_anterior_sala_cirurgica_id FOREIGN KEY (anterior_sala_cirurgica_id) REFERENCES sala_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reagendamento_cirurgico_nova_sala_cirurgica_id FOREIGN KEY (nova_sala_cirurgica_id) REFERENCES sala_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reagendamento_cirurgico_motivo_suspensao_cirurgia_id FOREIGN KEY (motivo_suspensao_cirurgia_id) REFERENCES motivo_suspensao_cirurgia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reagendamento_cirurgico_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE recebimento_material_terceiro
  ADD CONSTRAINT fk_recebimento_material_terceiro_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_material_terceiro_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_material_terceiro_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_material_terceiro_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_material_terceiro_solicitacao_material_esteril_id FOREIGN KEY (solicitacao_material_esteril_id) REFERENCES solicitacao_material_esteril (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_material_terceiro_cme_setor_funcional_id FOREIGN KEY (cme_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_material_terceiro_recebido_por_usuario_id FOREIGN KEY (recebido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_material_terceiro_conferido_por_usuario_id FOREIGN KEY (conferido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_material_terceiro_devolvido_por_usuario_id FOREIGN KEY (devolvido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE recebimento_material_terceiro_item
  ADD CONSTRAINT fk_recebimento_material_terceiro_item_recebimento_mater_da61876a FOREIGN KEY (recebimento_material_terceiro_id) REFERENCES recebimento_material_terceiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_material_terceiro_item_material_terceiro_2cd96575 FOREIGN KEY (material_terceiro_reprocessamento_id) REFERENCES material_terceiro_reprocessamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_material_terceiro_item_agendamento_cirur_8e83f537 FOREIGN KEY (agendamento_cirurgico_procedimento_id) REFERENCES agendamento_cirurgico_procedimento (id) ON DELETE RESTRICT;
ALTER TABLE registro_recuperacao_anestesica
  ADD CONSTRAINT fk_registro_recuperacao_anestesica_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_recuperacao_anestesica_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_recuperacao_anestesica_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_recuperacao_anestesica_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_recuperacao_anestesica_ato_cirurgico_id FOREIGN KEY (ato_cirurgico_id) REFERENCES ato_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_recuperacao_anestesica_ficha_anestesica_id FOREIGN KEY (ficha_anestesica_id) REFERENCES ficha_anestesica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_recuperacao_anestesica_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_recuperacao_anestesica_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_recuperacao_anestesica_alta_profissional_id FOREIGN KEY (alta_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_recuperacao_anestesica_destino_unidade_internacao_id FOREIGN KEY (destino_unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_recuperacao_anestesica_destino_setor_funcional_id FOREIGN KEY (destino_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_recuperacao_anestesica_chamada_transferenci_98f6acdf FOREIGN KEY (chamada_transferencia_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE rejeicao_reprocessamento
  ADD CONSTRAINT fk_rejeicao_reprocessamento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rejeicao_reprocessamento_motivo_rejeicao_reprocessamento_id FOREIGN KEY (motivo_rejeicao_reprocessamento_id) REFERENCES motivo_rejeicao_reprocessamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rejeicao_reprocessamento_fase_reprocessamento_id FOREIGN KEY (fase_reprocessamento_id) REFERENCES fase_reprocessamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rejeicao_reprocessamento_pacote_esteril_id FOREIGN KEY (pacote_esteril_id) REFERENCES pacote_esteril (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rejeicao_reprocessamento_ciclo_esterilizacao_id FOREIGN KEY (ciclo_esterilizacao_id) REFERENCES ciclo_esterilizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rejeicao_reprocessamento_solicitacao_material_esteril_id FOREIGN KEY (solicitacao_material_esteril_id) REFERENCES solicitacao_material_esteril (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rejeicao_reprocessamento_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rejeicao_reprocessamento_rejeitado_por_usuario_id FOREIGN KEY (rejeitado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rejeicao_reprocessamento_retorno_fase_reprocessamento_id FOREIGN KEY (retorno_fase_reprocessamento_id) REFERENCES fase_reprocessamento (id) ON DELETE RESTRICT;
ALTER TABLE reserva_equipamento_cirurgia
  ADD CONSTRAINT fk_reserva_equipamento_cirurgia_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_equipamento_cirurgia_equipamento_saude_id FOREIGN KEY (equipamento_saude_id) REFERENCES equipamento_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_equipamento_cirurgia_agendamento_cirurgico_p_b2f049b5 FOREIGN KEY (agendamento_cirurgico_procedimento_id) REFERENCES agendamento_cirurgico_procedimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_equipamento_cirurgia_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE reserva_hemocomponente_cirurgia
  ADD CONSTRAINT fk_reserva_hemocomponente_cirurgia_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_hemocomponente_cirurgia_hemocomponente_id FOREIGN KEY (hemocomponente_id) REFERENCES hemocomponente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_hemocomponente_cirurgia_agendamento_cirurgic_f63136c1 FOREIGN KEY (agendamento_cirurgico_procedimento_id) REFERENCES agendamento_cirurgico_procedimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_hemocomponente_cirurgia_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE sala_cirurgica
  ADD CONSTRAINT fk_sala_cirurgica_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sala_cirurgica_unidade_cirurgica_id FOREIGN KEY (unidade_cirurgica_id) REFERENCES unidade_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sala_cirurgica_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sala_cirurgica_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sala_cirurgica_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT;
