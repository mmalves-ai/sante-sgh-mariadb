-- Chaves do lote 08_CC-03 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE sala_cirurgica_procedimento
  ADD CONSTRAINT fk_sala_cirurgica_procedimento_sala_cirurgica_id FOREIGN KEY (sala_cirurgica_id) REFERENCES sala_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sala_cirurgica_procedimento_procedimento_cirurgico_id FOREIGN KEY (procedimento_cirurgico_id) REFERENCES procedimento_cirurgico (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_material_esteril
  ADD CONSTRAINT fk_solicitacao_material_esteril_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_material_esteril_solicitante_unidade_ass_374d054a FOREIGN KEY (solicitante_unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_material_esteril_entrega_unidade_assistencial_id FOREIGN KEY (entrega_unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_material_esteril_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_material_esteril_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_material_esteril_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_material_esteril_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_material_esteril_recebido_cme_usuario_id FOREIGN KEY (recebido_cme_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_material_esteril_entregue_usuario_id FOREIGN KEY (entregue_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_material_esteril_cancelado_usuario_id FOREIGN KEY (cancelado_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_material_esteril_item
  ADD CONSTRAINT fk_solicitacao_material_esteril_item_solicitacao_materi_9487be58 FOREIGN KEY (solicitacao_material_esteril_id) REFERENCES solicitacao_material_esteril (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_material_esteril_item_caixa_instrumental_id FOREIGN KEY (caixa_instrumental_id) REFERENCES caixa_instrumental (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_material_esteril_item_produto_reprocessavel_id FOREIGN KEY (produto_reprocessavel_id) REFERENCES produto_reprocessavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_material_esteril_item_material_terceiro__b4d9d723 FOREIGN KEY (material_terceiro_reprocessamento_id) REFERENCES material_terceiro_reprocessamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_material_esteril_item_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_material_esteril_item_tipo_embalagem_esteril_id FOREIGN KEY (tipo_embalagem_esteril_id) REFERENCES tipo_embalagem_esteril (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_material_esteril_item_ciclo_esterilizacao_id FOREIGN KEY (ciclo_esterilizacao_id) REFERENCES ciclo_esterilizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_material_esteril_item_pacote_esteril_id FOREIGN KEY (pacote_esteril_id) REFERENCES pacote_esteril (id) ON DELETE RESTRICT;
ALTER TABLE suspensao_cirurgia
  ADD CONSTRAINT fk_suspensao_cirurgia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_suspensao_cirurgia_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_suspensao_cirurgia_motivo_suspensao_cirurgia_id FOREIGN KEY (motivo_suspensao_cirurgia_id) REFERENCES motivo_suspensao_cirurgia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_suspensao_cirurgia_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_suspensao_cirurgia_efetivado_usuario_id FOREIGN KEY (efetivado_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_suspensao_cirurgia_retomado_usuario_id FOREIGN KEY (retomado_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_suspensao_cirurgia_reagendamento_cirurgico_id FOREIGN KEY (reagendamento_cirurgico_id) REFERENCES reagendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_suspensao_cirurgia_novo_agendamento_cirurgico_id FOREIGN KEY (novo_agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT;
ALTER TABLE taxa_sala_cirurgica
  ADD CONSTRAINT fk_taxa_sala_cirurgica_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_taxa_sala_cirurgica_sala_cirurgica_id FOREIGN KEY (sala_cirurgica_id) REFERENCES sala_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_taxa_sala_cirurgica_equipamento_saude_id FOREIGN KEY (equipamento_saude_id) REFERENCES equipamento_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_taxa_sala_cirurgica_porte_cirurgico_id FOREIGN KEY (porte_cirurgico_id) REFERENCES porte_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_taxa_sala_cirurgica_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_taxa_sala_cirurgica_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_taxa_sala_cirurgica_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE teste_ciclo_esterilizacao
  ADD CONSTRAINT fk_teste_ciclo_esterilizacao_ciclo_esterilizacao_id FOREIGN KEY (ciclo_esterilizacao_id) REFERENCES ciclo_esterilizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teste_ciclo_esterilizacao_tipo_indicador_esterilizacao_id FOREIGN KEY (tipo_indicador_esterilizacao_id) REFERENCES tipo_indicador_esterilizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teste_ciclo_esterilizacao_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teste_ciclo_esterilizacao_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE texto_padrao_cirurgia
  ADD CONSTRAINT fk_texto_padrao_cirurgia_procedimento_cirurgico_id FOREIGN KEY (procedimento_cirurgico_id) REFERENCES procedimento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_texto_padrao_cirurgia_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE tipo_anestesia
  ADD CONSTRAINT fk_tipo_anestesia_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE tipo_documento_pre_operatorio
  ADD CONSTRAINT fk_tipo_documento_pre_operatorio_tipo_documento_clinico_id FOREIGN KEY (tipo_documento_clinico_id) REFERENCES tipo_documento_clinico (id) ON DELETE RESTRICT;
ALTER TABLE tipo_movimento_bloco
  ADD CONSTRAINT fk_tipo_movimento_bloco_situacao_bloco_id FOREIGN KEY (situacao_bloco_id) REFERENCES situacao_bloco (id) ON DELETE RESTRICT;
ALTER TABLE unidade_cirurgica
  ADD CONSTRAINT fk_unidade_cirurgica_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_unidade_cirurgica_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_unidade_cirurgica_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT;
ALTER TABLE uso_pacote_esteril
  ADD CONSTRAINT fk_uso_pacote_esteril_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_uso_pacote_esteril_pacote_esteril_id FOREIGN KEY (pacote_esteril_id) REFERENCES pacote_esteril (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_uso_pacote_esteril_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_uso_pacote_esteril_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_uso_pacote_esteril_ato_cirurgico_id FOREIGN KEY (ato_cirurgico_id) REFERENCES ato_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_uso_pacote_esteril_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_uso_pacote_esteril_registrado_usuario_id FOREIGN KEY (registrado_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_uso_pacote_esteril_movimento_estoque_id FOREIGN KEY (movimento_estoque_id) REFERENCES movimento_estoque (id) ON DELETE RESTRICT;
