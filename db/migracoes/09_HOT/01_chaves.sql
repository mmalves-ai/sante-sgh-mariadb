-- Chaves do módulo HOT, lote 01 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE acesso_paciente_portaria
  ADD CONSTRAINT fk_acesso_paciente_portaria_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_paciente_portaria_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_paciente_portaria_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_paciente_portaria_marcacao_horario_id FOREIGN KEY (marcacao_horario_id) REFERENCES marcacao_horario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_paciente_portaria_pessoa_portaria_id FOREIGN KEY (pessoa_portaria_id) REFERENCES pessoa_portaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_paciente_portaria_cracha_visitante_id FOREIGN KEY (cracha_visitante_id) REFERENCES cracha_visitante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_paciente_portaria_forma_identificacao_visitante_id FOREIGN KEY (forma_identificacao_visitante_id) REFERENCES forma_identificacao_visitante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_paciente_portaria_destino_setor_funcional_id FOREIGN KEY (destino_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_paciente_portaria_entrada_ponto_acesso_id FOREIGN KEY (entrada_ponto_acesso_id) REFERENCES ponto_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_paciente_portaria_saida_ponto_acesso_id FOREIGN KEY (saida_ponto_acesso_id) REFERENCES ponto_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_paciente_portaria_entrada_usuario_id FOREIGN KEY (entrada_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_paciente_portaria_saida_usuario_id FOREIGN KEY (saida_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE acesso_prestador_servico
  ADD CONSTRAINT fk_acesso_prestador_servico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_prestador_servico_pessoa_portaria_id FOREIGN KEY (pessoa_portaria_id) REFERENCES pessoa_portaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_prestador_servico_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_prestador_servico_prestador_terceiro_id FOREIGN KEY (prestador_terceiro_id) REFERENCES prestador_terceiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_prestador_servico_cracha_visitante_id FOREIGN KEY (cracha_visitante_id) REFERENCES cracha_visitante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_prestador_servico_forma_identificacao_visitante_id FOREIGN KEY (forma_identificacao_visitante_id) REFERENCES forma_identificacao_visitante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_prestador_servico_destino_setor_funcional_id FOREIGN KEY (destino_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_prestador_servico_entrada_ponto_acesso_id FOREIGN KEY (entrada_ponto_acesso_id) REFERENCES ponto_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_prestador_servico_saida_ponto_acesso_id FOREIGN KEY (saida_ponto_acesso_id) REFERENCES ponto_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_prestador_servico_autorizador_usuario_id FOREIGN KEY (autorizador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_prestador_servico_entrada_usuario_id FOREIGN KEY (entrada_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_prestador_servico_saida_usuario_id FOREIGN KEY (saida_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE alimento_referencia
  ADD CONSTRAINT fk_alimento_referencia_grupo_alimento_id FOREIGN KEY (grupo_alimento_id) REFERENCES grupo_alimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alimento_referencia_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alimento_referencia_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT;
ALTER TABLE alimento_referencia_nutriente
  ADD CONSTRAINT fk_alimento_referencia_nutriente_alimento_referencia_id FOREIGN KEY (alimento_referencia_id) REFERENCES alimento_referencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alimento_referencia_nutriente_nutriente_referencia_id FOREIGN KEY (nutriente_referencia_id) REFERENCES nutriente_referencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alimento_referencia_nutriente_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE alternativa_cardapio
  ADD CONSTRAINT fk_alternativa_cardapio_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE ambiente_climatizado
  ADD CONSTRAINT fk_ambiente_climatizado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ambiente_climatizado_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE area_higienizavel
  ADD CONSTRAINT fk_area_higienizavel_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_area_higienizavel_criticidade_area_id FOREIGN KEY (criticidade_area_id) REFERENCES criticidade_area (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_area_higienizavel_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_area_higienizavel_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_area_higienizavel_local_atendimento_id FOREIGN KEY (local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE baixa_enxoval
  ADD CONSTRAINT fk_baixa_enxoval_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_baixa_enxoval_peca_enxoval_id FOREIGN KEY (peca_enxoval_id) REFERENCES peca_enxoval (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_baixa_enxoval_motivo_baixa_enxoval_id FOREIGN KEY (motivo_baixa_enxoval_id) REFERENCES motivo_baixa_enxoval (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_baixa_enxoval_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_baixa_enxoval_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE bloqueio_visitante
  ADD CONSTRAINT fk_bloqueio_visitante_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_visitante_pessoa_portaria_id FOREIGN KEY (pessoa_portaria_id) REFERENCES pessoa_portaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_visitante_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_visitante_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_visitante_motivo_bloqueio_visita_id FOREIGN KEY (motivo_bloqueio_visita_id) REFERENCES motivo_bloqueio_visita (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_visitante_determinante_usuario_id FOREIGN KEY (determinante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_visitante_inativador_usuario_id FOREIGN KEY (inativador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE caracteristica_dieta
  ADD CONSTRAINT fk_caracteristica_dieta_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE cardapio_servico_quarto
  ADD CONSTRAINT fk_cardapio_servico_quarto_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cardapio_servico_quarto_grupo_cardapio_servico_quarto_id FOREIGN KEY (grupo_cardapio_servico_quarto_id) REFERENCES grupo_cardapio_servico_quarto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cardapio_servico_quarto_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE coleta_roupa_suja
  ADD CONSTRAINT fk_coleta_roupa_suja_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_coleta_roupa_suja_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_coleta_roupa_suja_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_coleta_roupa_suja_remessa_lavanderia_id FOREIGN KEY (remessa_lavanderia_id) REFERENCES remessa_lavanderia (id) ON DELETE RESTRICT;
ALTER TABLE concessao_beneficio
  ADD CONSTRAINT fk_concessao_beneficio_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_concessao_beneficio_tipo_beneficio_concedido_id FOREIGN KEY (tipo_beneficio_concedido_id) REFERENCES tipo_beneficio_concedido (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_concessao_beneficio_tipo_destinatario_beneficio_id FOREIGN KEY (tipo_destinatario_beneficio_id) REFERENCES tipo_destinatario_beneficio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_concessao_beneficio_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_concessao_beneficio_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_concessao_beneficio_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_concessao_beneficio_acompanhante_internacao_id FOREIGN KEY (acompanhante_internacao_id) REFERENCES acompanhante_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_concessao_beneficio_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_concessao_beneficio_destino_setor_funcional_id FOREIGN KEY (destino_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_concessao_beneficio_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_concessao_beneficio_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_concessao_beneficio_confirmador_usuario_id FOREIGN KEY (confirmador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE consumo_utilidade
  ADD CONSTRAINT fk_consumo_utilidade_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_utilidade_medidor_consumo_id FOREIGN KEY (medidor_consumo_id) REFERENCES medidor_consumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_utilidade_tipo_consumo_utilidade_id FOREIGN KEY (tipo_consumo_utilidade_id) REFERENCES tipo_consumo_utilidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_utilidade_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_utilidade_conta_arquivo_id FOREIGN KEY (conta_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_utilidade_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE contrato_servico_terceirizado
  ADD CONSTRAINT fk_contrato_servico_terceirizado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_servico_terceirizado_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_servico_terceirizado_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_servico_terceirizado_gestor_usuario_id FOREIGN KEY (gestor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_servico_terceirizado_contrato_arquivo_id FOREIGN KEY (contrato_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE contrato_servico_terceirizado_item
  ADD CONSTRAINT fk_contrato_servico_terceirizado_item_contrato FOREIGN KEY (contrato_servico_terceirizado_id) REFERENCES contrato_servico_terceirizado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_servico_terceirizado_item_equipamento_saude_id FOREIGN KEY (equipamento_saude_id) REFERENCES equipamento_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_servico_terceirizado_item_ambiente_climatizado_id FOREIGN KEY (ambiente_climatizado_id) REFERENCES ambiente_climatizado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_servico_terceirizado_item_servico_manutencao_id FOREIGN KEY (servico_manutencao_id) REFERENCES servico_manutencao (id) ON DELETE RESTRICT;
ALTER TABLE copa_distribuicao
  ADD CONSTRAINT fk_copa_distribuicao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_copa_distribuicao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_copa_distribuicao_impressora_id FOREIGN KEY (impressora_id) REFERENCES impressora (id) ON DELETE RESTRICT;
ALTER TABLE copa_distribuicao_unidade
  ADD CONSTRAINT fk_copa_distribuicao_unidade_copa_distribuicao_id FOREIGN KEY (copa_distribuicao_id) REFERENCES copa_distribuicao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_copa_distribuicao_unidade_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT;
ALTER TABLE cota_enxoval_setor
  ADD CONSTRAINT fk_cota_enxoval_setor_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cota_enxoval_setor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cota_enxoval_setor_peca_enxoval_id FOREIGN KEY (peca_enxoval_id) REFERENCES peca_enxoval (id) ON DELETE RESTRICT;
ALTER TABLE cracha_visitante
  ADD CONSTRAINT fk_cracha_visitante_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE declaracao_emitida
  ADD CONSTRAINT fk_declaracao_emitida_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_emitida_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_emitida_modelo_declaracao_id FOREIGN KEY (modelo_declaracao_id) REFERENCES modelo_declaracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_emitida_acompanhante_internacao_id FOREIGN KEY (acompanhante_internacao_id) REFERENCES acompanhante_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_emitida_tipo_documento_identificacao_id FOREIGN KEY (tipo_documento_identificacao_id) REFERENCES tipo_documento_identificacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_emitida_emissor_usuario_id FOREIGN KEY (emissor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_emitida_documento_emitido_id FOREIGN KEY (documento_emitido_id) REFERENCES documento_emitido (id) ON DELETE RESTRICT;
ALTER TABLE direito_refeicao_acompanhante
  ADD CONSTRAINT fk_direito_refeicao_acompanhante_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_direito_refeicao_acompanhante_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_direito_refeicao_acompanhante_acomodacao_id FOREIGN KEY (acomodacao_id) REFERENCES acomodacao (id) ON DELETE RESTRICT;
ALTER TABLE direito_refeicao_acompanhante_refeicao
  ADD CONSTRAINT fk_direito_refeicao_acompanhante_refeicao_direito FOREIGN KEY (direito_refeicao_acompanhante_id) REFERENCES direito_refeicao_acompanhante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_direito_refeicao_acompanhante_refeicao_refeicao_do_dia_id FOREIGN KEY (refeicao_do_dia_id) REFERENCES refeicao_do_dia (id) ON DELETE RESTRICT;
ALTER TABLE distribuicao_enxoval
  ADD CONSTRAINT fk_distribuicao_enxoval_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_distribuicao_enxoval_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_distribuicao_enxoval_entregador_usuario_id FOREIGN KEY (entregador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_distribuicao_enxoval_recebedor_usuario_id FOREIGN KEY (recebedor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE distribuicao_enxoval_item
  ADD CONSTRAINT fk_distribuicao_enxoval_item_distribuicao_enxoval_id FOREIGN KEY (distribuicao_enxoval_id) REFERENCES distribuicao_enxoval (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_distribuicao_enxoval_item_peca_enxoval_id FOREIGN KEY (peca_enxoval_id) REFERENCES peca_enxoval (id) ON DELETE RESTRICT;
ALTER TABLE documento_digitalizado
  ADD CONSTRAINT fk_documento_digitalizado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_digitalizado_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_digitalizado_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_digitalizado_volume_prontuario_id FOREIGN KEY (volume_prontuario_id) REFERENCES volume_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_digitalizado_tipo_documento_arquivo_id FOREIGN KEY (tipo_documento_arquivo_id) REFERENCES tipo_documento_arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_digitalizado_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_digitalizado_digitalizador_usuario_id FOREIGN KEY (digitalizador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_digitalizado_conferente_usuario_id FOREIGN KEY (conferente_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE eliminacao_prontuario
  ADD CONSTRAINT fk_eliminacao_prontuario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_eliminacao_prontuario_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_eliminacao_prontuario_volume_prontuario_id FOREIGN KEY (volume_prontuario_id) REFERENCES volume_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_eliminacao_prontuario_comissao_hospitalar_id FOREIGN KEY (comissao_hospitalar_id) REFERENCES comissao_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_eliminacao_prontuario_ata_arquivo_id FOREIGN KEY (ata_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_eliminacao_prontuario_termo_arquivo_id FOREIGN KEY (termo_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_eliminacao_prontuario_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_eliminacao_prontuario_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE emprestimo_prontuario
  ADD CONSTRAINT fk_emprestimo_prontuario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emprestimo_prontuario_volume_prontuario_id FOREIGN KEY (volume_prontuario_id) REFERENCES volume_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emprestimo_prontuario_motivo_solicitacao_prontuario_id FOREIGN KEY (motivo_solicitacao_prontuario_id) REFERENCES motivo_solicitacao_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emprestimo_prontuario_destino_setor_funcional_id FOREIGN KEY (destino_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emprestimo_prontuario_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emprestimo_prontuario_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emprestimo_prontuario_entregador_usuario_id FOREIGN KEY (entregador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emprestimo_prontuario_recebedor_usuario_id FOREIGN KEY (recebedor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE entrega_copia_prontuario
  ADD CONSTRAINT fk_entrega_copia_prontuario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrega_copia_prontuario_solicitacao_copia_prontuario_id FOREIGN KEY (solicitacao_copia_prontuario_id) REFERENCES solicitacao_copia_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrega_copia_prontuario_entregador_usuario_id FOREIGN KEY (entregador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrega_copia_prontuario_tipo_documento_identificacao_id FOREIGN KEY (tipo_documento_identificacao_id) REFERENCES tipo_documento_identificacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrega_copia_prontuario_procuracao_arquivo_id FOREIGN KEY (procuracao_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrega_copia_prontuario_comprovante_arquivo_id FOREIGN KEY (comprovante_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE equipamento_saude
  ADD CONSTRAINT fk_equipamento_saude_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipamento_saude_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipamento_saude_especialidade_manutencao_id FOREIGN KEY (especialidade_manutencao_id) REFERENCES especialidade_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipamento_saude_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipamento_saude_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipamento_saude_ambiente_climatizado_id FOREIGN KEY (ambiente_climatizado_id) REFERENCES ambiente_climatizado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipamento_saude_recurso_agendavel_id FOREIGN KEY (recurso_agendavel_id) REFERENCES recurso_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipamento_saude_bem_patrimonial_id FOREIGN KEY (bem_patrimonial_id) REFERENCES bem_patrimonial (id) ON DELETE RESTRICT;
ALTER TABLE escala_higienizacao
  ADD CONSTRAINT fk_escala_higienizacao_area_higienizavel_id FOREIGN KEY (area_higienizavel_id) REFERENCES area_higienizavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escala_higienizacao_profissional_higienizacao_id FOREIGN KEY (profissional_higienizacao_id) REFERENCES profissional_higienizacao (id) ON DELETE RESTRICT;
ALTER TABLE escolha_cardapio_paciente
  ADD CONSTRAINT fk_escolha_cardapio_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escolha_cardapio_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escolha_cardapio_paciente_acompanhante_internacao_id FOREIGN KEY (acompanhante_internacao_id) REFERENCES acompanhante_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escolha_cardapio_paciente_refeicao_do_dia_id FOREIGN KEY (refeicao_do_dia_id) REFERENCES refeicao_do_dia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escolha_cardapio_paciente_alternativa_cardapio_id FOREIGN KEY (alternativa_cardapio_id) REFERENCES alternativa_cardapio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escolha_cardapio_paciente_planejamento_cardapio_id FOREIGN KEY (planejamento_cardapio_id) REFERENCES planejamento_cardapio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escolha_cardapio_paciente_solicitacao_cardapio_id FOREIGN KEY (solicitacao_cardapio_id) REFERENCES solicitacao_cardapio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escolha_cardapio_paciente_registrador_usuario_id FOREIGN KEY (registrador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE execucao_limpeza
  ADD CONSTRAINT fk_execucao_limpeza_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_execucao_limpeza_solicitacao_limpeza_id FOREIGN KEY (solicitacao_limpeza_id) REFERENCES solicitacao_limpeza (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_execucao_limpeza_profissional_higienizacao_id FOREIGN KEY (profissional_higienizacao_id) REFERENCES profissional_higienizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_execucao_limpeza_modalidade_limpeza_id FOREIGN KEY (modalidade_limpeza_id) REFERENCES modalidade_limpeza (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_execucao_limpeza_situacao_limpeza_id FOREIGN KEY (situacao_limpeza_id) REFERENCES situacao_limpeza (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_execucao_limpeza_liberador_usuario_id FOREIGN KEY (liberador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE execucao_preventiva
  ADD CONSTRAINT fk_execucao_preventiva_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_execucao_preventiva_plano_preventivo_id FOREIGN KEY (plano_preventivo_id) REFERENCES plano_preventivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_execucao_preventiva_equipamento_saude_id FOREIGN KEY (equipamento_saude_id) REFERENCES equipamento_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_execucao_preventiva_ambiente_climatizado_id FOREIGN KEY (ambiente_climatizado_id) REFERENCES ambiente_climatizado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_execucao_preventiva_tecnico_usuario_id FOREIGN KEY (tecnico_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_execucao_preventiva_contrato_servico_terceirizado_id FOREIGN KEY (contrato_servico_terceirizado_id) REFERENCES contrato_servico_terceirizado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_execucao_preventiva_laudo_arquivo_id FOREIGN KEY (laudo_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_execucao_preventiva_ordem_servico_manutencao_id FOREIGN KEY (ordem_servico_manutencao_id) REFERENCES ordem_servico_manutencao (id) ON DELETE RESTRICT;
ALTER TABLE execucao_preventiva_item
  ADD CONSTRAINT fk_execucao_preventiva_item_execucao_preventiva_id FOREIGN KEY (execucao_preventiva_id) REFERENCES execucao_preventiva (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_execucao_preventiva_item_plano_preventivo_tarefa_id FOREIGN KEY (plano_preventivo_tarefa_id) REFERENCES plano_preventivo_tarefa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_execucao_preventiva_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE ficha_tecnica_preparacao
  ADD CONSTRAINT fk_ficha_tecnica_preparacao_preparacao_culinaria_id FOREIGN KEY (preparacao_culinaria_id) REFERENCES preparacao_culinaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_tecnica_preparacao_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_tecnica_preparacao_alimento_referencia_id FOREIGN KEY (alimento_referencia_id) REFERENCES alimento_referencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_tecnica_preparacao_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_tecnica_preparacao_medida_caseira_alimento_id FOREIGN KEY (medida_caseira_alimento_id) REFERENCES medida_caseira_alimento (id) ON DELETE RESTRICT;
ALTER TABLE formula_lactea
  ADD CONSTRAINT fk_formula_lactea_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_formula_lactea_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT;
ALTER TABLE horario_refeicao
  ADD CONSTRAINT fk_horario_refeicao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_refeicao_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_refeicao_refeicao_do_dia_id FOREIGN KEY (refeicao_do_dia_id) REFERENCES refeicao_do_dia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_refeicao_modalidade_dieta_id FOREIGN KEY (modalidade_dieta_id) REFERENCES modalidade_dieta (id) ON DELETE RESTRICT;
