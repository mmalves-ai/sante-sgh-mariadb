-- Chaves do lote 09_HOT-03 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE planejamento_cardapio_preparacao
  ADD CONSTRAINT fk_planejamento_cardapio_preparacao_planejamento_cardapio_id FOREIGN KEY (planejamento_cardapio_id) REFERENCES planejamento_cardapio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_planejamento_cardapio_preparacao_refeicao_do_dia_id FOREIGN KEY (refeicao_do_dia_id) REFERENCES refeicao_do_dia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_planejamento_cardapio_preparacao_alternativa_cardapio_id FOREIGN KEY (alternativa_cardapio_id) REFERENCES alternativa_cardapio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_planejamento_cardapio_preparacao_preparacao_culinaria_id FOREIGN KEY (preparacao_culinaria_id) REFERENCES preparacao_culinaria (id) ON DELETE RESTRICT;
ALTER TABLE plano_preventivo
  ADD CONSTRAINT fk_plano_preventivo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_preventivo_oficina_manutencao_id FOREIGN KEY (oficina_manutencao_id) REFERENCES oficina_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_preventivo_tipo_ordem_servico_manutencao_id FOREIGN KEY (tipo_ordem_servico_manutencao_id) REFERENCES tipo_ordem_servico_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_preventivo_motivo_ordem_servico_manutencao_id FOREIGN KEY (motivo_ordem_servico_manutencao_id) REFERENCES motivo_ordem_servico_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_preventivo_contrato_servico_terceirizado_id FOREIGN KEY (contrato_servico_terceirizado_id) REFERENCES contrato_servico_terceirizado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_preventivo_responsavel_colaborador_id FOREIGN KEY (responsavel_colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT;
ALTER TABLE plano_preventivo_equipamento
  ADD CONSTRAINT fk_plano_preventivo_equipamento_plano_preventivo_id FOREIGN KEY (plano_preventivo_id) REFERENCES plano_preventivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_preventivo_equipamento_equipamento_saude_id FOREIGN KEY (equipamento_saude_id) REFERENCES equipamento_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_preventivo_equipamento_ambiente_climatizado_id FOREIGN KEY (ambiente_climatizado_id) REFERENCES ambiente_climatizado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_preventivo_equipamento_bem_patrimonial_id FOREIGN KEY (bem_patrimonial_id) REFERENCES bem_patrimonial (id) ON DELETE RESTRICT;
ALTER TABLE plano_preventivo_tarefa
  ADD CONSTRAINT fk_plano_preventivo_tarefa_plano_preventivo_id FOREIGN KEY (plano_preventivo_id) REFERENCES plano_preventivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_preventivo_tarefa_servico_manutencao_id FOREIGN KEY (servico_manutencao_id) REFERENCES servico_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_preventivo_tarefa_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_preventivo_tarefa_cargo_id FOREIGN KEY (cargo_id) REFERENCES cargo (id) ON DELETE RESTRICT;
ALTER TABLE ponto_acesso
  ADD CONSTRAINT fk_ponto_acesso_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ponto_acesso_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE portador_documento
  ADD CONSTRAINT fk_portador_documento_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_portador_documento_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE prazo_atendimento_manutencao
  ADD CONSTRAINT fk_prazo_atendimento_manutencao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prazo_atendimento_manutencao_tipo_ordem_servico_manutencao_id FOREIGN KEY (tipo_ordem_servico_manutencao_id) REFERENCES tipo_ordem_servico_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prazo_atendimento_manutencao_especialidade_manutencao_id FOREIGN KEY (especialidade_manutencao_id) REFERENCES especialidade_manutencao (id) ON DELETE RESTRICT;
ALTER TABLE preco_refeicao
  ADD CONSTRAINT fk_preco_refeicao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_refeicao_refeicao_do_dia_id FOREIGN KEY (refeicao_do_dia_id) REFERENCES refeicao_do_dia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_refeicao_modalidade_dieta_id FOREIGN KEY (modalidade_dieta_id) REFERENCES modalidade_dieta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_refeicao_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_refeicao_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE preparacao_culinaria
  ADD CONSTRAINT fk_preparacao_culinaria_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preparacao_culinaria_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE preparacao_dieta
  ADD CONSTRAINT fk_preparacao_dieta_preparacao_culinaria_id FOREIGN KEY (preparacao_culinaria_id) REFERENCES preparacao_culinaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preparacao_dieta_modalidade_dieta_id FOREIGN KEY (modalidade_dieta_id) REFERENCES modalidade_dieta (id) ON DELETE RESTRICT;
ALTER TABLE preparo_lactario
  ADD CONSTRAINT fk_preparo_lactario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preparo_lactario_horario_refeicao_id FOREIGN KEY (horario_refeicao_id) REFERENCES horario_refeicao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preparo_lactario_refeicao_do_dia_id FOREIGN KEY (refeicao_do_dia_id) REFERENCES refeicao_do_dia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preparo_lactario_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preparo_lactario_manipulador_colaborador_id FOREIGN KEY (manipulador_colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preparo_lactario_conferente_colaborador_id FOREIGN KEY (conferente_colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT;
ALTER TABLE preparo_lactario_item
  ADD CONSTRAINT fk_preparo_lactario_item_preparo_lactario_id FOREIGN KEY (preparo_lactario_id) REFERENCES preparo_lactario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preparo_lactario_item_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preparo_lactario_item_prescricao_item_dieta_id FOREIGN KEY (prescricao_item_dieta_id) REFERENCES prescricao_item_dieta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preparo_lactario_item_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preparo_lactario_item_formula_lactea_id FOREIGN KEY (formula_lactea_id) REFERENCES formula_lactea (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preparo_lactario_item_preparacao_culinaria_id FOREIGN KEY (preparacao_culinaria_id) REFERENCES preparacao_culinaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preparo_lactario_item_tipo_bico_mamadeira_id FOREIGN KEY (tipo_bico_mamadeira_id) REFERENCES tipo_bico_mamadeira (id) ON DELETE RESTRICT;
ALTER TABLE producao_refeicao
  ADD CONSTRAINT fk_producao_refeicao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_refeicao_refeicao_do_dia_id FOREIGN KEY (refeicao_do_dia_id) REFERENCES refeicao_do_dia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_refeicao_planejamento_cardapio_id FOREIGN KEY (planejamento_cardapio_id) REFERENCES planejamento_cardapio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_refeicao_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_refeicao_requisicao_material_id FOREIGN KEY (requisicao_material_id) REFERENCES requisicao_material (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_refeicao_responsavel_colaborador_id FOREIGN KEY (responsavel_colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT;
ALTER TABLE producao_refeicao_item
  ADD CONSTRAINT fk_producao_refeicao_item_producao_refeicao_id FOREIGN KEY (producao_refeicao_id) REFERENCES producao_refeicao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_refeicao_item_alternativa_cardapio_id FOREIGN KEY (alternativa_cardapio_id) REFERENCES alternativa_cardapio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_refeicao_item_preparacao_culinaria_id FOREIGN KEY (preparacao_culinaria_id) REFERENCES preparacao_culinaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_refeicao_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_refeicao_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE profissional_higienizacao
  ADD CONSTRAINT fk_profissional_higienizacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_higienizacao_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_higienizacao_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_higienizacao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE profissional_higienizacao_telefone
  ADD CONSTRAINT fk_profissional_higienizacao_telefone_profissional_higienizacao FOREIGN KEY (profissional_higienizacao_id) REFERENCES profissional_higienizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_higienizacao_telefone_tipo_telefone_id FOREIGN KEY (tipo_telefone_id) REFERENCES tipo_telefone (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_tramite
  ADD CONSTRAINT fk_protocolo_tramite_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_tramite_remetente_setor_tramite_id FOREIGN KEY (remetente_setor_tramite_id) REFERENCES setor_tramite (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_tramite_destinatario_setor_tramite_id FOREIGN KEY (destinatario_setor_tramite_id) REFERENCES setor_tramite (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_tramite_motivo_tramite_documento_id FOREIGN KEY (motivo_tramite_documento_id) REFERENCES motivo_tramite_documento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_tramite_emissor_usuario_id FOREIGN KEY (emissor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_tramite_portador_documento_id FOREIGN KEY (portador_documento_id) REFERENCES portador_documento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_tramite_recebedor_usuario_id FOREIGN KEY (recebedor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_tramite_item
  ADD CONSTRAINT fk_protocolo_tramite_item_protocolo_tramite_id FOREIGN KEY (protocolo_tramite_id) REFERENCES protocolo_tramite (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_tramite_item_volume_prontuario_id FOREIGN KEY (volume_prontuario_id) REFERENCES volume_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_tramite_item_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_tramite_item_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_tramite_item_documento_emitido_id FOREIGN KEY (documento_emitido_id) REFERENCES documento_emitido (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_tramite_item_recebedor_usuario_id FOREIGN KEY (recebedor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_tramite_item_devolucao_protocolo_tramite_id FOREIGN KEY (devolucao_protocolo_tramite_id) REFERENCES protocolo_tramite (id) ON DELETE RESTRICT;
ALTER TABLE qualificacao_plano_manutencao
  ADD CONSTRAINT fk_qualificacao_plano_manutencao_plano_preventivo_id FOREIGN KEY (plano_preventivo_id) REFERENCES plano_preventivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_qualificacao_plano_manutencao_especialidade_manutencao_id FOREIGN KEY (especialidade_manutencao_id) REFERENCES especialidade_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_qualificacao_plano_manutencao_oficina_manutencao_id FOREIGN KEY (oficina_manutencao_id) REFERENCES oficina_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_qualificacao_plano_manutencao_cargo_id FOREIGN KEY (cargo_id) REFERENCES cargo (id) ON DELETE RESTRICT;
ALTER TABLE ramal_telefonico
  ADD CONSTRAINT fk_ramal_telefonico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ramal_telefonico_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ramal_telefonico_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT;
ALTER TABLE refeicao_acompanhante
  ADD CONSTRAINT fk_refeicao_acompanhante_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_refeicao_acompanhante_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_refeicao_acompanhante_acompanhante_internacao_id FOREIGN KEY (acompanhante_internacao_id) REFERENCES acompanhante_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_refeicao_acompanhante_refeicao_do_dia_id FOREIGN KEY (refeicao_do_dia_id) REFERENCES refeicao_do_dia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_refeicao_acompanhante_direito_refeicao_acompanhante_id FOREIGN KEY (direito_refeicao_acompanhante_id) REFERENCES direito_refeicao_acompanhante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_refeicao_acompanhante_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_refeicao_acompanhante_autorizador_usuario_id FOREIGN KEY (autorizador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_refeicao_acompanhante_preco_refeicao_id FOREIGN KEY (preco_refeicao_id) REFERENCES preco_refeicao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_refeicao_acompanhante_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT;
ALTER TABLE regra_acesso_setor
  ADD CONSTRAINT fk_regra_acesso_setor_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_acesso_setor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE regra_visita_acomodacao
  ADD CONSTRAINT fk_regra_visita_acomodacao_regra_visita_unidade_id FOREIGN KEY (regra_visita_unidade_id) REFERENCES regra_visita_unidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_visita_acomodacao_categoria_acomodacao_id FOREIGN KEY (categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_visita_acomodacao_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT;
ALTER TABLE regra_visita_unidade
  ADD CONSTRAINT fk_regra_visita_unidade_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_visita_unidade_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT;
ALTER TABLE remessa_lavanderia
  ADD CONSTRAINT fk_remessa_lavanderia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_lavanderia_lavanderia_externa_id FOREIGN KEY (lavanderia_externa_id) REFERENCES lavanderia_externa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_lavanderia_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE retorno_lavanderia
  ADD CONSTRAINT fk_retorno_lavanderia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_lavanderia_remessa_lavanderia_id FOREIGN KEY (remessa_lavanderia_id) REFERENCES remessa_lavanderia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_lavanderia_ocorrencia_fornecedor_id FOREIGN KEY (ocorrencia_fornecedor_id) REFERENCES ocorrencia_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_lavanderia_conferente_usuario_id FOREIGN KEY (conferente_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE retorno_lavanderia_item
  ADD CONSTRAINT fk_retorno_lavanderia_item_retorno_lavanderia_id FOREIGN KEY (retorno_lavanderia_id) REFERENCES retorno_lavanderia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_lavanderia_item_peca_enxoval_id FOREIGN KEY (peca_enxoval_id) REFERENCES peca_enxoval (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_lavanderia_item_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE servico_lavanderia_cliente
  ADD CONSTRAINT fk_servico_lavanderia_cliente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_lavanderia_cliente_cliente_financeiro_id FOREIGN KEY (cliente_financeiro_id) REFERENCES cliente_financeiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_lavanderia_cliente_lavanderia_externa_id FOREIGN KEY (lavanderia_externa_id) REFERENCES lavanderia_externa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_lavanderia_cliente_entrada_usuario_id FOREIGN KEY (entrada_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_lavanderia_cliente_contagem_usuario_id FOREIGN KEY (contagem_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_lavanderia_cliente_envio_lavagem_usuario_id FOREIGN KEY (envio_lavagem_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_lavanderia_cliente_conclusao_lavagem_usuario_id FOREIGN KEY (conclusao_lavagem_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_lavanderia_cliente_entrega_usuario_id FOREIGN KEY (entrega_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_lavanderia_cliente_cancelamento_usuario_id FOREIGN KEY (cancelamento_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE servico_lavanderia_cliente_item
  ADD CONSTRAINT fk_servico_lavanderia_cliente_item_servico_lavanderia_cliente_id FOREIGN KEY (servico_lavanderia_cliente_id) REFERENCES servico_lavanderia_cliente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_lavanderia_cliente_item_peca_enxoval_id FOREIGN KEY (peca_enxoval_id) REFERENCES peca_enxoval (id) ON DELETE RESTRICT;
ALTER TABLE servico_manutencao
  ADD CONSTRAINT fk_servico_manutencao_especialidade_manutencao_id FOREIGN KEY (especialidade_manutencao_id) REFERENCES especialidade_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_manutencao_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE setor_tramite
  ADD CONSTRAINT fk_setor_tramite_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_setor_tramite_local_arquivo_id FOREIGN KEY (local_arquivo_id) REFERENCES local_arquivo (id) ON DELETE RESTRICT;
ALTER TABLE situacao_limpeza
  ADD CONSTRAINT fk_situacao_limpeza_anterior_situacao_limpeza_id FOREIGN KEY (anterior_situacao_limpeza_id) REFERENCES situacao_limpeza (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_cardapio
  ADD CONSTRAINT fk_solicitacao_cardapio_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_cardapio_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_cardapio_planejamento_cardapio_id FOREIGN KEY (planejamento_cardapio_id) REFERENCES planejamento_cardapio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_cardapio_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_cardapio_requisicao_material_id FOREIGN KEY (requisicao_material_id) REFERENCES requisicao_material (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_cardapio_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_cardapio_item
  ADD CONSTRAINT fk_solicitacao_cardapio_item_solicitacao_cardapio_id FOREIGN KEY (solicitacao_cardapio_id) REFERENCES solicitacao_cardapio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_cardapio_item_alternativa_cardapio_id FOREIGN KEY (alternativa_cardapio_id) REFERENCES alternativa_cardapio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_cardapio_item_preparacao_culinaria_id FOREIGN KEY (preparacao_culinaria_id) REFERENCES preparacao_culinaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_cardapio_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_cardapio_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_cardapio_item_requisicao_material_item_id FOREIGN KEY (requisicao_material_item_id) REFERENCES requisicao_material_item (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_copia_prontuario
  ADD CONSTRAINT fk_solicitacao_copia_prontuario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_copia_prontuario_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_copia_prontuario_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_copia_prontuario_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_copia_prontuario_autorizacao_arquivo_id FOREIGN KEY (autorizacao_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_copia_prontuario_procuracao_arquivo_id FOREIGN KEY (procuracao_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_copia_prontuario_autorizador_usuario_id FOREIGN KEY (autorizador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_copia_prontuario_copia_arquivo_id FOREIGN KEY (copia_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_limpeza
  ADD CONSTRAINT fk_solicitacao_limpeza_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_limpeza_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_limpeza_alta_hospitalar_id FOREIGN KEY (alta_hospitalar_id) REFERENCES alta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_limpeza_transferencia_leito_id FOREIGN KEY (transferencia_leito_id) REFERENCES transferencia_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_limpeza_reserva_leito_id FOREIGN KEY (reserva_leito_id) REFERENCES reserva_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_limpeza_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_limpeza_modalidade_limpeza_id FOREIGN KEY (modalidade_limpeza_id) REFERENCES modalidade_limpeza (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_limpeza_tipo_ocorrencia_limpeza_id FOREIGN KEY (tipo_ocorrencia_limpeza_id) REFERENCES tipo_ocorrencia_limpeza (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_limpeza_situacao_limpeza_id FOREIGN KEY (situacao_limpeza_id) REFERENCES situacao_limpeza (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_limpeza_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_limpeza_profissional_higienizacao_id FOREIGN KEY (profissional_higienizacao_id) REFERENCES profissional_higienizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_limpeza_cancelamento_usuario_id FOREIGN KEY (cancelamento_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_limpeza_local
  ADD CONSTRAINT fk_solicitacao_limpeza_local_solicitacao_limpeza_id FOREIGN KEY (solicitacao_limpeza_id) REFERENCES solicitacao_limpeza (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_limpeza_local_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_limpeza_local_area_higienizavel_id FOREIGN KEY (area_higienizavel_id) REFERENCES area_higienizavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_limpeza_local_situacao_limpeza_id FOREIGN KEY (situacao_limpeza_id) REFERENCES situacao_limpeza (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_prontuario
  ADD CONSTRAINT fk_solicitacao_prontuario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_prontuario_local_arquivo_id FOREIGN KEY (local_arquivo_id) REFERENCES local_arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_prontuario_destino_local_arquivo_id FOREIGN KEY (destino_local_arquivo_id) REFERENCES local_arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_prontuario_destino_setor_tramite_id FOREIGN KEY (destino_setor_tramite_id) REFERENCES setor_tramite (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_prontuario_motivo_solicitacao_prontuario_id FOREIGN KEY (motivo_solicitacao_prontuario_id) REFERENCES motivo_solicitacao_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_prontuario_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_prontuario_solicitante_portador_documento_id FOREIGN KEY (solicitante_portador_documento_id) REFERENCES portador_documento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_prontuario_atendente_portador_documento_id FOREIGN KEY (atendente_portador_documento_id) REFERENCES portador_documento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_prontuario_finalizacao_usuario_id FOREIGN KEY (finalizacao_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_prontuario_item
  ADD CONSTRAINT fk_solicitacao_prontuario_item_solicitacao_prontuario_id FOREIGN KEY (solicitacao_prontuario_id) REFERENCES solicitacao_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_prontuario_item_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_prontuario_item_volume_prontuario_id FOREIGN KEY (volume_prontuario_id) REFERENCES volume_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_prontuario_item_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_prontuario_item_protocolo_tramite_id FOREIGN KEY (protocolo_tramite_id) REFERENCES protocolo_tramite (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_prontuario_item_movimento_prontuario_id FOREIGN KEY (movimento_prontuario_id) REFERENCES movimento_prontuario (id) ON DELETE RESTRICT;
ALTER TABLE terminal_acesso
  ADD CONSTRAINT fk_terminal_acesso_ponto_acesso_id FOREIGN KEY (ponto_acesso_id) REFERENCES ponto_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_terminal_acesso_modelo_terminal_acesso_id FOREIGN KEY (modelo_terminal_acesso_id) REFERENCES modelo_terminal_acesso (id) ON DELETE RESTRICT;
ALTER TABLE tipo_consumo_utilidade
  ADD CONSTRAINT fk_tipo_consumo_utilidade_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
