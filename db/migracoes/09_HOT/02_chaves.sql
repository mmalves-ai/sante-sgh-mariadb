-- Chaves do módulo HOT, lote 02 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE inspecao_limpeza
  ADD CONSTRAINT fk_inspecao_limpeza_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inspecao_limpeza_solicitacao_limpeza_id FOREIGN KEY (solicitacao_limpeza_id) REFERENCES solicitacao_limpeza (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inspecao_limpeza_execucao_limpeza_id FOREIGN KEY (execucao_limpeza_id) REFERENCES execucao_limpeza (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inspecao_limpeza_inspetor_usuario_id FOREIGN KEY (inspetor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inspecao_limpeza_tipo_ocorrencia_limpeza_id FOREIGN KEY (tipo_ocorrencia_limpeza_id) REFERENCES tipo_ocorrencia_limpeza (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inspecao_limpeza_nova_solicitacao_limpeza_id FOREIGN KEY (nova_solicitacao_limpeza_id) REFERENCES solicitacao_limpeza (id) ON DELETE RESTRICT;
ALTER TABLE justificativa_impressao
  ADD CONSTRAINT fk_justificativa_impressao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_justificativa_impressao_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_justificativa_impressao_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_justificativa_impressao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_justificativa_impressao_tipo_justificativa_impressao_id FOREIGN KEY (tipo_justificativa_impressao_id) REFERENCES tipo_justificativa_impressao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_justificativa_impressao_estacao_trabalho_id FOREIGN KEY (estacao_trabalho_id) REFERENCES estacao_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_justificativa_impressao_impressora_id FOREIGN KEY (impressora_id) REFERENCES impressora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_justificativa_impressao_solicitacao_copia_prontuario_id FOREIGN KEY (solicitacao_copia_prontuario_id) REFERENCES solicitacao_copia_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_justificativa_impressao_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE kit_documento_protocolo_item
  ADD CONSTRAINT fk_kit_documento_protocolo_item_kit_tipo_documento_arquivo_id FOREIGN KEY (kit_tipo_documento_arquivo_id) REFERENCES tipo_documento_arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_documento_protocolo_item_tipo_documento_arquivo_id FOREIGN KEY (tipo_documento_arquivo_id) REFERENCES tipo_documento_arquivo (id) ON DELETE RESTRICT;
ALTER TABLE laudo_calibracao
  ADD CONSTRAINT fk_laudo_calibracao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_calibracao_equipamento_saude_id FOREIGN KEY (equipamento_saude_id) REFERENCES equipamento_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_calibracao_execucao_preventiva_id FOREIGN KEY (execucao_preventiva_id) REFERENCES execucao_preventiva (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_calibracao_ordem_servico_manutencao_id FOREIGN KEY (ordem_servico_manutencao_id) REFERENCES ordem_servico_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_calibracao_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_calibracao_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE lavanderia_externa
  ADD CONSTRAINT fk_lavanderia_externa_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lavanderia_externa_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lavanderia_externa_contrato_servico_terceirizado_id FOREIGN KEY (contrato_servico_terceirizado_id) REFERENCES contrato_servico_terceirizado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lavanderia_externa_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE leito_profissional_higienizacao
  ADD CONSTRAINT fk_leito_profissional_higienizacao_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leito_profissional_higienizacao_profissional_higienizacao_id FOREIGN KEY (profissional_higienizacao_id) REFERENCES profissional_higienizacao (id) ON DELETE RESTRICT;
ALTER TABLE liberacao_saida_paciente
  ADD CONSTRAINT fk_liberacao_saida_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_saida_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_saida_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_saida_paciente_alta_hospitalar_id FOREIGN KEY (alta_hospitalar_id) REFERENCES alta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_saida_paciente_tipo_documento_identificacao_id FOREIGN KEY (tipo_documento_identificacao_id) REFERENCES tipo_documento_identificacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_saida_paciente_tipo_parentesco_id FOREIGN KEY (tipo_parentesco_id) REFERENCES tipo_parentesco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_saida_paciente_pessoa_portaria_id FOREIGN KEY (pessoa_portaria_id) REFERENCES pessoa_portaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_saida_paciente_autorizado_por_profissional_id FOREIGN KEY (autorizado_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_saida_paciente_enfermagem_profissional_id FOREIGN KEY (enfermagem_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_saida_paciente_liberado_por_usuario_id FOREIGN KEY (liberado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE local_arquivo
  ADD CONSTRAINT fk_local_arquivo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_local_arquivo_local_arquivo_pai_id FOREIGN KEY (local_arquivo_pai_id) REFERENCES local_arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_local_arquivo_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE lote_digitalizacao
  ADD CONSTRAINT fk_lote_digitalizacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_digitalizacao_operador_usuario_id FOREIGN KEY (operador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_digitalizacao_local_arquivo_id FOREIGN KEY (local_arquivo_id) REFERENCES local_arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_digitalizacao_conferido_por_usuario_id FOREIGN KEY (conferido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_digitalizacao_liberado_eliminacao_por_usuario_id FOREIGN KEY (liberado_eliminacao_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_digitalizacao_eliminacao_prontuario_id FOREIGN KEY (eliminacao_prontuario_id) REFERENCES eliminacao_prontuario (id) ON DELETE RESTRICT;
ALTER TABLE mapa_dieta
  ADD CONSTRAINT fk_mapa_dieta_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mapa_dieta_refeicao_do_dia_id FOREIGN KEY (refeicao_do_dia_id) REFERENCES refeicao_do_dia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mapa_dieta_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mapa_dieta_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mapa_dieta_copa_distribuicao_id FOREIGN KEY (copa_distribuicao_id) REFERENCES copa_distribuicao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mapa_dieta_fechado_por_usuario_id FOREIGN KEY (fechado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE mapa_dieta_item
  ADD CONSTRAINT fk_mapa_dieta_item_mapa_dieta_id FOREIGN KEY (mapa_dieta_id) REFERENCES mapa_dieta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mapa_dieta_item_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mapa_dieta_item_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mapa_dieta_item_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mapa_dieta_item_prescricao_item_dieta_id FOREIGN KEY (prescricao_item_dieta_id) REFERENCES prescricao_item_dieta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mapa_dieta_item_modalidade_dieta_id FOREIGN KEY (modalidade_dieta_id) REFERENCES modalidade_dieta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mapa_dieta_item_via_dieta_id FOREIGN KEY (via_dieta_id) REFERENCES via_dieta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mapa_dieta_item_entregue_por_usuario_id FOREIGN KEY (entregue_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mapa_dieta_item_suspenso_por_usuario_id FOREIGN KEY (suspenso_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE material_modalidade_limpeza
  ADD CONSTRAINT fk_material_modalidade_limpeza_modalidade_limpeza_id FOREIGN KEY (modalidade_limpeza_id) REFERENCES modalidade_limpeza (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_material_modalidade_limpeza_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_material_modalidade_limpeza_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE medida_caseira_alimento
  ADD CONSTRAINT fk_medida_caseira_alimento_alimento_referencia_id FOREIGN KEY (alimento_referencia_id) REFERENCES alimento_referencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_medida_caseira_alimento_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE medidor_consumo
  ADD CONSTRAINT fk_medidor_consumo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_medidor_consumo_tipo_consumo_utilidade_id FOREIGN KEY (tipo_consumo_utilidade_id) REFERENCES tipo_consumo_utilidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_medidor_consumo_medidor_pai_id FOREIGN KEY (medidor_pai_id) REFERENCES medidor_consumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_medidor_consumo_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_medidor_consumo_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_medidor_consumo_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE modalidade_dieta
  ADD CONSTRAINT fk_modalidade_dieta_via_dieta_id FOREIGN KEY (via_dieta_id) REFERENCES via_dieta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modalidade_dieta_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT;
ALTER TABLE modalidade_dieta_caracteristica
  ADD CONSTRAINT fk_modalidade_dieta_caracteristica_modalidade_dieta_id FOREIGN KEY (modalidade_dieta_id) REFERENCES modalidade_dieta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modalidade_dieta_caracteristica_caracteristica_dieta_id FOREIGN KEY (caracteristica_dieta_id) REFERENCES caracteristica_dieta (id) ON DELETE RESTRICT;
ALTER TABLE modalidade_dieta_refeicao
  ADD CONSTRAINT fk_modalidade_dieta_refeicao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modalidade_dieta_refeicao_modalidade_dieta_id FOREIGN KEY (modalidade_dieta_id) REFERENCES modalidade_dieta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modalidade_dieta_refeicao_refeicao_do_dia_id FOREIGN KEY (refeicao_do_dia_id) REFERENCES refeicao_do_dia (id) ON DELETE RESTRICT;
ALTER TABLE modalidade_limpeza
  ADD CONSTRAINT fk_modalidade_limpeza_criticidade_area_id FOREIGN KEY (criticidade_area_id) REFERENCES criticidade_area (id) ON DELETE RESTRICT;
ALTER TABLE modelo_declaracao
  ADD CONSTRAINT fk_modelo_declaracao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_declaracao_logotipo_esquerda_arquivo_id FOREIGN KEY (logotipo_esquerda_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_declaracao_logotipo_direita_arquivo_id FOREIGN KEY (logotipo_direita_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE modelo_terminal_acesso
  ADD CONSTRAINT fk_modelo_terminal_acesso_fabricante_terminal_acesso_id FOREIGN KEY (fabricante_terminal_acesso_id) REFERENCES fabricante_terminal_acesso (id) ON DELETE RESTRICT;
ALTER TABLE motivo_ordem_servico_manutencao
  ADD CONSTRAINT fk_motivo_ordem_servico_manutencao_tipo_ordem_servico_man_447cee FOREIGN KEY (tipo_ordem_servico_manutencao_id) REFERENCES tipo_ordem_servico_manutencao (id) ON DELETE RESTRICT;
ALTER TABLE movimento_prontuario
  ADD CONSTRAINT fk_movimento_prontuario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_prontuario_volume_prontuario_id FOREIGN KEY (volume_prontuario_id) REFERENCES volume_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_prontuario_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_prontuario_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_prontuario_operacao_movimento_prontuario_id FOREIGN KEY (operacao_movimento_prontuario_id) REFERENCES operacao_movimento_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_prontuario_movimentado_por_usuario_id FOREIGN KEY (movimentado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_prontuario_saida_setor_funcional_id FOREIGN KEY (saida_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_prontuario_destino_setor_funcional_id FOREIGN KEY (destino_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_prontuario_saida_local_arquivo_id FOREIGN KEY (saida_local_arquivo_id) REFERENCES local_arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_prontuario_destino_local_arquivo_id FOREIGN KEY (destino_local_arquivo_id) REFERENCES local_arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_prontuario_motivo_tramite_documento_id FOREIGN KEY (motivo_tramite_documento_id) REFERENCES motivo_tramite_documento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_prontuario_solicitacao_prontuario_id FOREIGN KEY (solicitacao_prontuario_id) REFERENCES solicitacao_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_prontuario_protocolo_tramite_id FOREIGN KEY (protocolo_tramite_id) REFERENCES protocolo_tramite (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_prontuario_portador_documento_id FOREIGN KEY (portador_documento_id) REFERENCES portador_documento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_prontuario_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE nivel_servico_contrato
  ADD CONSTRAINT fk_nivel_servico_contrato_contrato_servico_terceirizado_id FOREIGN KEY (contrato_servico_terceirizado_id) REFERENCES contrato_servico_terceirizado (id) ON DELETE RESTRICT;
ALTER TABLE nutriente_referencia
  ADD CONSTRAINT fk_nutriente_referencia_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE ocorrencia_entrega_refeicao
  ADD CONSTRAINT fk_ocorrencia_entrega_refeicao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_entrega_refeicao_mapa_dieta_item_id FOREIGN KEY (mapa_dieta_item_id) REFERENCES mapa_dieta_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_entrega_refeicao_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_entrega_refeicao_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_entrega_refeicao_refeicao_do_dia_id FOREIGN KEY (refeicao_do_dia_id) REFERENCES refeicao_do_dia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_entrega_refeicao_tipo_ocorrencia_refeicao_id FOREIGN KEY (tipo_ocorrencia_refeicao_id) REFERENCES tipo_ocorrencia_refeicao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_entrega_refeicao_registrado_por_usuario_id FOREIGN KEY (registrado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_entrega_refeicao_resolvida_por_usuario_id FOREIGN KEY (resolvida_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE oficina_manutencao
  ADD CONSTRAINT fk_oficina_manutencao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_oficina_manutencao_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_oficina_manutencao_contrato_servico_terceirizado_id FOREIGN KEY (contrato_servico_terceirizado_id) REFERENCES contrato_servico_terceirizado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_oficina_manutencao_especialidade_manutencao_id FOREIGN KEY (especialidade_manutencao_id) REFERENCES especialidade_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_oficina_manutencao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_oficina_manutencao_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_oficina_manutencao_impressora_id FOREIGN KEY (impressora_id) REFERENCES impressora (id) ON DELETE RESTRICT;
ALTER TABLE oficina_manutencao_servico
  ADD CONSTRAINT fk_oficina_manutencao_servico_oficina_manutencao_id FOREIGN KEY (oficina_manutencao_id) REFERENCES oficina_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_oficina_manutencao_servico_servico_manutencao_id FOREIGN KEY (servico_manutencao_id) REFERENCES servico_manutencao (id) ON DELETE RESTRICT;
ALTER TABLE oficina_manutencao_usuario
  ADD CONSTRAINT fk_oficina_manutencao_usuario_oficina_manutencao_id FOREIGN KEY (oficina_manutencao_id) REFERENCES oficina_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_oficina_manutencao_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE ordem_servico_manutencao
  ADD CONSTRAINT fk_ordem_servico_manutencao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_tipo_ordem_servico_manutencao_id FOREIGN KEY (tipo_ordem_servico_manutencao_id) REFERENCES tipo_ordem_servico_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_motivo_ordem_servico_manutencao_id FOREIGN KEY (motivo_ordem_servico_manutencao_id) REFERENCES motivo_ordem_servico_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_especialidade_manutencao_id FOREIGN KEY (especialidade_manutencao_id) REFERENCES especialidade_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_servico_manutencao_id FOREIGN KEY (servico_manutencao_id) REFERENCES servico_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_oficina_manutencao_id FOREIGN KEY (oficina_manutencao_id) REFERENCES oficina_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_equipamento_saude_id FOREIGN KEY (equipamento_saude_id) REFERENCES equipamento_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_bem_patrimonial_id FOREIGN KEY (bem_patrimonial_id) REFERENCES bem_patrimonial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_solicitante_setor_funcional_id FOREIGN KEY (solicitante_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_local_setor_funcional_id FOREIGN KEY (local_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_area_higienizavel_id FOREIGN KEY (area_higienizavel_id) REFERENCES area_higienizavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_contrato_servico_terceirizado_id FOREIGN KEY (contrato_servico_terceirizado_id) REFERENCES contrato_servico_terceirizado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_plano_preventivo_id FOREIGN KEY (plano_preventivo_id) REFERENCES plano_preventivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_execucao_preventiva_id FOREIGN KEY (execucao_preventiva_id) REFERENCES execucao_preventiva (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_ordem_principal_id FOREIGN KEY (ordem_principal_id) REFERENCES ordem_servico_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_causa_falha_equipamento_id FOREIGN KEY (causa_falha_equipamento_id) REFERENCES causa_falha_equipamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_aceite_usuario_id FOREIGN KEY (aceite_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_cancelado_por_usuario_id FOREIGN KEY (cancelado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE ordem_servico_manutencao_evento
  ADD CONSTRAINT fk_ordem_servico_manutencao_evento_ordem_servico_manutencao_id FOREIGN KEY (ordem_servico_manutencao_id) REFERENCES ordem_servico_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_evento_anterior_oficina_manut_55bc1a FOREIGN KEY (anterior_oficina_manutencao_id) REFERENCES oficina_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_evento_nova_oficina_manutencao_id FOREIGN KEY (nova_oficina_manutencao_id) REFERENCES oficina_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_evento_entregue_por_usuario_id FOREIGN KEY (entregue_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_evento_recebido_por_usuario_id FOREIGN KEY (recebido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_evento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE ordem_servico_manutencao_item
  ADD CONSTRAINT fk_ordem_servico_manutencao_item_ordem_servico_manutencao_id FOREIGN KEY (ordem_servico_manutencao_id) REFERENCES ordem_servico_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_item_servico_manutencao_id FOREIGN KEY (servico_manutencao_id) REFERENCES servico_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_item_requisicao_material_id FOREIGN KEY (requisicao_material_id) REFERENCES requisicao_material (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_item_executor_usuario_id FOREIGN KEY (executor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_servico_manutencao_item_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT;
ALTER TABLE peca_enxoval
  ADD CONSTRAINT fk_peca_enxoval_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT;
ALTER TABLE pedido_servico_quarto
  ADD CONSTRAINT fk_pedido_servico_quarto_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_servico_quarto_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_servico_quarto_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_servico_quarto_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_servico_quarto_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_servico_quarto_liberado_nutricao_usuario_id FOREIGN KEY (liberado_nutricao_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE pedido_servico_quarto_item
  ADD CONSTRAINT fk_pedido_servico_quarto_item_pedido_servico_quarto_id FOREIGN KEY (pedido_servico_quarto_id) REFERENCES pedido_servico_quarto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_servico_quarto_item_cardapio_servico_quarto_id FOREIGN KEY (cardapio_servico_quarto_id) REFERENCES cardapio_servico_quarto (id) ON DELETE RESTRICT;
ALTER TABLE pendencia_prontuario
  ADD CONSTRAINT fk_pendencia_prontuario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_prontuario_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_prontuario_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_prontuario_tipo_pendencia_prontuario_id FOREIGN KEY (tipo_pendencia_prontuario_id) REFERENCES tipo_pendencia_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_prontuario_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_prontuario_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_prontuario_responsavel_setor_funcional_id FOREIGN KEY (responsavel_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_prontuario_apontada_por_usuario_id FOREIGN KEY (apontada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_prontuario_resolvida_por_usuario_id FOREIGN KEY (resolvida_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE pertence_paciente
  ADD CONSTRAINT fk_pertence_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pertence_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pertence_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pertence_paciente_visita_id FOREIGN KEY (visita_id) REFERENCES visita (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pertence_paciente_pessoa_portaria_id FOREIGN KEY (pessoa_portaria_id) REFERENCES pessoa_portaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pertence_paciente_recebido_por_usuario_id FOREIGN KEY (recebido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pertence_paciente_termo_arquivo_id FOREIGN KEY (termo_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pertence_paciente_devolvido_por_usuario_id FOREIGN KEY (devolvido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pertence_paciente_devolvido_a_tipo_documento_identificacao_id FOREIGN KEY (devolvido_a_tipo_documento_identificacao_id) REFERENCES tipo_documento_identificacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pertence_paciente_devolvido_a_tipo_parentesco_id FOREIGN KEY (devolvido_a_tipo_parentesco_id) REFERENCES tipo_parentesco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pertence_paciente_termo_devolucao_arquivo_id FOREIGN KEY (termo_devolucao_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE pertence_paciente_item
  ADD CONSTRAINT fk_pertence_paciente_item_pertence_paciente_id FOREIGN KEY (pertence_paciente_id) REFERENCES pertence_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pertence_paciente_item_tipo_pertence_id FOREIGN KEY (tipo_pertence_id) REFERENCES tipo_pertence (id) ON DELETE RESTRICT;
ALTER TABLE pessoa_portaria
  ADD CONSTRAINT fk_pessoa_portaria_tipo_documento_identificacao_id FOREIGN KEY (tipo_documento_identificacao_id) REFERENCES tipo_documento_identificacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pessoa_portaria_tipo_visitante_id FOREIGN KEY (tipo_visitante_id) REFERENCES tipo_visitante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pessoa_portaria_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pessoa_portaria_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pessoa_portaria_foto_arquivo_id FOREIGN KEY (foto_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pessoa_portaria_motivo_bloqueio_visita_id FOREIGN KEY (motivo_bloqueio_visita_id) REFERENCES motivo_bloqueio_visita (id) ON DELETE RESTRICT;
ALTER TABLE planejamento_cardapio
  ADD CONSTRAINT fk_planejamento_cardapio_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_planejamento_cardapio_refeicao_do_dia_id FOREIGN KEY (refeicao_do_dia_id) REFERENCES refeicao_do_dia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_planejamento_cardapio_modalidade_dieta_id FOREIGN KEY (modalidade_dieta_id) REFERENCES modalidade_dieta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_planejamento_cardapio_alternativa_cardapio_id FOREIGN KEY (alternativa_cardapio_id) REFERENCES alternativa_cardapio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_planejamento_cardapio_copa_distribuicao_id FOREIGN KEY (copa_distribuicao_id) REFERENCES copa_distribuicao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_planejamento_cardapio_elaborado_por_usuario_id FOREIGN KEY (elaborado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_planejamento_cardapio_aprovado_por_profissional_id FOREIGN KEY (aprovado_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
